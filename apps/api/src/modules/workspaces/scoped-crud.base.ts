import { NotFoundException } from '@nestjs/common';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@lt/common';
import type { PaginatedResponse } from '@lt/shared';
import { PrismaService } from '@lt/prisma';
import type { User } from '@prisma/client';
import type { PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';

interface Delegate {
  findMany(args: unknown): Promise<unknown[]>;
  findFirst(args: unknown): Promise<unknown>;
  count(args: unknown): Promise<number>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  delete(args: unknown): Promise<unknown>;
}

/**
 * Workspace-scoped CRUD base for the thin collections. Reproduces Django's
 * membership-scoped reads (out-of-scope detail → 404) and enforces the write
 * permission via WorkspaceAccessService (RBAC flag aware). Concrete services
 * supply the Prisma model name, list spec, write permission, and row mapper.
 */
export abstract class ScopedCrudService<TRow extends { workspaceId?: string }, TResponse> {
  protected abstract readonly model: string;
  protected abstract readonly spec: ListQuerySpec;
  protected abstract readonly writePermission: PermissionKey;
  protected readonly scopeField: string = 'workspaceId';
  protected abstract map(row: TRow): TResponse;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly access: WorkspaceAccessService,
  ) {}

  private get delegate(): Delegate {
    return (this.prisma as unknown as Record<string, Delegate>)[this.model];
  }

  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<TResponse>> {
    const scope = await this.access.scopeWhere(user, this.scopeField);
    const parsed = parseListQuery(query, this.spec);
    const where = { AND: [scope, parsed.where] };
    const [rows, total] = await Promise.all([
      this.delegate.findMany({ where, orderBy: parsed.orderBy, skip: parsed.skip, take: parsed.take }),
      this.delegate.count({ where }),
    ]);
    return paginate(
      (rows as TRow[]).map((r) => this.map(r)),
      total,
      parsed.page,
      parsed.pageSize,
    );
  }

  async retrieve(user: User, id: string): Promise<TResponse> {
    return this.map(await this.findScoped(user, id));
  }

  async remove(user: User, id: string): Promise<void> {
    const row = await this.findScoped(user, id);
    await this.access.assertPermission(user, this.workspaceOf(row), this.writePermission);
    await this.delegate.delete({ where: { id } });
  }

  async update(user: User, id: string, data: Record<string, unknown>): Promise<TResponse> {
    const row = await this.findScoped(user, id);
    await this.access.assertPermission(user, this.workspaceOf(row), this.writePermission);
    return this.map((await this.delegate.update({ where: { id }, data })) as TRow);
  }

  /** Create in a workspace after asserting the write permission there. */
  protected async createIn(
    user: User,
    workspaceId: string,
    data: Record<string, unknown>,
  ): Promise<TResponse> {
    await this.access.assertPermission(user, workspaceId, this.writePermission);
    const row = await this.delegate.create({ data: { id: generateId(), ...data } });
    return this.map(row as TRow);
  }

  protected async findScoped(user: User, id: string): Promise<TRow> {
    const scope = await this.access.scopeWhere(user, this.scopeField);
    const row = await this.delegate.findFirst({ where: { AND: [scope, { id }] } });
    if (!row) throw new NotFoundException('Not found.');
    return row as TRow;
  }

  private workspaceOf(row: TRow): string {
    return (row as Record<string, unknown>)[this.scopeField] as string;
  }
}
