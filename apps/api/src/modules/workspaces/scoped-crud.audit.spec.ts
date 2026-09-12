import type { ListQuerySpec } from '@strata/common';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from './scoped-crud.base';

/**
 * The audit hook lives on the base, so it is exercised through a minimal
 * concrete subclass rather than through one of the ~20 real collections.
 */
interface Row {
  id: string;
  workspaceId?: string;
  name?: string;
}

abstract class Widgets extends ScopedCrudService<Row, Row> {
  protected readonly model = 'widget';
  protected readonly writePermission: PermissionKey = Permission.TaskWrite;
  protected readonly spec: ListQuerySpec = { filterable: {}, sortable: {}, defaultOrderBy: {} };
  protected map(row: Row) {
    return row;
  }
  createWidget(user: User, workspaceId: string, data: Record<string, unknown>) {
    return this.createIn(user, workspaceId, data);
  }
}

class Audited extends Widgets {
  protected readonly auditEntity = 'widget';
}

/** The same collection without `auditEntity` — must stay silent. */
class NotAudited extends Widgets {}

type WidgetsCtor = new (prisma: PrismaService, access: WorkspaceAccessService) => Widgets;

const user = { id: 'u1', name: 'Ann' } as User;
const stored: Row = { id: 'x1', workspaceId: 'w1', name: 'Widget' };

function build(Cls: WidgetsCtor = Audited) {
  const activityCreate = jest.fn().mockResolvedValue({});
  const widget = {
    findFirst: jest.fn().mockResolvedValue(stored),
    create: jest.fn().mockResolvedValue(stored),
    update: jest.fn().mockResolvedValue({ ...stored, name: 'Renamed' }),
    delete: jest.fn().mockResolvedValue(stored),
    findMany: jest.fn(),
    count: jest.fn(),
  };
  const prisma = { widget, activityLog: { create: activityCreate } } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({}),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    can: jest.fn().mockResolvedValue(true),
  } as unknown as WorkspaceAccessService;
  return { svc: new Cls(prisma, access), activityCreate, widget };
}

const rowOf = (m: jest.Mock) => m.mock.calls[0][0].data as Record<string, unknown>;

describe('ScopedCrudService — audit trail', () => {
  it('records a create', async () => {
    const { svc, activityCreate } = build();
    await svc.createWidget(user, 'w1', { name: 'Widget' });
    expect(rowOf(activityCreate)).toMatchObject({
      workspaceId: 'w1',
      userId: 'u1',
      action: 'widget.created',
      entityType: 'widget',
      entityId: 'x1',
    });
  });

  it('records an update with the changed field names', async () => {
    const { svc, activityCreate } = build();
    await svc.update(user, 'x1', { name: 'Renamed' });
    expect(rowOf(activityCreate)).toMatchObject({
      action: 'widget.updated',
      entityId: 'x1',
      changes: { fields: ['name'] },
    });
  });

  it('records a delete', async () => {
    const { svc, activityCreate } = build();
    await svc.remove(user, 'x1');
    expect(rowOf(activityCreate)).toMatchObject({ action: 'widget.deleted', entityId: 'x1' });
  });

  it('writes nothing for a collection that does not opt in', async () => {
    const { svc, activityCreate } = build(NotAudited);
    await svc.createWidget(user, 'w1', { name: 'Widget' });
    await svc.update(user, 'x1', { name: 'Renamed' });
    await svc.remove(user, 'x1');
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it('still performs the write when the audit append fails', async () => {
    const { svc, widget } = build();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).prisma.activityLog.create = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(svc.update(user, 'x1', { name: 'Renamed' })).resolves.toBeDefined();
    expect(widget.update).toHaveBeenCalled();
  });
});
