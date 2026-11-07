import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId } from '@strata/common';
import { WorkspaceEvents } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { AcceptInvitationDto } from './dto';
import { closePendingJoinRequests } from './join-request-sync';

export interface JoinResult {
  success: true;
  workspaceId: string;
  role?: string;
  userId?: string;
  membershipId: string;
}

function emit(events: EventEmitter2, name: string, workspaceId: string, payload: Record<string, unknown>): void {
  events.emit(name, { name, workspaceId, payload, occurredAt: new Date().toISOString() });
}

/**
 * Application service: redeeming an invite code is a cross-aggregate workflow
 * (the code's seat count + the membership) — one transaction, one post-commit
 * event, handled entirely server-side.
 *
 * There used to be a second kind of invitation here, addressed to one e-mail
 * and redeemed by token. Nothing in the product ever issued one — no screen
 * created them and nothing mailed the token — so the path existed only for a
 * secret an admin would have had to read out of the API by hand. People are
 * brought in by being added directly, by a code, or by asking to join.
 */
@Injectable()
export class InvitationAcceptanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {}

  async accept(user: User, dto: AcceptInvitationDto): Promise<JoinResult> {
    if (dto.code) return this.acceptCode(user, dto.code);
    throw new BadRequestException('Provide an invite code');
  }

  private async ensureNotMember(workspaceId: string, userId: string) {
    return this.prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
  }

  private async acceptCode(user: User, code: string): Promise<JoinResult> {
    /**
     * Normalise before the lookup.
     *
     * Codes are GENERATED uppercase (`randomBytes(8).base64url.slice(0,10).toUpperCase()`)
     * and were matched exactly, so somebody transcribing one from an e-mail in lower
     * case — or pasting it with a stray space — was told "Invalid invite code" for a
     * code that exists and is perfectly valid. The same reasoning as the e-mail
     * normalisation on login: the user's spelling of a case-insensitive secret is not
     * part of the secret.
     *
     * Lossless here because the stored form is already trimmed and uppercase.
     */
    const normalized = code.trim().toUpperCase();
    const invite = await this.prisma.inviteCode.findUnique({ where: { code: normalized } });
    if (!invite) throw new BadRequestException('Invalid invite code');
    if (invite.expiresAt && invite.expiresAt < new Date()) throw new BadRequestException('Invite code expired');
    if (invite.maxUses !== null && invite.usedCount >= invite.maxUses) {
      throw new BadRequestException('Invite code exhausted');
    }

    const existing = await this.ensureNotMember(invite.workspaceId, user.id);
    // Already a member: the code grants nothing, so incrementing `usedCount`
    // only burns capacity the real invitees need — one member re-submitting a
    // code they already redeemed could exhaust `maxUses` for everyone else.
    // The role reported back is the membership's actual role, not the code's,
    // which may differ.
    if (existing) {
      // Switched off is not "already in". This answered `success: true` for an
      // INACTIVE or INVITED row as well, so the screen said "You now have
      // access" to somebody who had none and left them guessing why.
      // Invited, and now redeeming a code for the same workspace: that is a yes.
      // The invitation is accepted, at the role it offered (somebody chose it
      // for this person; a code is for anybody), and no seat is spent.
      if (existing.status === 'INVITED') {
        await this.access.assertValidRole(invite.workspaceId, existing.role);
        const { count } = await this.prisma.workspaceMember.updateMany({
          where: { id: existing.id, status: 'INVITED' },
          data: { status: 'ACTIVE', joinedAt: new Date() },
        });
        if (count > 0) {
          await closePendingJoinRequests(this.prisma, invite.workspaceId, user.id);
          const accepted = await this.prisma.workspaceMember.findUniqueOrThrow({ where: { id: existing.id } });
          this.prisma.announceWrite?.('WorkspaceMember', 'update', accepted);
          emit(this.events, WorkspaceEvents.MemberAdded, invite.workspaceId, {
            workspaceId: invite.workspaceId,
            userId: user.id,
            role: accepted.role,
            via: 'accepted',
            actorId: user.id,
          });
          return { success: true, workspaceId: invite.workspaceId, role: accepted.role, membershipId: existing.id };
        }
        // Withdrawn in the same moment: nothing is held now, so the code can be
        // redeemed afresh.
        throw new ConflictException('Your invitation to this workspace was just withdrawn. Enter the code again to join.');
      }
      if (existing.status !== 'ACTIVE') {
        throw new ForbiddenException(
          'Your access to this workspace is switched off. Ask one of its managers to switch it back on.',
        );
      }
      await closePendingJoinRequests(this.prisma, invite.workspaceId, user.id);
      return {
        success: true,
        workspaceId: invite.workspaceId,
        role: existing.role,
        membershipId: existing.id,
      };
    }

    // The code row is the only source of the role that gets written into the
    // membership, and a role deleted or renamed since would land a membership
    // nobody can authorize — it silently falls to the read-only floor. Re-check
    // at the moment of the grant.
    await this.access.assertValidRole(invite.workspaceId, invite.role);

    const membershipId = generateId();
    /**
     * Claim a seat atomically rather than trusting the count read above.
     *
     * The `usedCount >= maxUses` check at the top of this method is a fast, clear
     * rejection — but it is check-then-act: two people redeeming the last seat at
     * the same instant both read the same count, both passed, and both joined.
     * (Reproduced: a maxUses=1 code admitted two members and left usedCount=2.)
     *
     * The conditional UPDATE below re-tests the limit inside the write. Postgres
     * takes a row lock for it, so the second transaction re-evaluates against the
     * committed count, matches no rows, and is refused. Both statements share one
     * transaction, so a membership that cannot be created gives its seat back.
     */
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.inviteCode.updateMany({
        where: {
          id: invite.id,
          ...(invite.maxUses !== null ? { usedCount: { lt: invite.maxUses } } : {}),
        },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Invite code exhausted');
      }
      await tx.workspaceMember.create({
        data: { id: membershipId, workspaceId: invite.workspaceId, userId: user.id, role: invite.role, status: 'ACTIVE' },
      });
      await closePendingJoinRequests(tx, invite.workspaceId, user.id);
    });

    emit(this.events, WorkspaceEvents.MemberAdded, invite.workspaceId, {
      workspaceId: invite.workspaceId,
      userId: user.id,
      role: invite.role,
      via: 'invite',
      actorId: user.id,
    });
    return { success: true, workspaceId: invite.workspaceId, role: invite.role, membershipId };
  }
}

/** What the second of two people deciding one request is told. */
const ALREADY_DECIDED = 'This join request has already been decided.';

/**
 * Application service: approving/rejecting a join request spans the
 * request + membership. Approver must hold `join:manage`.
 */
@Injectable()
export class JoinRequestApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {}

  private async load(user: User, requestId: string) {
    const req = await this.prisma.joinRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Not found.');
    await this.access.assertPermission(user, req.workspaceId, Permission.JoinManage);
    if (req.status !== 'PENDING') throw new BadRequestException(ALREADY_DECIDED);
    return req;
  }

  /**
   * Record the decision — but only on a request that is STILL pending.
   *
   * `load()` read the status on an earlier statement, so two managers clicking
   * at once both saw PENDING and both wrote: one approved and one declined left
   * a REJECTED request beside an ACTIVE member, with both notices sent, and two
   * approvals made the second fail on the membership's unique key with "A record
   * with these values already exists". The conditional write is the gate (as in
   * TimeApprovalService): the second statement waits on the row lock, re-reads a
   * decided row, matches nothing, and its caller is told it was already decided.
   */
  private async claim(
    db: Pick<Prisma.TransactionClient, 'joinRequest'>,
    requestId: string,
    status: 'APPROVED' | 'REJECTED',
    user: User,
  ): Promise<void> {
    const claimed = await db.joinRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status, handledById: user.id },
    });
    if (claimed.count === 0) throw new BadRequestException(ALREADY_DECIDED);
  }

  /** `updateMany` is invisible to the write hook — see PrismaService.announceWrite. */
  private async announceDecided(requestId: string): Promise<void> {
    const decided = await this.prisma.joinRequest.findUnique({ where: { id: requestId } });
    if (decided) this.prisma.announceWrite?.('JoinRequest', 'update', decided);
  }

  /**
   * Approve, at a role the approver chooses.
   *
   * Every approval used to land the requester as MEMBER — the read-only role —
   * so letting a developer in took two steps on two screens, and until the
   * second one they could open the workspace and change nothing. The role is the
   * approver's call here, under the same rank rule as any other grant.
   *
   * A requester who already holds a membership that is NOT active (deactivated
   * earlier) is switched back on: approving used to mark the request APPROVED
   * and leave them locked out, which is the one thing "approved" must never
   * mean. With no role named they come back as what they WERE — defaulting them
   * to MEMBER quietly demoted a returning manager to read-only. An ACTIVE member
   * is left exactly as they are — the request has simply been overtaken, and
   * this clears it.
   */
  async approve(user: User, requestId: string, chosenRole?: string): Promise<JoinResult> {
    const req = await this.load(user, requestId);
    const existing = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: req.workspaceId, userId: req.userId },
    });
    const role =
      chosenRole ?? (existing && existing.status !== 'ACTIVE' ? existing.role : 'MEMBER');
    await this.access.assertValidRole(req.workspaceId, role);
    await this.access.assertCanGrantRole(user, req.workspaceId, role);
    const grants = !existing || existing.status !== 'ACTIVE';
    // Somebody whose access was switched off is not a stranger asking in: a
    // manager made that decision, and undoing it is the decision the member
    // screen guards — member:update, and not over somebody who outranks you.
    // Without this an assistant manager could bring back a manager the owner
    // had switched off, simply by approving the request that manager filed.
    if (existing && existing.status !== 'ACTIVE') {
      await this.access.assertPermission(user, req.workspaceId, Permission.MemberUpdate);
      await this.access.assertNotOutranked(user, req.workspaceId, existing.role);
      // Nor is this a way round the rule that the owner's role is a platform
      // administrator's to change: bringing the owner back at another role is
      // that change.
      if (role !== existing.role && !this.access.isPlatformAdmin(user)) {
        const workspace = await this.prisma.workspace.findUnique({
          where: { id: req.workspaceId },
          select: { ownerId: true },
        });
        if (workspace?.ownerId === req.userId) {
          throw new ForbiddenException(
            'The workspace owner’s role can only be changed by a platform administrator.',
          );
        }
      }
    }
    const membershipId = existing?.id ?? generateId();
    // The claim comes FIRST in the transaction: a request somebody else has
    // just decided rolls back before any membership is written.
    await this.prisma.$transaction(async (tx) => {
      await this.claim(tx, requestId, 'APPROVED', user);
      if (!existing) {
        await tx.workspaceMember.create({
          data: { id: membershipId, workspaceId: req.workspaceId, userId: req.userId, role, status: 'ACTIVE' },
        });
      } else if (grants) {
        await tx.workspaceMember.update({
          where: { id: existing.id },
          data: { role, status: 'ACTIVE' },
        });
      }
    });
    await this.announceDecided(requestId);

    emit(this.events, WorkspaceEvents.JoinRequestApproved, req.workspaceId, {
      workspaceId: req.workspaceId,
      userId: req.userId,
      requestId,
      actorId: user.id,
    });
    if (grants) {
      emit(this.events, WorkspaceEvents.MemberAdded, req.workspaceId, {
        workspaceId: req.workspaceId,
        userId: req.userId,
        role,
        via: 'join',
        actorId: user.id,
      });
    }
    return {
      success: true,
      workspaceId: req.workspaceId,
      userId: req.userId,
      role: existing && !grants ? existing.role : role,
      membershipId,
    };
  }

  async reject(user: User, requestId: string): Promise<{ success: true }> {
    const req = await this.load(user, requestId);
    await this.claim(this.prisma, requestId, 'REJECTED', user);
    await this.announceDecided(requestId);
    emit(this.events, WorkspaceEvents.JoinRequestRejected, req.workspaceId, {
      workspaceId: req.workspaceId,
      userId: req.userId,
      requestId,
      actorId: user.id,
    });
    return { success: true };
  }
}
