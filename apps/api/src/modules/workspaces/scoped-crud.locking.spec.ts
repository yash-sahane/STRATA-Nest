import type { ListQuerySpec } from '@strata/common';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import {
  changedWhileEditing,
  DELETED_WHILE_EDITING,
  ScopedCrudService,
} from './scoped-crud.base';

/**
 * Two people editing one record.
 *
 * Before this, `update` was `prisma.update({ where: { id }, data })` and the second save
 * simply won. Neither person was told anything: the one whose work vanished saw a success
 * toast and found out later, if at all, by noticing their text was gone.
 *
 * The check is per FIELD, and the two halves of that matter equally:
 *
 *   - editing the same field somebody else just edited is refused, loudly
 *   - editing a DIFFERENT field is not, silently
 *
 * The second half is the one that is easy to lose. A row-level version counter refuses
 * both, and the disjoint case is the common one — one person retitles a task while
 * another reprioritises it — so a row-level check interrupts people constantly to protect
 * against something that did not happen. That regression is held shut here and in
 * e2e/verify-concurrent-edit.mjs.
 */

type Row = {
  id: string;
  workspaceId: string;
  version: number;
  title: string;
  priority: string;
  dueDate: Date | null;
};

/** What the second person believed when they opened the form. */
const OPENED_WITH = { title: 'theirs', priority: 'LOW' };

class VersionedService extends ScopedCrudService<Row, Record<string, unknown>> {
  protected readonly model = 'task';
  // Annotated rather than inferred, so PlainService below can turn it back off; an
  // inferred `true` is its own type and nothing may override it with `false`.
  protected override readonly versioned: boolean = true;
  protected readonly spec: ListQuerySpec = {
    filterable: {},
    sortable: {},
    defaultOrderBy: { createdAt: 'desc' },
  };
  protected readonly writePermission: PermissionKey = Permission.TaskWrite;
  /** The rendered shape `basedOn` is compared against — dates as ISO, like the real one. */
  protected map(row: Row) {
    return {
      id: row.id,
      title: row.title,
      priority: row.priority,
      dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    };
  }
}

/** A collection with no version column — the other sixteen. */
class PlainService extends VersionedService {
  protected override readonly versioned = false;
}

/**
 * @param stored what the row holds NOW, i.e. after whatever the other person did.
 * @param writes how many rows each `updateMany` reports writing. A list, so a test can
 *   make the first attempt lose a race and the second win it.
 * @param present whether the row still exists when it is re-read.
 */
function build(
  opts: {
    stored?: Partial<Row>;
    writes?: number[];
    present?: boolean;
  } = {},
) {
  const present = opts.present ?? true;
  const writes = [...(opts.writes ?? [1, 1, 1])];
  const row: Row = {
    id: 'r1',
    workspaceId: 'w1',
    version: 7,
    title: 'theirs',
    priority: 'LOW',
    dueDate: null,
    ...opts.stored,
  };
  // The first read is `findScoped`, which is how the update got this far at all; only
  // the re-reads after a write can come back empty. A mock that answered null from the
  // start would 404 in the scope lookup and never reach the code under test.
  let reads = 0;
  const findFirst = jest.fn().mockImplementation(() => {
    reads += 1;
    return Promise.resolve(reads === 1 || present ? row : null);
  });
  const update = jest.fn().mockResolvedValue(row);
  const updateMany = jest.fn().mockImplementation(() => {
    const count = writes.shift();
    return Promise.resolve({ count: count === undefined ? 1 : count });
  });
  const prisma = { task: { findFirst, update, updateMany } } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({}),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    can: jest.fn().mockResolvedValue(true),
  } as unknown as WorkspaceAccessService;
  return { prisma, access, update, updateMany, findFirst, row };
}

const user = { id: 'u1' } as User;

describe('ScopedCrudService — editing a field somebody else has edited', () => {
  it('refuses the save, and writes nothing', async () => {
    // They changed the priority; this save is also a priority change.
    const { prisma, access, updateMany } = build({ stored: { priority: 'CRITICAL' } });
    const svc = new VersionedService(prisma, access);
    await expect(
      svc.update(user, 'r1', { priority: 'HIGH' }, OPENED_WITH),
    ).rejects.toThrow(changedWhileEditing(['priority']));
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('names the field, so the message says whether it matters', async () => {
    const { prisma, access } = build({ stored: { priority: 'CRITICAL' } });
    const svc = new VersionedService(prisma, access);
    await expect(svc.update(user, 'r1', { priority: 'HIGH' }, OPENED_WITH)).rejects.toThrow(
      /changed the priority/,
    );
  });

  it('names every clashing field, not just the first', async () => {
    const { prisma, access } = build({ stored: { title: 'renamed', priority: 'CRITICAL' } });
    const svc = new VersionedService(prisma, access);
    await expect(
      svc.update(user, 'r1', { title: 'mine', priority: 'HIGH' }, OPENED_WITH),
    ).rejects.toThrow(/the title and the priority/);
  });
});

describe('ScopedCrudService — editing a field nobody else has touched', () => {
  it('lets the save through although the row has changed elsewhere', async () => {
    // They changed the priority. This save changes only the title, which still holds
    // what this person believed — so there is nothing to reconcile and nothing to say.
    const { prisma, access, updateMany } = build({ stored: { priority: 'CRITICAL' } });
    const svc = new VersionedService(prisma, access);
    await expect(svc.update(user, 'r1', { title: 'mine' }, OPENED_WITH)).resolves.toBeTruthy();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', version: 7 },
      data: { title: 'mine', version: { increment: 1 } },
    });
  });

  it('ignores a basedOn entry for a field the save is not writing', async () => {
    // The client may send the whole snapshot it opened with. The check is bounded by
    // what is actually being written, or it is a row-level check wearing a disguise.
    const { prisma, access } = build({ stored: { priority: 'CRITICAL' } });
    const svc = new VersionedService(prisma, access);
    await expect(
      svc.update(user, 'r1', { title: 'mine' }, { ...OPENED_WITH, priority: 'LOW' }),
    ).resolves.toBeTruthy();
  });

  it('treats null, undefined and empty string as the same absence', async () => {
    // `changedFields` on the client uses this rule too. Without it, a field that was
    // never set reads as different from one that was cleared, and every save carrying it
    // is refused for a change nobody made.
    const { prisma, access } = build({ stored: { dueDate: null } });
    const svc = new VersionedService(prisma, access);
    await expect(
      svc.update(user, 'r1', { dueDate: new Date('2026-01-01') }, { dueDate: '' }),
    ).resolves.toBeTruthy();
  });
});

describe('ScopedCrudService — the write is conditional on what was read', () => {
  it('looks again when somebody writes between the read and the write', async () => {
    // A zero count is NOT a conflict: it means the row moved after the fields were
    // checked. Refusing there would report a clash nobody can see in the data.
    const { prisma, access, updateMany } = build({ writes: [0, 1] });
    const svc = new VersionedService(prisma, access);
    await expect(svc.update(user, 'r1', { title: 'mine' }, OPENED_WITH)).resolves.toBeTruthy();
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it('gives up rather than spinning when the row never settles', async () => {
    const { prisma, access, updateMany } = build({ writes: [0, 0, 0] });
    const svc = new VersionedService(prisma, access);
    await expect(svc.update(user, 'r1', { title: 'mine' }, OPENED_WITH)).rejects.toThrow(
      /several people at once/,
    );
    expect(updateMany).toHaveBeenCalledTimes(3);
  });

  it('says the row was deleted rather than changed when it is gone', async () => {
    const { prisma, access } = build({ writes: [0], present: false });
    const svc = new VersionedService(prisma, access);
    await expect(svc.update(user, 'r1', { title: 'mine' }, OPENED_WITH)).rejects.toThrow(
      DELETED_WHILE_EDITING,
    );
  });
});

describe('ScopedCrudService — callers that send no basedOn', () => {
  it('applies the save and still bumps the counter', async () => {
    const { prisma, access, update, updateMany } = build();
    const svc = new VersionedService(prisma, access);
    await svc.update(user, 'r1', { title: 'mine' });
    // The counter is the token that makes the checked path atomic. If an unchecked save
    // did not move it, it could land between another client's read and its write and go
    // unnoticed — the overwrite hardest to spot.
    expect(update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { title: 'mine', version: { increment: 1 } },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('leaves an unversioned collection exactly as it was', async () => {
    const { prisma, access, update } = build();
    const svc = new PlainService(prisma, access);
    await svc.update(user, 'r1', { title: 'mine' });
    expect(update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { title: 'mine' } });
  });

  it('refuses to silently ignore a basedOn sent to an unversioned collection', async () => {
    const { prisma, access, update } = build();
    const svc = new PlainService(prisma, access);
    // A programming error, not a user one: the alternative is a screen that believes it
    // is protected against lost updates and is not.
    await expect(svc.update(user, 'r1', { title: 'mine' }, OPENED_WITH)).rejects.toThrow(
      /no version column/,
    );
    expect(update).not.toHaveBeenCalled();
  });
});
