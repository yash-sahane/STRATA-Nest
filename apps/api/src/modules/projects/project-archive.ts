import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '@strata/prisma';

/**
 * An archived project is read-only — held here, by the server.
 *
 * Archiving used to change one word on the project and nothing else: its tasks,
 * sprints, requirements, epics, comments and files all stayed exactly as
 * editable as before, so "archived" told people a project was finished while
 * anybody could go on rewriting it. The pages that hide an archived project
 * (the projects list, every project picker) only hid the way in; a link, the
 * search box or a script still went straight to its work.
 *
 * Every write into a project's content asks `assertProjectWritable` first. What
 * stays allowed: reading it, copying it into a new project, deleting it, and
 * changing its status — which is how it is un-archived (see ProjectsService).
 * Bookkeeping the system does on its own (roll-ups, tidying up after a member
 * leaves, a cascade from deleting the project or its workspace) is not a change
 * anybody made to it and does not ask.
 */

/** One sentence everywhere, so every screen says the same thing. */
export const PROJECT_ARCHIVED_MESSAGE = 'This project is archived. Unarchive it to make changes.';

/**
 * The envelope `type` (AllExceptionsFilter honours a `type` pinned on the
 * payload), so a client can tell this refusal from a validation error without
 * reading the sentence.
 */
export const PROJECT_ARCHIVED_TYPE = 'ProjectArchived';

/** The project status that makes it read-only. */
export const ARCHIVED_PROJECT_STATUS = 'ARCHIVED';

/**
 * A 400, like the other refusals of a change the record's state does not allow
 * (a completed sprint, a task that has not been reviewed): nothing is wrong with
 * who is asking, the project is simply not taking changes.
 */
export function projectArchivedError(): BadRequestException {
  return new BadRequestException({
    message: PROJECT_ARCHIVED_MESSAGE,
    type: PROJECT_ARCHIVED_TYPE,
  });
}

/** Refuse when a project already in hand is archived. */
export function assertNotArchived(project: { status?: string | null } | null | undefined): void {
  if (project?.status === ARCHIVED_PROJECT_STATUS) throw projectArchivedError();
}

/**
 * Refuse a write to anything in an archived project.
 *
 * Called with the project id of the row being written (or the one a new row is
 * filed into), after the caller's access to that row has been settled — so a
 * stranger is still told "not found", never whether the project is archived.
 * An empty id (a time entry or file filed against no project) is no project,
 * and nothing to refuse.
 */
export async function assertProjectWritable(
  db: Pick<PrismaService, 'project'>,
  projectId: string | null | undefined,
): Promise<void> {
  if (!projectId) return;
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { status: true },
  });
  assertNotArchived(project);
}

/** The same, for a row known only by its task: the task's project decides. */
export async function assertTaskProjectWritable(
  db: Pick<PrismaService, 'project' | 'task'>,
  taskId: string | null | undefined,
): Promise<void> {
  if (!taskId) return;
  const task = await db.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
  if (task) await assertProjectWritable(db, task.projectId);
}
