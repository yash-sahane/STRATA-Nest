import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'node:crypto';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@strata/common';
import { WorkspaceEvents, type PaginatedResponse } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { MailService } from '../mail/mail.service';
import { PasswordService } from '../auth/services/password.service';
import { RefreshTokenStore } from '../auth/services/refresh-token.store';
import { UserDeactivationService } from '../deletion/user-deactivation.service';
import { joinsWithoutBeingAsked } from '../workspaces/invitation-consent';
import { closePendingJoinRequests } from '../workspaces/join-request-sync';
import type { InviteUserDto, UpdateUserDto } from './dto';
import { UserMapper, type UserResponse } from './user.mapper';

const USER_ROLES = new Set([
  'MANAGER',
  'ASSISTANT_MANAGER',
  'SOFTWARE_DEVELOPER',
  'DEVELOPER_INTERN',
  'TESTER',
  'CONTENT_ENGINEER',
  'MEMBER',
]);

const USER_STATUSES = new Set(['ACTIVE', 'INACTIVE']);

const USER_LIST_SPEC: ListQuerySpec = {
  filterable: {
    email: { field: 'email' },
    name: { field: 'name' },
    role: { field: 'role' },
    status: { field: 'status' },
    workspaceId: { field: 'workspaceId' },
  },
  sortable: { createdAt: 'createdAt', name: 'name', email: 'email' },
  defaultOrderBy: { createdAt: 'desc' },
};

export type SoftError = { softError: { status: number; message: string } };
export type InviteResult = SoftError | { status: number; body: Record<string, unknown> };

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userMapper: UserMapper,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
    private readonly sessions: RefreshTokenStore,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Switching an account off is UserDeactivationService's job — memberships,
   * sessions, the owner and last-manager rules. Looked up when needed rather
   * than injected: DeletionModule imports AuthModule, which imports this module,
   * so importing DeletionModule here would close a module cycle. `strict: false`
   * finds the one instance DeletionModule already holds.
   */
  private get deactivation(): UserDeactivationService {
    return this.moduleRef.get(UserDeactivationService, { strict: false });
  }

  /**
   * The directory rows as THIS caller may read them: their own in full, a
   * colleague's reduced to what a colleague is — see UserMapper.asSeenBy. A
   * platform administrator, who can already administer every account, reads
   * them whole.
   */
  private async forCaller(caller: User, rows: UserResponse[]): Promise<UserResponse[]> {
    if (this.isPlatformAdmin(caller)) return rows;
    const mine = new Set(await this.userMapper.activeWorkspaceIds(caller.id));
    return rows.map((row) => (row.id === caller.id ? row : this.userMapper.asSeenBy(mine, row)));
  }

  /** Same event every other way into a workspace emits: it is what tells the
   *  person (a notification), the audit trail and their open sockets. */
  private emitMemberAdded(workspaceId: string, userId: string, role: string, actorId: string): void {
    this.events.emit(WorkspaceEvents.MemberAdded, {
      name: WorkspaceEvents.MemberAdded,
      workspaceId,
      payload: { workspaceId, userId, role, via: 'direct', actorId },
      occurredAt: new Date().toISOString(),
    });
  }

  /** The person is told — in the inbox and by mail — and the audit trail records who asked. */
  private emitMemberInvited(workspaceId: string, userId: string, role: string, caller: User): void {
    this.events.emit(WorkspaceEvents.MemberInvited, {
      name: WorkspaceEvents.MemberInvited,
      workspaceId,
      payload: { workspaceId, userId, role, actorId: caller.id, inviterName: caller.name || caller.email },
      occurredAt: new Date().toISOString(),
    });
  }

  private isPlatformAdmin(user: User): boolean {
    return user.isSuperuser || user.isAdminFlag;
  }

  /** Prisma `where` restricting the User set to the caller's directory. */
  private async directoryScope(caller: User): Promise<Prisma.UserWhereInput> {
    if (this.isPlatformAdmin(caller)) return {};
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId: caller.id, status: 'ACTIVE' },
      select: { workspaceId: true },
    });
    const wsIds = memberships.map((m) => m.workspaceId);
    const peers = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: { in: wsIds } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const ids = Array.from(new Set([...peers.map((p) => p.userId), caller.id]));
    return { id: { in: ids } };
  }

  async list(
    caller: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<UserResponse>> {
    const scope = await this.directoryScope(caller);
    const parsed = parseListQuery(query, USER_LIST_SPEC);
    const where: Prisma.UserWhereInput = { AND: [scope, parsed.where as Prisma.UserWhereInput] };
    const orderBy = parsed.orderBy as
      | Prisma.UserOrderByWithRelationInput
      | Prisma.UserOrderByWithRelationInput[];
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, orderBy, skip: parsed.skip, take: parsed.take }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(
      await this.forCaller(caller, await this.userMapper.toResponseMany(items)),
      total,
      parsed.page,
      parsed.pageSize,
    );
  }

  async retrieve(caller: User, id: string): Promise<UserResponse> {
    const scope = await this.directoryScope(caller);
    const user = await this.prisma.user.findFirst({ where: { AND: [scope, { id }] } });
    if (!user) throw new NotFoundException('That user does not exist here.');
    const [seen] = await this.forCaller(caller, [await this.userMapper.toResponse(user)]);
    return seen;
  }

  /**
   * Give somebody a new temporary password.
   *
   * A new account's first password exists in exactly one place — the welcome
   * mail, or, where mail is not delivered, the screen of the manager who
   * created the account. Lose that (a mail filtered away, a dialog closed too
   * soon) and nobody could ever sign in: there was no second copy and no way to
   * make one, short of deleting the person and adding them again.
   *
   * Who may:
   *  - a platform administrator, for anybody but themselves;
   *  - somebody who manages members in EVERY workspace the person belongs to,
   *    and is outranked by them in none — and only while the account is STILL
   *    on its temporary password. Once a person has set their own, their
   *    account is theirs, and "forgot password" is how its owner gets back in.
   *
   * "Every workspace", because an account is one person wherever they work.
   * Asking only about the workspace named in the request let a manager of one
   * workspace take over a manager of another: add the not-yet-used account to
   * your own workspace (an existing account is added without being asked),
   * re-issue its password here, sign in as it — and hold whatever role it has
   * everywhere else.
   *
   * The new password replaces the old at once and signs the account out
   * everywhere. It is mailed to the person; where mail is not delivered it is
   * handed back, once, to whoever asked — the same rule as creating an account.
   */
  async reissueTempPassword(
    caller: User,
    userId: string,
    workspaceId: string,
  ): Promise<{ success: true; userId: string; emailSent: boolean; temporaryPassword?: string }> {
    if (userId === caller.id) {
      throw new BadRequestException('Change your own password from your profile.');
    }
    const membership = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    });
    const target = membership
      ? await this.prisma.user.findUnique({ where: { id: userId } })
      : null;
    // One answer for "no such person" and "not in that workspace": the id of an
    // account elsewhere is not something this route should confirm.
    if (!membership || !target) throw new NotFoundException('That user does not exist here.');

    if (!this.isPlatformAdmin(caller)) {
      // INVITED counts: an account a manager made for somebody is invited, and
      // it is accepted by signing in — so a first password lost on the way
      // would otherwise lock it out of the one step that lets it in. The rules
      // below still hold it: only while it is on a temporary password, and only
      // for whoever manages every other workspace it belongs to.
      if (membership.status !== 'ACTIVE' && membership.status !== 'INVITED') {
        throw new ForbiddenException(
          'This person’s access to this workspace is switched off, so it is not this workspace’s to give them a password.',
        );
      }
      await this.access.assertPermission(caller, workspaceId, Permission.MemberUpdate);
      await this.access.assertNotOutranked(caller, workspaceId, membership.role);
      if (target.isSuperuser || target.isAdminFlag) {
        throw new ForbiddenException('Only a platform administrator can reset this account.');
      }
      if (!target.hasTempPassword) {
        throw new ForbiddenException(
          'This person has already set their own password, so it is theirs to reset — from "Forgot password" on the sign-in page, or by a platform administrator.',
        );
      }
      const elsewhere = await this.prisma.workspaceMember.findMany({
        where: { userId: target.id, workspaceId: { not: workspaceId } },
        select: { workspaceId: true, role: true },
      });
      for (const other of elsewhere) {
        const hasSay =
          (await this.access.can(caller, other.workspaceId, Permission.MemberUpdate)) &&
          !(await this.access.outranked(caller, other.workspaceId, other.role));
        if (!hasSay) {
          throw new ForbiddenException(
            'This person also belongs to a workspace you do not manage, so only a platform administrator can issue them a new password.',
          );
        }
      }
    }

    const tempPassword = this.tempPassword();
    await this.prisma.user.update({
      where: { id: target.id },
      data: { password: await this.passwords.hash(tempPassword), hasTempPassword: true },
    });
    await this.sessions.revokeAll(target.id);
    await this.mail.sendTemporaryPassword(
      target.email,
      target.name,
      tempPassword,
      caller.name || caller.email,
    );
    const emailSent = this.mail.delivers;
    return {
      success: true,
      userId: target.id,
      emailSent,
      ...(emailSent ? {} : { temporaryPassword: tempPassword }),
    };
  }

  async update(caller: User, id: string, dto: UpdateUserDto): Promise<UserResponse | SoftError> {
    const scope = await this.directoryScope(caller);
    const target = await this.prisma.user.findFirst({ where: { AND: [scope, { id }] } });
    if (!target) throw new NotFoundException('That user does not exist here.');
    if (target.id !== caller.id && !this.isPlatformAdmin(caller)) {
      return { softError: { status: 403, message: 'Forbidden' } }; // plain {message} 403 body (frozen contract)
    }
    const data: Prisma.UserUpdateInput = {};
    let switchingOff = false;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.avatar !== undefined) data.avatar = dto.avatar;
    // role/status/workspaceId/email are directory + identity columns, not
    // profile fields: self-service editing must never write them (an unverified
    // self-service e-mail change rebinds the login identity), and the values
    // are constrained rather than free text.
    const privileged =
      dto.role !== undefined ||
      dto.status !== undefined ||
      dto.workspaceId !== undefined ||
      dto.email !== undefined;
    if (privileged) {
      if (!this.isPlatformAdmin(caller)) {
        return { softError: { status: 403, message: 'Forbidden' } };
      }
      if (dto.role !== undefined) {
        if (!USER_ROLES.has(dto.role)) {
          return { softError: { status: 400, message: `Unknown role "${dto.role}".` } };
        }
        data.role = dto.role;
      }
      if (dto.status !== undefined) {
        if (!USER_STATUSES.has(dto.status)) {
          return { softError: { status: 400, message: `Unknown status "${dto.status}".` } };
        }
        // Nothing here can undo it: an admin who switches their own account off
        // is refused at the next request, this one included.
        if (dto.status !== 'ACTIVE' && target.id === caller.id) {
          return { softError: { status: 400, message: 'You cannot deactivate your own account.' } };
        }
        data.status = dto.status;
        // `status` is the label; `isActive` is what login, the JWT guard and the
        // socket gateway actually test. Writing one without the other showed an
        // account as Inactive while it went on signing in.
        data.isActive = dto.status === 'ACTIVE';
        // Switching back ON is the flag alone: the memberships the switch-off
        // turned off stay off until each workspace switches its member back on.
        switchingOff = dto.status !== 'ACTIVE';
      }
      if (dto.workspaceId !== undefined) data.workspaceId = dto.workspaceId;
      if (dto.email !== undefined) data.email = dto.email.toLowerCase();
    }
    // Switching off is more than the flag. Only the flag used to change: every
    // membership stayed ACTIVE, so a disabled account still counted as an
    // approver and as a manager for the last-manager rule, sat in the assignee
    // pickers and was sent notices. The deactivation switches the memberships
    // off and ends the sessions — or refuses the whole edit, before anything is
    // written, for a workspace's owner or last manager. Asked again of an
    // account that is already off, it puts right one switched off before this.
    if (switchingOff) await this.deactivation.deactivate(caller, target.id);
    const updated = Object.keys(data).length
      ? await this.prisma.user.update({ where: { id: target.id }, data })
      : target;
    return this.userMapper.toResponse(updated);
  }

  async invite(caller: User, dto: InviteUserDto): Promise<InviteResult> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: dto.workspaceId } });
    if (!workspace) return { softError: { status: 404, message: 'Workspace not found' } };

    // Inviting mints a membership with the caller-supplied role — INVITED until
    // the person accepts, unless they had already asked to join (see
    // invitation-consent) — so it requires member:invite — not merely "is a
    // member" — and the role must be
    // one the workspace actually defines (an unknown one silently resolves to
    // the read-only floor). No owner exemption: an owner whose access had been
    // switched off, or whose role no longer adds people, went on creating
    // accounts through it.
    if (!this.isPlatformAdmin(caller)) {
      await this.access.assertPermission(caller, workspace.id, Permission.MemberInvite);
    }

    const roleName = dto.roleName ?? 'MEMBER';
    await this.access.assertValidRole(workspace.id, roleName);
    // "At what role", from the role the caller holds now.
    await this.access.assertCanGrantRole(caller, workspace.id, roleName);
    // Read from the database, never from the request: this string goes into
    // the subject of a mail sent from the product's own address.
    const workspaceName = workspace.name;
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    if (existing) {
      const already = await this.prisma.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: existing.id },
      });
      if (already) {
        return {
          softError: {
            status: 400,
            message:
              already.status === 'INVITED'
                ? 'They have already been invited to this workspace and have not answered yet.'
                : 'User is already a member of this workspace',
          },
        };
      }
      // Somebody else's add is a question, not a fact: the person is invited and
      // joins when they accept. Unless they had asked to join already.
      const joinsNow = await joinsWithoutBeingAsked(
        this.prisma,
        this.isPlatformAdmin(caller),
        workspace.id,
        existing.id,
      );
      if (!joinsNow) {
        await this.prisma.workspaceMember.create({
          data: {
            id: generateId(),
            workspaceId: workspace.id,
            userId: existing.id,
            role: roleName,
            status: 'INVITED',
          },
        });
        // The notice the event raises carries its own mail copy.
        this.emitMemberInvited(workspace.id, existing.id, roleName, caller);
        return this.added(existing.id, undefined, true);
      }
      // Adding somebody answers a request they had raised to join, so it is
      // settled in the same commit — exactly as a direct add does.
      await this.prisma.$transaction([
        this.prisma.workspaceMember.create({
          data: {
            id: generateId(),
            workspaceId: workspace.id,
            userId: existing.id,
            role: roleName,
            status: 'ACTIVE',
          },
        }),
        closePendingJoinRequests(this.prisma, workspace.id, existing.id, caller.id),
      ]);
      this.emitMemberAdded(workspace.id, existing.id, roleName, caller.id);
      await this.mail.sendWorkspaceInvitation(
        existing.email,
        workspaceName,
        caller.name || caller.email,
        workspace.id,
      );
      return this.added(existing.id, undefined, false);
    }

    const tempPassword = this.tempPassword();
    const newUser = await this.prisma.user.create({
      data: {
        id: generateId(),
        email,
        password: await this.passwords.hash(tempPassword),
        name: dto.name,
        role: USER_ROLES.has(roleName) ? roleName : 'MEMBER',
        workspaceId: workspace.id,
        hasTempPassword: true,
      },
    });
    // A new account is invited like an existing one — see invitation-consent:
    // were it ACTIVE at once, the roster would tell whoever added it which
    // addresses already had an account. It has never asked to join anything,
    // so only a platform administrator's add takes effect at once.
    const joinsNow = this.isPlatformAdmin(caller);
    await this.prisma.workspaceMember.create({
      data: {
        id: generateId(),
        workspaceId: workspace.id,
        userId: newUser.id,
        role: roleName,
        status: joinsNow ? 'ACTIVE' : 'INVITED',
      },
    });
    if (joinsNow) this.emitMemberAdded(workspace.id, newUser.id, roleName, caller.id);
    else this.emitMemberInvited(workspace.id, newUser.id, roleName, caller);
    await this.mail.sendWelcome(newUser.email, newUser.name, tempPassword);
    /**
     * The temporary password exists in exactly one place: the welcome mail. Where
     * mail cannot be delivered (no RESEND_API_KEY — the default — the worker logs
     * the subject and drops the body) the account was created and nobody on earth
     * could sign in to it, while the caller was told "welcome email sent". With
     * onboarding closed this is the ONLY way an account comes to exist.
     *
     * So when the mail will not arrive, the password is handed back, once, to the
     * manager who created the account, to pass on themselves. It is single-use in
     * effect: `hasTempPassword` locks the session to the change-password screen
     * until it is replaced. When mail does deliver, it is never returned.
     */
    return this.added(newUser.id, this.mail.delivers ? undefined : tempPassword, !joinsNow);
  }

  /**
   * The one answer for both kinds of add — a new account, or one that existed.
   *
   * It used to say which: 200 "Workspace invitation sent to existing user"
   * against 201 "User created successfully", with a `type` to match. So anybody
   * holding `member:invite` in any workspace could learn whether an address had
   * an account ANYWHERE on the platform, in tenants they have nothing to do
   * with. Now the status, the keys and the words are the same either way.
   *
   * The one difference left is the temporary password, and only where mail
   * cannot be delivered: a new account has to be handed one or nobody can ever
   * sign in to it, and an existing account must never be.
   *
   * `invited` says whether the person still has to accept. It is the same for a
   * new account and an existing one: both are invited unless a platform
   * administrator added them, or (an existing account only, and for a reason
   * the caller already knows) they had asked to join.
   */
  private added(userId: string, temporaryPassword: string | undefined, invited: boolean): InviteResult {
    return {
      status: 201,
      body: {
        success: true,
        userId,
        invited,
        message: invited ? 'Invitation sent' : 'Added to the workspace',
        emailSent: this.mail.delivers,
        ...(temporaryPassword ? { temporaryPassword } : {}),
      },
    };
  }

  /**
   * A temporary password that satisfies PASSWORD_RULES — the same policy the
   * invited user's own replacement is held to. Twelve independent draws from
   * one 62-character alphabet omit a digit about 11% of the time, so the old
   * version handed roughly one invitee in nine a password the server would
   * refuse if they typed it themselves.
   */
  private tempPassword(length = 12): string {
    const LOWER = 'abcdefghijklmnopqrstuvwxyz';
    const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const DIGITS = '0123456789';
    const all = LOWER + UPPER + DIGITS;
    // One guaranteed character per class, then fill, then shuffle so the
    // guaranteed ones are not always in the first three positions.
    const classes = [LOWER, UPPER, DIGITS];
    const size = Math.max(length, classes.length);
    const pools = [...classes, ...Array<string>(size - classes.length).fill(all)];
    const bytes = randomBytes(size * 2);
    const chars = pools.map((pool, i) => pool[bytes[i] % pool.length]);
    // Fisher-Yates, drawing from the second half of the entropy.
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = bytes[size + i] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }
}
