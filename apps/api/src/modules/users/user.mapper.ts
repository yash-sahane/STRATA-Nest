import { Injectable } from '@nestjs/common';
import { toDjangoIso } from '@lt/common';
import { PrismaService } from '@lt/prisma';
import type { User } from '@prisma/client';

/**
 * The frozen `<User>` wire shape (A§5.1 UserSerializer). Key ORDER mirrors the
 * Django serializer output (createdAt/updatedAt appended last by the base
 * serializer's pop). `isAdmin` = is_admin_flag (NOT superuser) per UserSerializer.
 */
export interface UserResponse {
  id: string;
  email: string;
  userEmail: string;
  name: string;
  phone: string;
  avatar: string;
  role: string;
  workspaceId: string;
  defaultWorkspaceId: string;
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

  /** workspaceIds for the User serializer — filters status=ACTIVE (A§5.1). */
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
      userEmail: user.email,
      name: user.name,
      phone: user.phone,
      avatar: user.avatar,
      role: user.role,
      workspaceId: user.workspaceId,
      defaultWorkspaceId: user.workspaceId,
      workspaceIds,
      status: user.status,
      hasTempPassword: user.hasTempPassword,
      isAdmin: user.isAdminFlag,
      createdAt: toDjangoIso(user.createdAt),
      updatedAt: toDjangoIso(user.updatedAt),
    };
  }
}
