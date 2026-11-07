import { formatApiTimestamp } from '@strata/common';
import type {
  InviteCode,
  JoinRequest,
  User,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '@prisma/client';

const isoOrNull = (d: Date | null): string | null => (d ? formatApiTimestamp(d) : null);

/** Field order matches the API's frozen contract (createdAt/updatedAt appended last). */

export function workspaceResponse(w: Workspace, memberIds: string[]) {
  return {
    id: String(w.id),
    name: w.name,
    description: w.description,
    ownerId: w.ownerId,
    settings: w.settings,
    memberIds,
    createdAt: formatApiTimestamp(w.createdAt),
    updatedAt: formatApiTimestamp(w.updatedAt),
  };
}

export function memberResponse(
  m: WorkspaceMember,
  user: (Pick<User, 'email' | 'name' | 'phone' | 'avatar'> & { hasTempPassword?: boolean }) | null,
  /** Whether the reader may be told the account has not been signed in to yet. */
  showAccountState = false,
) {
  return {
    id: String(m.id),
    workspaceId: m.workspaceId,
    userId: m.userId,
    email: user?.email ?? '',
    name: user?.name ?? '',
    phone: user?.phone ?? '',
    avatar: user?.avatar ?? '',
    role: m.role,
    status: m.status,
    /** Still on the temporary password they were issued: they have never signed in. */
    awaitingFirstSignIn: showAccountState && user?.hasTempPassword === true,
    joinedAt: formatApiTimestamp(m.joinedAt),
    createdAt: formatApiTimestamp(m.createdAt),
    updatedAt: formatApiTimestamp(m.updatedAt),
  };
}

export function roleResponse(r: WorkspaceRole) {
  return {
    id: String(r.id),
    workspaceId: r.workspaceId,
    name: r.name,
    permissions: r.permissions,
    createdAt: formatApiTimestamp(r.createdAt),
    updatedAt: formatApiTimestamp(r.updatedAt),
  };
}

export function inviteCodeResponse(c: InviteCode) {
  return {
    id: String(c.id),
    workspaceId: c.workspaceId,
    code: c.code,
    role: c.role,
    maxUses: c.maxUses,
    usedCount: c.usedCount,
    expiresAt: isoOrNull(c.expiresAt),
    createdBy: c.createdById,
    createdAt: formatApiTimestamp(c.createdAt),
    updatedAt: formatApiTimestamp(c.updatedAt),
  };
}

/**
 * `requester` is what makes the approve/decline queue answerable: the person
 * asking is by definition NOT a member of the target workspace, so no client
 * roster can ever resolve `userId` — every card read "Unknown user". The keys
 * are always emitted (blank when the account is gone) so the hydrating
 * overrides in JoinRequestsService can fill them in without disturbing the
 * frozen field order.
 *
 * `alreadyMember` is the same idea for a request that reality has overtaken:
 * the requester can have been let in by another door (an invite code, a
 * direct add) since they asked. Emitted `false` here and filled in by
 * the same hydration, so a manager is never offered an approve/decline decision
 * without being told it has already been settled.
 *
 * `previousRole` is the role of a membership that was switched off: the
 * requester is not new here, and the approver should see what they were.
 * Null for anybody else; filled in by the same hydration.
 */
export function joinRequestResponse(
  j: JoinRequest,
  requester?: Pick<User, 'name' | 'email' | 'avatar'> | null,
) {
  return {
    id: String(j.id),
    workspaceId: j.workspaceId,
    userId: j.userId,
    userName: requester?.name ?? '',
    userEmail: requester?.email ?? '',
    userAvatar: requester?.avatar ?? '',
    message: j.message,
    status: j.status,
    alreadyMember: false,
    previousRole: null as string | null,
    handledBy: j.handledById,
    createdAt: formatApiTimestamp(j.createdAt),
    updatedAt: formatApiTimestamp(j.updatedAt),
  };
}
