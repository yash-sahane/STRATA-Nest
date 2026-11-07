import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { UserMapper, type UserResponse } from '../users/user.mapper';
import { AuthAuditService } from './auth-audit.service';
import type { ChangePasswordDto, PasswordResetConfirmDto, UpdateProfileDto } from './dto';
import { CookieService } from './services/cookie.service';
import { LoginAttemptStore } from './services/login-attempt.store';
import { PasswordService } from './services/password.service';
import { PasswordResetStore } from './services/password-reset.store';
import { RefreshTokenStore } from './services/refresh-token.store';
import { TokenService } from './services/token.service';
import { businessTimezone } from '@strata/config';
import { OnEvent } from '@nestjs/event-emitter';
import { AuthEvents, type DomainEvent, type SessionsRevokedPayload } from '@strata/shared';

export interface SessionTokens {
  access: string;
  refresh: string;
  refreshJti: string;
}
export type SoftError = { softError: { status: number; message: string } };

/** Where change-password's wrong answers are counted, in place of a client address. */
const CHANGE_PASSWORD_ATTEMPTS = 'change-password';

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
 * treats them that way (`mode: 'insensitive'`). Account creation and login must
 * agree on one form or a capital letter in the invited address locks it out.
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
    private readonly attempts: LoginAttemptStore,
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

  // --- login ---------------------------------------------------------------

  async login(
    email: string,
    password: string,
    address = 'unknown',
  ): Promise<{ user: UserResponse; sessionId: string; tokens: SessionTokens }> {
    // Addresses are stored lowercased, so an exact-match lookup locked out
    // anyone who typed a capital letter — their own address was reported as
    // "invalid email or password", with no forgot-password route to recover
    // through.
    const emailKey = normalizeEmail(email);
    // Too many wrong guesses at THIS account from here, or from everywhere
    // together — see LoginAttemptStore. Asked before the password is looked at,
    // so the pause holds for a correct guess too: otherwise it would only slow
    // an attacker down for as long as they kept being wrong.
    const wait = await this.attempts.lockedFor(emailKey, address);
    if (wait > 0) {
      this.audit.loginFailure(email);
      const minutes = Math.ceil(wait / 60);
      throw new HttpException(
        {
          message: `Too many failed sign-in attempts for this account. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, or reset your password.`,
          type: 'TooManyAttempts',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.prisma.user.findUnique({ where: { email: emailKey } });
    // The hash is paid for whether or not the address has an account (see
    // PasswordService.verifyDecoy): skipping it for an unknown one made the
    // response time an answer to "does this person work here?".
    const verified = user
      ? await this.passwords.verify(password, user.password)
      : await this.passwords.verifyDecoy(password);
    // Frozen contract: 400 ValidationError (message is a list) on any login failure.
    if (!user || !verified || !user.isActive) {
      await this.attempts.recordFailure(emailKey, address);
      this.audit.loginFailure(email);
      throw new BadRequestException({ message: ['Invalid email or password'], type: 'ValidationError' });
    }
    await this.attempts.clear(emailKey);
    // A hash made with fewer iterations than today's is replaced while the
    // password is in hand — the only moment it can be. Best effort: signing in
    // never fails over it.
    if (this.passwords.needsRehash(user.password)) {
      await this.prisma.user
        .update({ where: { id: user.id }, data: { password: await this.passwords.hash(password) } })
        .catch(() => undefined);
    }
    const tokens = await this.issueSession(user.id);
    this.audit.loginSuccess(user.id, user.email);
    return { user: await this.userMapper.toResponse(user), sessionId: tokens.refreshJti, tokens };
  }

  @OnEvent(AuthEvents.SessionsRevoked)
  async onSessionsRevoked(event: DomainEvent<SessionsRevokedPayload>): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: event.payload.userId },
      select: { email: true },
    });
    if (user) await this.attempts.clear(normalizeEmail(user.email));
  }

  // --- refresh / logout ---------------------------------------------------

  async refresh(refreshToken?: string): Promise<{ tokens: SessionTokens } | SoftError> {
    if (!refreshToken) {
      this.audit.refreshRejected('missing');
      return { softError: { status: 401, message: 'Missing refresh token' } };
    }
    let claims;
    try {
      claims = this.tokens.verifyRefresh(refreshToken);
    } catch {
      this.audit.refreshRejected('invalid_signature');
      return { softError: { status: 401, message: 'Invalid refresh token' } };
    }
    if (claims.token_type !== 'refresh') {
      this.audit.refreshRejected('wrong_type');
      return { softError: { status: 401, message: 'Invalid refresh token' } };
    }
    // Only a token the store still holds renews a session: one that was rotated,
    // logged out of, or ended by "log out everywhere" is no longer held. There
    // used to be a "compatibility" mode that accepted any signature-valid token
    // the store had not explicitly tombstoned — so one minted before tracking,
    // or surviving a Redis flush, renewed itself forever.
    if (!(await this.refreshStore.isActive(claims.user_id, claims.jti))) {
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
      const claims = this.tokens.verifyRefresh(refreshToken);
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
    businessTimezone: string;
    mailDelivers: boolean;
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
      // The zone this server files attendance days in. The browser derives "today" from
      // this rather than from its own clock: the two used to disagree, and a member in
      // Pacific/Midway saw their check-in land on a day their own calendar called
      // tomorrow — absent from the calendar, and outside the attendance-rate window.
      businessTimezone: businessTimezone(),
      // Whether a mail sent from here can reach an inbox. Screens promised
      // "notified via email" and offered email switches in an installation
      // that delivers none; the server knew, and said so to nobody.
      mailDelivers: this.mail.delivers,
    };
  }

  /**
   * Replace the password, and end every other session.
   *
   * A password is changed because the old one may be known to somebody else.
   * That somebody kept their session: nothing here revoked a refresh token, so
   * a copied cookie went on minting access for the full seven days. Now every
   * refresh token the account holds is revoked and the caller is handed a new
   * pair, so only the device that made the change stays signed in.
   */
  async changePassword(
    user: User,
    dto: ChangePasswordDto,
  ): Promise<{ ok: true; tokens: SessionTokens } | SoftError> {
    // "Current password" is a guess at the account's password like any sign-in,
    // and was the one place guessing was free: anybody holding a session — a
    // copied cookie, an unlocked laptop — could try password after password
    // here, at the request limit, and learn the real one. Wrong answers are
    // counted against the account in LoginAttemptStore under a pseudo-address of
    // their own: this form gets one address's allowance however many places it
    // is used from, and its misses count toward the account-wide ceiling — while
    // a stranger guessing at the sign-in page cannot lock the owner out of it.
    // Asked first, as at sign-in, so the pause holds for a right answer too.
    const emailKey = normalizeEmail(user.email);
    const wait = await this.attempts.lockedFor(emailKey, CHANGE_PASSWORD_ATTEMPTS, {
      accountWide: false,
    });
    if (wait > 0) {
      const minutes = Math.ceil(wait / 60);
      throw new HttpException(
        {
          message: `Too many wrong current passwords. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, or sign out and reset your password.`,
          type: 'TooManyAttempts',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!(await this.passwords.verify(dto.currentPassword, user.password))) {
      await this.attempts.recordFailure(emailKey, CHANGE_PASSWORD_ATTEMPTS);
      return { softError: { status: 400, message: 'Current password is incorrect' } };
    }
    // Only the browser refused this. Through the API, an account still on its
    // mailed temporary password could "change" it to itself — clearing
    // hasTempPassword while keeping a password that went out in plain text.
    if (dto.newPassword === dto.currentPassword) {
      return {
        softError: { status: 400, message: 'New password must be different from the current one' },
      };
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: await this.passwords.hash(dto.newPassword), hasTempPassword: false },
    });
    await this.refreshStore.revokeAll(user.id);
    const tokens = await this.issueSession(user.id);
    this.audit.passwordChanged(user.id);
    await this.mail.sendPasswordChanged(user.email, user.name, 'change');
    return { ok: true, tokens };
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

  async requestPasswordReset(email: string): Promise<{ ok: true; delivers: boolean }> {
    // Constant-time contract: always {ok:true}, never reveal existence.
    //
    // `delivers` says something about this INSTALLATION, not about the address:
    // whether it can send mail at all. Where it cannot, the screen went on to
    // say "a reset link is on its way" to somebody who would wait for it
    // forever. It is the same for every address, so it tells nobody anything
    // about an account.
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
    return { ok: true, delivers: this.mail.delivers };
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
      data: { password: await this.passwords.hash(dto.newPassword), hasTempPassword: false },
    });
    // A reset is the "somebody else may be in my account" case: sign every
    // session out. The person resetting signs in again with the new password.
    await this.refreshStore.revokeAll(user.id);
    this.audit.passwordResetCompleted(user.id);
    await this.mail.sendPasswordChanged(user.email, user.name, 'reset');
    return { ok: true };
  }
}
