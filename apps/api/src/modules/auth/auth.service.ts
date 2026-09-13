import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateId } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { UserMapper, type UserResponse } from '../users/user.mapper';
import { AuthAuditService } from './auth-audit.service';
import type {
  ChangePasswordDto,
  PasswordResetConfirmDto,
  RegisterDto,
  UpdateProfileDto,
} from './dto';
import { CookieService } from './services/cookie.service';
import { PasswordService } from './services/password.service';
import { PasswordResetStore } from './services/password-reset.store';
import { RefreshTokenStore } from './services/refresh-token.store';
import { TokenService } from './services/token.service';

export interface SessionTokens {
  access: string;
  refresh: string;
  refreshJti: string;
}
export type SoftError = { softError: { status: number; message: string } };

function fromBase64Url(input: string): string {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Canonical form of an e-mail address for identity lookups.
 *
 * An address is an identifier, not a secret: "Ada@Example.com" and
 * "ada@example.com" are the same account, and the duplicate check already
 * treats them that way (`mode: 'insensitive'`). Registration and login must
 * agree on one form or a capital letter at sign-up locks the account out.
 */
export function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly refreshStore: RefreshTokenStore,
    private readonly resetStore: PasswordResetStore,
    private readonly userMapper: UserMapper,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly audit: AuthAuditService,
    readonly cookies: CookieService,
  ) {}

  private async issueSession(userId: string): Promise<SessionTokens> {
    const access = this.tokens.signAccess(userId);
    const { token: refresh, jti: refreshJti } = this.tokens.signRefresh(userId);
    await this.refreshStore.store(userId, refreshJti);
    return { access, refresh, refreshJti };
  }

  // --- login / register ---------------------------------------------------

  async login(email: string, password: string): Promise<{ user: UserResponse; sessionId: string; tokens: SessionTokens }> {
    // Registration lowercases the address before storing it, so an exact-match
    // lookup locked out anyone who typed a capital letter when signing up —
    // their own address was reported as "invalid email or password", with no
    // forgot-password route to recover through.
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
    // Frozen contract: 400 ValidationError (message is a list) on any login failure.
    if (!user || !this.passwords.verify(password, user.password) || !user.isActive) {
      this.audit.loginFailure(email);
      throw new BadRequestException({ message: ['Invalid email or password'], type: 'ValidationError' });
    }
    const tokens = await this.issueSession(user.id);
    this.audit.loginSuccess(user.id, user.email);
    return { user: await this.userMapper.toResponse(user), sessionId: tokens.refreshJti, tokens };
  }

  async register(dto: RegisterDto): Promise<{ user: UserResponse; sessionId: string; tokens: SessionTokens }> {
    const email = normalizeEmail(dto.email);
    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existing) {
      throw new BadRequestException({
        message: { email: ['A user with this email already exists'] },
        type: 'ValidationError',
      });
    }
    const user = await this.prisma.user.create({
      data: {
        id: generateId(),
        email,
        password: this.passwords.hash(dto.password),
        name: dto.name,
        phone: dto.phone ?? '',
        // Never from the request body — see the note on RegisterDto. A membership
        // is what grants access, and that is created by the invite flow.
        workspaceId: '',
      },
    });
    const tokens = await this.issueSession(user.id);
    this.audit.registered(user.id, user.email);
    return { user: await this.userMapper.toResponse(user), sessionId: tokens.refreshJti, tokens };
  }

  // --- refresh / logout ---------------------------------------------------

  async refresh(refreshToken?: string): Promise<{ tokens: SessionTokens } | SoftError> {
    if (!refreshToken) {
      this.audit.refreshRejected('missing');
      return { softError: { status: 401, message: 'Missing refresh token' } };
    }
    let claims;
    try {
      claims = this.tokens.verify(refreshToken);
    } catch {
      this.audit.refreshRejected('invalid_signature');
      return { softError: { status: 401, message: 'Invalid refresh token' } };
    }
    if (claims.token_type !== 'refresh') {
      this.audit.refreshRejected('wrong_type');
      return { softError: { status: 401, message: 'Invalid refresh token' } };
    }
    // An explicitly revoked token is dead in BOTH modes. Compatibility mode only
    // exists so a token that predates Redis tracking still works; it was never
    // meant to resurrect one the user has logged out of.
    if (await this.refreshStore.isRevoked(claims.user_id, claims.jti)) {
      this.audit.refreshRejected('revoked_jti');
      return { softError: { status: 401, message: 'Invalid refresh token' } };
    }
    // Compatibility mode accepts any signature-valid refresh token; strict mode requires the jti to be tracked in Redis.
    const strict = this.config.get<boolean>('AUTH_STRICT_REFRESH', false);
    if (strict && !(await this.refreshStore.isActive(claims.user_id, claims.jti))) {
      this.audit.refreshRejected('revoked_or_unknown_jti');
      return { softError: { status: 401, message: 'Invalid refresh token' } };
    }
    await this.refreshStore.revoke(claims.user_id, claims.jti); // rotate: kill the old token
    const tokens = await this.issueSession(claims.user_id);
    this.audit.refreshRotated(claims.user_id);
    return { tokens };
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    try {
      const claims = this.tokens.verify(refreshToken);
      await this.refreshStore.revoke(claims.user_id, claims.jti);
      this.audit.logout(claims.user_id);
    } catch {
      /* already invalid — nothing to revoke */
    }
  }

  // --- profile / password -------------------------------------------------

  async me(user: User): Promise<{
    user: UserResponse;
    session: { id: string; userId: string; current: boolean };
    workspaceIds: string[];
    hasTempPassword: boolean;
    isAdmin: boolean;
  }> {
    // The /me endpoint intentionally queries memberships WITHOUT a status filter, so a user sees every workspace they belong to regardless of membership state.
    const rows = await this.prisma.workspaceMember.findMany({
      where: { userId: user.id },
      select: { workspaceId: true },
    });
    return {
      user: await this.userMapper.toResponse(user),
      session: { id: String(user.id), userId: String(user.id), current: true },
      workspaceIds: rows.map((r) => r.workspaceId),
      hasTempPassword: user.hasTempPassword,
      isAdmin: user.isAdminFlag || user.isSuperuser,
    };
  }

  async changePassword(user: User, dto: ChangePasswordDto): Promise<{ ok: true } | SoftError> {
    if (!this.passwords.verify(dto.currentPassword, user.password)) {
      return { softError: { status: 400, message: 'Current password is incorrect' } };
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: this.passwords.hash(dto.newPassword), hasTempPassword: false },
    });
    this.audit.passwordChanged(user.id);
    return { ok: true };
  }

  async updateProfile(user: User, dto: UpdateProfileDto): Promise<UserResponse> {
    const data: { name?: string; phone?: string; avatar?: string } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.phone !== undefined) data.phone = dto.phone.trim();
    if (dto.avatar !== undefined) data.avatar = dto.avatar;
    const updated = Object.keys(data).length
      ? await this.prisma.user.update({ where: { id: user.id }, data })
      : user;
    return this.userMapper.toResponse(updated);
  }

  // --- password reset -----------------------------------------------------

  async requestPasswordReset(email: string): Promise<{ ok: true }> {
    // Constant-time contract: always {ok:true}, never reveal existence.
    this.audit.passwordResetRequested(email);
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (user && user.isActive) {
      const token = await this.resetStore.issue(user.id);
      const uid = toBase64Url(user.id);
      const base = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
      await this.mail.sendPasswordReset(user.email, `${base}/reset-password?uid=${uid}&token=${token}`);
    }
    return { ok: true };
  }

  async confirmPasswordReset(dto: PasswordResetConfirmDto): Promise<{ ok: true } | SoftError> {
    let userId: string;
    try {
      userId = fromBase64Url(dto.uid);
    } catch {
      return { softError: { status: 400, message: 'Invalid reset link' } };
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { softError: { status: 400, message: 'Invalid reset link' } };
    if (!(await this.resetStore.consume(userId, dto.token))) {
      return { softError: { status: 400, message: 'Invalid or expired token' } };
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: this.passwords.hash(dto.newPassword), hasTempPassword: false },
    });
    this.audit.passwordResetCompleted(user.id);
    return { ok: true };
  }
}
