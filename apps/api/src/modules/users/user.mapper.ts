import { Injectable } from '@nestjs/common';
import { formatApiTimestamp } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';

/**
 * The public `<User>` wire shape. Key ORDER matters: createdAt/updatedAt
 * are appended last. `isAdmin` = is_admin_flag (NOT superuser).
 */
export interface UserResponse {
  id: string;
  email: string;
  name: string;
  phone: string;
  avatar: string;
  role: string;
  /** The workspace the user lands in. */
  workspaceId: string;
  workspaceIds: string[];
  status: string;
  hasTempPassword: boolean;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class UserMapper {
  constructor(private readonly prisma: PrismaService) {}

  async toResponse(user: User): Promise<UserResponse> {
    return this.build(user, await this.activeWorkspaceIds(user.id));
  }

  async toResponseMany(users: User[]): Promise<UserResponse[]> {
    const rows = await this.prisma.workspaceMember.findMany({
      where: { userId: { in: users.map((u) => u.id) }, status: 'ACTIVE' },
      select: { userId: true, workspaceId: true },
    });
    const byUser = new Map<string, string[]>();
    for (const r of rows) {
      const list = byUser.get(r.userId) ?? [];
      list.push(r.workspaceId);
      byUser.set(r.userId, list);
    }
    return users.map((u) => this.build(u, byUser.get(u.id) ?? []));
  }

  /**
   * A colleague, as somebody who shares a workspace with them may see them.
   *
   * The directory handed every member the full account record of everybody
   * they shared one workspace with: every OTHER workspace that person belongs
   * to, which one they open by default, whether they are a platform
   * administrator, and whether they have yet to replace a temporary password.
   * None of it is the reader's business, and the last two tell an attacker
   * which accounts are worth the effort and which can still be walked into
   * with a password that was sent by mail.
   *
   * What a colleague is to a colleague is a name, a way to reach them, and the
   * workspaces the two of them are both in.
   */
  asSeenBy(viewerWorkspaceIds: ReadonlySet<string>, response: UserResponse): UserResponse {
    const shared = response.workspaceIds.filter((id) => viewerWorkspaceIds.has(id));
    const home = viewerWorkspaceIds.has(response.workspaceId) ? response.workspaceId : '';
    return {
      ...response,
      workspaceId: home,
      workspaceIds: shared,
      hasTempPassword: false,
      isAdmin: false,
    };
  }

  /** workspaceIds for the User serializer — filters status=ACTIVE. */
  async activeWorkspaceIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.workspaceMember.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { workspaceId: true },
    });
    return rows.map((r) => r.workspaceId);
  }

  private build(user: User, workspaceIds: string[]): UserResponse {
    return {
      id: String(user.id),
      email: user.email,
      name: user.name,
      phone: user.phone,
      avatar: user.avatar,
      role: user.role,
      workspaceId: user.workspaceId,
      workspaceIds,
      status: user.status,
      hasTempPassword: user.hasTempPassword,
      isAdmin: user.isAdminFlag,
      createdAt: formatApiTimestamp(user.createdAt),
      updatedAt: formatApiTimestamp(user.updatedAt),
    };
  }
}
