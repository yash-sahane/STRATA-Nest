import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { EpicDeletionService } from '../deletion/epic-deletion.service';
import { RequirementDeletionService } from '../deletion/requirement-deletion.service';
import { SprintDeletionService } from '../deletion/sprint-deletion.service';
import { TaskDeletionService } from '../deletion/task-deletion.service';
import { EpicsService } from '../epics/epics.service';
import { FilesService } from '../files/files.service';
import {
  ClientRequirementsService,
  FunctionalRequirementsService,
} from '../requirements/requirements.services';
import { SprintCompletionService } from '../sprints/sprint-completion.service';
import { SprintsService } from '../sprints/sprints.services';
import { TasksService } from '../tasks/tasks.services';
import { TaskCommentsService } from '../tasks/unscoped.services';
import { TimeEntriesService } from '../time-tracking/time-tracking.services';
import { TimerService } from '../time-tracking/time-tracking.workflows';
import {
  PROJECT_ARCHIVED_MESSAGE,
  PROJECT_ARCHIVED_TYPE,
  assertProjectWritable,
  assertTaskProjectWritable,
} from './project-archive';
import { ProjectsService } from './projects.service';

/**
 * An archived project is read-only, by every door: the helper itself, then
 * each write path that files into a project or changes something in one.
 */

const user = { id: 'u1', name: 'Ada', email: 'ada@x.test' } as User;

/** Every project id answers: in workspace w1, with this status. */
const projects = (status = 'ARCHIVED') => ({
  findUnique: jest.fn().mockResolvedValue({ status, workspaceId: 'w1' }),
});

/** A member who may do anything: what is left to refuse is the project's state. */
const access = () =>
  ({
    scopeWhere: jest.fn().mockResolvedValue({}),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    assertMember: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    can: jest.fn().mockResolvedValue(true),
    activeMembership: jest.fn().mockResolvedValue({ id: 'm1' }),
    accessibleWorkspaceIds: jest.fn().mockResolvedValue(['w1']),
    membersHolding: jest.fn().mockResolvedValue([]),
  }) as unknown as WorkspaceAccessService;

const events = () =>
  ({ emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) }) as unknown as EventEmitter2;

const sideEffects = () => ({ emitDeletes: jest.fn(), emitUpdates: jest.fn() }) as never;

const db = (prisma: Record<string, unknown>) => prisma as unknown as PrismaService;

describe('project-archive', () => {
  it('asks nothing of a row filed against no project', async () => {
    const project = projects();
    await expect(assertProjectWritable(db({ project }), '')).resolves.toBeUndefined();
    expect(project.findUnique).not.toHaveBeenCalled();
  });

  it('lets a write into a project that takes changes through', async () => {
    await expect(assertProjectWritable(db({ project: projects('ACTIVE') }), 'p1')).resolves.toBeUndefined();
  });

  it('refuses one into an archived project, in words and by type', async () => {
    const refusal = await assertProjectWritable(db({ project: projects() }), 'p1').catch((e) => e);
    expect(refusal).toBeInstanceOf(BadRequestException);
    expect((refusal as BadRequestException).getResponse()).toEqual({
      message: PROJECT_ARCHIVED_MESSAGE,
      type: PROJECT_ARCHIVED_TYPE,
    });
  });

  it('answers for a task by its project', async () => {
    const task = { findUnique: jest.fn().mockResolvedValue({ projectId: 'p1' }) };
    await expect(assertTaskProjectWritable(db({ task, project: projects() }), 't1')).rejects.toThrow(
      PROJECT_ARCHIVED_MESSAGE,
    );
    await expect(
      assertTaskProjectWritable(db({ task, project: projects('ACTIVE') }), 't1'),
    ).resolves.toBeUndefined();
  });
});

describe('ProjectsService.update — an archived project takes one change: its status', () => {
  function harness(status: string) {
    const row = {
      id: 'p1',
      workspaceId: 'w1',
      name: 'Old',
      shortCode: 'OLD',
      description: 'as it was',
      clientName: 'Acme',
      status,
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: null,
      ownerId: 'u1',
      createdById: 'u1',
      createdByName: 'Ada',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      version: 1,
    };
    const update = jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...row, ...data }));
    const prisma = db({
      project: {
        // The scoped read, and the code probe (the one that names a shortCode).
        findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve('shortCode' in where ? null : row),
        ),
        update,
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      // No sprint running: archiving is refused while one is (projects.service.spec).
      sprint: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    return { svc: new ProjectsService(prisma, access()), update };
  }

  it('refuses an edit that leaves it archived', async () => {
    const { svc, update } = harness('ARCHIVED');
    await expect(svc.update(user, 'p1', { name: 'New' })).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    await expect(svc.update(user, 'p1', { status: 'ARCHIVED', endDate: '2026-09-01' })).rejects.toThrow(
      PROJECT_ARCHIVED_MESSAGE,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('un-archives, carrying the rest of the form with it', async () => {
    const { svc, update } = harness('ARCHIVED');
    await svc.update(user, 'p1', { status: 'ACTIVE', name: 'New' });
    expect(update.mock.calls[0][0].data).toMatchObject({ status: 'ACTIVE', name: 'New' });
  });

  it('takes a form sent back exactly as it is stored', async () => {
    const { svc, update } = harness('ARCHIVED');
    await svc.update(user, 'p1', {
      status: 'ARCHIVED',
      name: 'Old',
      description: 'as it was',
      clientName: 'Acme',
      startDate: '2026-06-01',
      endDate: null,
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('archives a project and renames it in the same save', async () => {
    const { svc, update } = harness('ACTIVE');
    await svc.update(user, 'p1', { status: 'ARCHIVED', name: 'Final' });
    expect(update.mock.calls[0][0].data).toMatchObject({ status: 'ARCHIVED', name: 'Final' });
  });
});

describe('TasksService — the tasks of an archived project', () => {
  function harness(visible = true) {
    const row = { id: 't1', workspaceId: 'w1', projectId: 'p1', status: 'TODO', assigneeIds: [], position: 0, version: 1 };
    const task = {
      findFirst: jest.fn().mockResolvedValue(visible ? row : null),
      findUnique: jest.fn().mockResolvedValue({ projectId: 'p1' }),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    const svc = new TasksService(db({ task, project: projects() }), access(), events());
    return { svc, task };
  }

  it('takes no new task', async () => {
    const { svc, task } = harness();
    await expect(
      svc.create(user, { workspaceId: 'w1', projectId: 'p1', title: 'New' } as Parameters<TasksService['create']>[1]),
    ).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    expect(task.create).not.toHaveBeenCalled();
  });

  it('takes no edit, a reorder or a move between columns included', async () => {
    const { svc, task } = harness();
    await expect(svc.patch(user, 't1', { position: 3 })).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    await expect(svc.patch(user, 't1', { status: 'IN_PROGRESS' })).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    expect(task.update).not.toHaveBeenCalled();
    expect(task.updateMany).not.toHaveBeenCalled();
  });

  it('tells a stranger "not found", not that the project is archived', async () => {
    const { svc } = harness(false);
    await expect(svc.patch(user, 't1', { title: 'Mine now' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TaskCommentsService — the comments of an archived project', () => {
  function harness() {
    const taskComment = {
      create: jest.fn(),
      findUnique: jest.fn().mockResolvedValue({ id: 'c1', taskId: 't1', userId: 'u1' }),
      update: jest.fn(),
      delete: jest.fn(),
    };
    const task = {
      findUnique: jest.fn().mockResolvedValue({ workspaceId: 'w1', projectId: 'p1', title: 'T', hierarchyId: 'P-T01' }),
    };
    const svc = new TaskCommentsService(db({ task, taskComment, project: projects() }), access(), events());
    return { svc, taskComment };
  }

  it('takes no new comment, no edit and no takedown', async () => {
    const { svc, taskComment } = harness();
    await expect(svc.create(user, { taskId: 't1', content: 'hi' } as never)).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    await expect(svc.update(user, 'c1', { content: 'edited' } as never)).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    await expect(svc.remove(user, 'c1')).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    expect(taskComment.create).not.toHaveBeenCalled();
    expect(taskComment.update).not.toHaveBeenCalled();
    expect(taskComment.delete).not.toHaveBeenCalled();
  });
});

describe('sprints of an archived project', () => {
  const row = {
    id: 's1',
    workspaceId: 'w1',
    projectId: 'p1',
    status: 'PLANNING',
    startDate: new Date('2026-11-02T00:00:00.000Z'),
    endDate: new Date('2026-11-13T00:00:00.000Z'),
    version: 1,
  };

  it('are not created, edited or started', async () => {
    const sprint = {
      findFirst: jest.fn().mockResolvedValue(row),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    const svc = new SprintsService(db({ sprint, project: projects() }), access(), events());
    await expect(
      svc.create(user, {
        workspaceId: 'w1',
        projectId: 'p1',
        name: 'S',
        startDate: '2026-11-02',
        endDate: '2026-11-13',
      } as Parameters<SprintsService['create']>[1]),
    ).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    await expect(svc.patch(user, 's1', { status: 'ACTIVE' })).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    await expect(svc.patch(user, 's1', { name: 'Renamed' })).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    expect(sprint.create).not.toHaveBeenCalled();
    expect(sprint.update).not.toHaveBeenCalled();
    expect(sprint.updateMany).not.toHaveBeenCalled();
  });

  it('are not completed', async () => {
    const sprint = {
      findUnique: jest.fn().mockResolvedValue({ ...row, status: 'ACTIVE' }),
      updateMany: jest.fn(),
    };
    const task = { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) };
    const svc = new SprintCompletionService(db({ sprint, task, project: projects() }), access(), events());
    await expect(svc.complete(user, 's1')).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    expect(sprint.updateMany).not.toHaveBeenCalled();
  });
});

describe('epics and requirements of an archived project', () => {
  it('epics are not created or edited', async () => {
    const epic = {
      findFirst: jest.fn().mockResolvedValue({ id: 'e1', workspaceId: 'w1', projectId: 'p1', requirementId: '', version: 1 }),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    const svc = new EpicsService(db({ epic, project: projects() }), access(), events());
    await expect(
      svc.create(user, { workspaceId: 'w1', projectId: 'p1', name: 'E' } as Parameters<EpicsService['create']>[1]),
    ).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    await expect(svc.patch(user, 'e1', { name: 'Renamed' })).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    expect(epic.create).not.toHaveBeenCalled();
    expect(epic.update).not.toHaveBeenCalled();
  });

  it('client requirements are not created or edited', async () => {
    const clientRequirement = {
      findFirst: jest.fn().mockResolvedValue({ id: 'cr1', workspaceId: 'w1', projectId: 'p1', status: 'DRAFT', version: 1 }),
      create: jest.fn(),
      update: jest.fn(),
    };
    const svc = new ClientRequirementsService(db({ clientRequirement, project: projects() }), access(), events());
    await expect(
      svc.create(user, { workspaceId: 'w1', projectId: 'p1', title: 'CR' } as Parameters<ClientRequirementsService['create']>[1]),
    ).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    await expect(svc.patch(user, 'cr1', { title: 'Renamed' })).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    expect(clientRequirement.create).not.toHaveBeenCalled();
    expect(clientRequirement.update).not.toHaveBeenCalled();
  });

  it('functional requirements are not created, edited or planned', async () => {
    const functionalRequirement = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'fr1',
        workspaceId: 'w1',
        projectId: 'p1',
        sprintId: '',
        epicId: '',
        status: 'DRAFT',
        assigneeIds: [],
        version: 1,
      }),
      create: jest.fn(),
      update: jest.fn(),
    };
    const svc = new FunctionalRequirementsService(db({ functionalRequirement, project: projects() }), access(), events());
    await expect(
      svc.create(user, { workspaceId: 'w1', projectId: 'p1', title: 'FR' } as Parameters<FunctionalRequirementsService['create']>[1]),
    ).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    await expect(svc.patch(user, 'fr1', { sprintId: 's2' })).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    expect(functionalRequirement.create).not.toHaveBeenCalled();
    expect(functionalRequirement.update).not.toHaveBeenCalled();
  });
});

describe('files of an archived project', () => {
  const part = { originalname: 'spec.txt', buffer: Buffer.from('x'), mimetype: 'text/plain', size: 1 };

  function harness() {
    const uploadedFile = {
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn().mockResolvedValue({
        id: 'f1',
        workspaceId: 'w1',
        projectId: 'p1',
        uploadedById: 'u1',
        filePath: 'uploads/w1/f1/spec.txt',
      }),
    };
    const storage = { save: jest.fn(), remove: jest.fn() };
    const svc = new FilesService(db({ uploadedFile, project: projects() }), access(), storage as never);
    return { svc, uploadedFile, storage };
  }

  it('takes no upload', async () => {
    const { svc, uploadedFile, storage } = harness();
    await expect(svc.create(user, part, { workspaceId: 'w1', projectId: 'p1' } as never)).rejects.toThrow(
      PROJECT_ARCHIVED_MESSAGE,
    );
    expect(uploadedFile.create).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('keeps the files it has', async () => {
    const { svc, uploadedFile, storage } = harness();
    await expect(svc.remove(user, 'f1')).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(uploadedFile.delete).not.toHaveBeenCalled();
  });
});

describe('time against an archived project', () => {
  const hourAgo = () => new Date(Date.now() - 60 * 60_000).toISOString();
  const now = () => new Date(Date.now() - 1_000).toISOString();

  it('is not logged by hand', async () => {
    const prisma = db({
      task: { findUnique: jest.fn().mockResolvedValue({ projectId: 'p1' }) },
      project: projects(),
      $transaction: jest.fn(),
    });
    const svc = new TimeEntriesService(prisma, access());
    await expect(
      svc.create(user, { workspaceId: 'w1', taskId: 't1', startTime: hourAgo(), endTime: now() } as never),
    ).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).not.toHaveBeenCalled();
  });

  function timers(timer: Record<string, unknown> | null) {
    const activeTimer = {
      findUnique: jest.fn().mockResolvedValue(timer),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(timer),
    };
    const timeEntry = {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...data, tags: [], createdAt: new Date(), updatedAt: new Date() }),
      ),
    };
    const prisma = db({
      activeTimer,
      timeEntry,
      task: {
        findUnique: jest.fn().mockResolvedValue({
          id: 't1',
          title: 'Ship it',
          hierarchyId: 'P-T01',
          projectId: 'p1',
          workspaceId: 'w1',
        }),
      },
      project: projects(),
      $transaction: (ops: unknown[]) => Promise.all(ops),
    });
    return { svc: new TimerService(prisma, access()), activeTimer, timeEntry };
  }

  const running = (paused: boolean) => ({
    id: 'timer-1',
    userId: 'u1',
    workspaceId: 'w1',
    taskId: 't1',
    taskTitle: 'Ship it',
    taskHierarchyId: 'P-T01',
    projectId: 'p1',
    description: '',
    startTime: new Date(Date.now() - 30 * 60_000),
    isPaused: paused,
    pausedAt: paused ? new Date(Date.now() - 10 * 60_000) : null,
    totalPausedTime: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('is not started on a timer, or resumed on a paused one', async () => {
    const idle = timers(null);
    await expect(idle.svc.start(user, { taskId: 't1' } as never)).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    expect(idle.activeTimer.create).not.toHaveBeenCalled();

    const paused = timers(running(true));
    await expect(paused.svc.resume(user)).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    expect(paused.activeTimer.update).not.toHaveBeenCalled();
  });

  it('still lets a timer that was running be stopped, and logs what it held', async () => {
    const { svc, timeEntry, activeTimer } = timers(running(false));
    await expect(svc.stop(user, {} as never)).resolves.toMatchObject({ taskId: 't1', projectId: 'p1' });
    expect(timeEntry.create).toHaveBeenCalledTimes(1);
    expect(activeTimer.delete).toHaveBeenCalledWith({ where: { id: 'timer-1' } });
  });
});

describe('deleting work out of an archived project', () => {
  const row = { workspaceId: 'w1', projectId: 'p1', status: 'PLANNING', hierarchyId: 'P-X-01' };
  const deleting = (model: string, id: string) => {
    const $transaction = jest.fn();
    const prisma = db({
      [model]: { findUnique: jest.fn().mockResolvedValue({ ...row, id }) },
      project: projects(),
      $transaction,
    });
    return { prisma, $transaction };
  };

  it('is refused for a task, a sprint, an epic and a requirement', async () => {
    const t = deleting('task', 't1');
    await expect(new TaskDeletionService(t.prisma, access(), sideEffects()).delete(user, 't1')).rejects.toThrow(
      PROJECT_ARCHIVED_MESSAGE,
    );
    const s = deleting('sprint', 's1');
    await expect(new SprintDeletionService(s.prisma, access(), sideEffects()).delete(user, 's1')).rejects.toThrow(
      PROJECT_ARCHIVED_MESSAGE,
    );
    const e = deleting('epic', 'e1');
    await expect(new EpicDeletionService(e.prisma, access(), sideEffects()).delete(user, 'e1')).rejects.toThrow(
      PROJECT_ARCHIVED_MESSAGE,
    );
    const cr = deleting('clientRequirement', 'cr1');
    await expect(
      new RequirementDeletionService(cr.prisma, access(), sideEffects()).deleteClientRequirement(user, 'cr1', true),
    ).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    const fr = deleting('functionalRequirement', 'fr1');
    await expect(
      new RequirementDeletionService(fr.prisma, access(), sideEffects()).deleteFunctionalRequirement(user, 'fr1', true),
    ).rejects.toThrow(PROJECT_ARCHIVED_MESSAGE);
    for (const { $transaction } of [t, s, e, cr, fr]) expect($transaction).not.toHaveBeenCalled();
  });
});
