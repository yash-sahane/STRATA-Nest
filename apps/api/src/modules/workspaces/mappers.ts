import { toDjangoIso } from '@lt/common';
import type {
  EmailInvitation,
  InviteCode,
  JoinRequest,
  PendingWorkspaceAccess,
  User,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '@prisma/client';

const isoOrNull = (d: Date | null): string | null => (d ? toDjangoIso(d) : null);

/** Field order mirrors the Django serializers (createdAt/updatedAt appended last). */

export function workspaceResponse(w: Workspace, memberIds: string[]) {
  return {
    id: String(w.id),
    name: w.name,
    description: w.description,
    logo: w.logo,
    color: w.color,
    ownerId: w.ownerId,
    inviteCode: w.inviteCode,
    settings: w.settings,
    memberIds,
    createdAt: toDjangoIso(w.createdAt),
    updatedAt: toDjangoIso(w.updatedAt),
  };
}

export function memberResponse(
  m: WorkspaceMember,
  user: Pick<User, 'email' | 'name' | 'phone' | 'avatar'> | null,
) {
  return {
    id: String(m.id),
    workspaceId: m.workspaceId,
    userId: m.userId,
    email: user?.email ?? '',
    name: user?.name ?? '',
    userName: user?.name ?? '',
    phone: user?.phone ?? '',
    avatar: user?.avatar ?? '',
    role: m.role,
    status: m.status,
    joinedAt: toDjangoIso(m.joinedAt),
    createdAt: toDjangoIso(m.createdAt),
    updatedAt: toDjangoIso(m.updatedAt),
  };
}

export function roleResponse(r: WorkspaceRole) {
  return {
    id: String(r.id),
    workspaceId: r.workspaceId,
    name: r.name,
    permissions: r.permissions,
    createdAt: toDjangoIso(r.createdAt),
    updatedAt: toDjangoIso(r.updatedAt),
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
    createdAt: toDjangoIso(c.createdAt),
    updatedAt: toDjangoIso(c.updatedAt),
  };
}

export function emailInvitationResponse(i: EmailInvitation) {
  return {
    id: String(i.id),
    workspaceId: i.workspaceId,
    email: i.email,
    role: i.role,
    token: i.token,
    status: i.status,
    expiresAt: toDjangoIso(i.expiresAt),
    invitedBy: i.invitedById,
    createdAt: toDjangoIso(i.createdAt),
    updatedAt: toDjangoIso(i.updatedAt),
  };
}

export function joinRequestResponse(j: JoinRequest) {
  return {
    id: String(j.id),
    workspaceId: j.workspaceId,
    userId: j.userId,
    message: j.message,
    status: j.status,
    handledBy: j.handledById,
    createdAt: toDjangoIso(j.createdAt),
    updatedAt: toDjangoIso(j.updatedAt),
  };
}

export function pendingAccessResponse(p: PendingWorkspaceAccess) {
  return {
    id: String(p.id),
    workspaceId: p.workspaceId,
    userId: p.userId,
    requestedRole: p.requestedRole,
    createdAt: toDjangoIso(p.createdAt),
    updatedAt: toDjangoIso(p.updatedAt),
  };
}
