import type { PrismaClient } from '@prisma/client';

/**
 * What a requirement and an epic say about themselves, kept true to their tasks.
 *
 * A functional requirement's and an epic's `status` and `progress` are a
 * summary of the tasks under them. Keeping that summary was the browser's job:
 * after it saved a task it read the task list back, did the sum, and sent a
 * second PATCH with the answer. So the summary was only ever as current as the
 * last browser to finish that second request — and anything that changed a task
 * without a browser in the loop (an API client, a commit that moves a task to
 * Review, a tab closed between the two requests) left the parents describing
 * work that no longer looked like that.
 *
 * These functions are the one place the summary is computed and written. They
 * take the client rather than belonging to a service so the API and the worker
 * — two processes, both of which change tasks — run the same code.
 */

/** The models the roll-ups touch. A transaction client satisfies this too. */
export type RollupClient = Pick<
  PrismaClient,
  'task' | 'functionalRequirement' | 'epic' | 'clientRequirement'
>;

/** What a roll-up was being computed for, as handed to an `onError`. */
export type RollupKind = 'functionalRequirement' | 'epic' | 'clientRequirement';

export interface TaskCounts {
  total: number;
  done: number;
  /** In Progress or Review: somebody has started. */
  underway: number;
}

/** A type, not an interface: it is spread into `Record<string, unknown>` patches. */
export type Rollup = {
  progress: number;
  status: string;
};

const UNDERWAY = ['IN_PROGRESS', 'REVIEW'];

/**
 * "All tasks done" is a COUNT comparison, never `progress === 100`:
 * Math.round reports 100% at 240 of 241.
 */
const percent = ({ total, done }: TaskCounts): number =>
  total > 0 ? Math.round((done / total) * 100) : 0;

/**
 * A requirement's status as its tasks stand.
 *
 * Two states are not the tasks' to give. DEPLOYED is a person signing the
 * requirement off: it stands while every task under it is done — and only
 * then. Work added or reopened under a signed-off requirement reopens it, or
 * the screens showed "Deployed" over a requirement that was 80% done. And a
 * requirement with no tasks keeps whatever a person set rather than snapping
 * back to DRAFT.
 */
export function requirementRollup(counts: TaskCounts, currentStatus: string): Rollup {
  const status =
    currentStatus === 'DEPLOYED' && counts.done === counts.total
      ? 'DEPLOYED'
      : counts.total === 0
        ? currentStatus || 'DRAFT'
        : counts.done === counts.total
          ? 'TESTED'
          : counts.underway > 0
            ? 'IMPLEMENTED'
            : 'APPROVED';
  return { progress: percent(counts), status };
}

/**
 * An epic's status as its tasks stand.
 *
 * In progress as soon as anybody has STARTED, not only once something is
 * finished: the rule used to be `done > 0`, so an epic with every task in
 * progress or in review read "To Do" until the first one closed.
 */
export function epicRollup(counts: TaskCounts): Rollup {
  const status =
    counts.total > 0 && counts.done === counts.total
      ? 'DONE'
      : counts.done > 0 || counts.underway > 0
        ? 'IN_PROGRESS'
        : 'TODO';
  return { progress: percent(counts), status };
}

/** The client requirement's statuses its functional requirements decide. */
const CLIENT_DELIVERY_STATUSES = ['APPROVED', 'IN_PROGRESS', 'COMPLETED'];
/** A functional requirement somebody has started on, or finished. */
const REQUIREMENT_STARTED = ['IMPLEMENTED', 'TESTED', 'DEPLOYED'];

/**
 * A client requirement's status as the work raised from it stands.
 *
 * Drafting, submitting, approving and archiving the request are people's
 * decisions. Once it is approved and functional requirements have been raised
 * for it, how far it has got is theirs to say: In Progress as soon as any of
 * them is under way, Completed once every one is signed off (DEPLOYED). It used
 * to be set by hand and nothing moved it, so a request whose work had all
 * shipped read "Approved", and one nobody had started could read "Completed".
 */
export function clientRequirementRollup(
  requirements: ReadonlyArray<{ status: string; progress: number }>,
  currentStatus: string,
): string {
  if (requirements.length === 0 || !CLIENT_DELIVERY_STATUSES.includes(currentStatus)) {
    return currentStatus;
  }
  if (requirements.every((fr) => fr.status === 'DEPLOYED')) return 'COMPLETED';
  const started = requirements.some(
    (fr) => fr.progress > 0 || REQUIREMENT_STARTED.includes(fr.status),
  );
  return started ? 'IN_PROGRESS' : 'APPROVED';
}

/** The statuses a person cannot give a client requirement that has work under it. */
export const CLIENT_REQUIREMENT_DERIVED_STATUSES: readonly string[] = ['IN_PROGRESS', 'COMPLETED'];

async function countTasks(
  prisma: RollupClient,
  where: { functionalRequirementId: string } | { epicId: string },
): Promise<TaskCounts> {
  const [total, done, underway] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.count({ where: { ...where, status: 'DONE' } }),
    prisma.task.count({ where: { ...where, status: { in: UNDERWAY } } }),
  ]);
  return { total, done, underway };
}

/** The requirement's roll-up as its tasks stand right now, without writing it. */
export async function deriveRequirementRollup(
  prisma: RollupClient,
  id: string,
  currentStatus: string,
): Promise<Rollup> {
  return requirementRollup(await countTasks(prisma, { functionalRequirementId: id }), currentStatus);
}

/**
 * An epic's work: its tasks, and each functional requirement under it that has
 * no task yet — one unit of unfinished work, or of finished work once somebody
 * has signed it off. Counting tasks alone read an epic "Done, 100%" while a
 * requirement in it had not been started.
 */
async function countEpicWork(prisma: RollupClient, epicId: string): Promise<TaskCounts> {
  const counts = await countTasks(prisma, { epicId });
  const requirements = await prisma.functionalRequirement.findMany({
    where: { epicId },
    select: { id: true, status: true },
  });
  if (requirements.length === 0) return counts;
  const withTasks = new Set(
    (
      await prisma.task.findMany({
        where: { functionalRequirementId: { in: requirements.map((r) => r.id) } },
        select: { functionalRequirementId: true },
        distinct: ['functionalRequirementId'],
      })
    ).map((task) => task.functionalRequirementId),
  );
  const unstarted = requirements.filter((r) => !withTasks.has(r.id));
  const signedOff = unstarted.filter((r) => r.status === 'DEPLOYED').length;
  return { total: counts.total + unstarted.length, done: counts.done + signedOff, underway: counts.underway };
}

/**
 * The rules the stored roll-ups were last computed under. Bumped when they
 * change, so the API recomputes every stored roll-up once (RollupReconcileService).
 */
export const ROLLUP_RULES_VERSION = '2026-10-18.client-requirements';

/** The epic's roll-up as its work stands right now, without writing it. */
export async function deriveEpicRollup(prisma: RollupClient, id: string): Promise<Rollup> {
  return epicRollup(await countEpicWork(prisma, id));
}

/**
 * Bring one requirement's stored roll-up up to date. Returns whether it moved.
 *
 * Written with `update`, and only when something changed: `update` is what the
 * API's write hook sees, so every open screen is told — and a task edit that
 * leaves the summary where it was tells nobody anything. The version moves with
 * it, as it does for every other write to the row.
 */
export async function refreshRequirementRollup(prisma: RollupClient, id: string): Promise<boolean> {
  const row = await prisma.functionalRequirement.findUnique({
    where: { id },
    select: { status: true, progress: true },
  });
  if (!row) return false;
  const next = await deriveRequirementRollup(prisma, id, row.status);
  if (next.status === row.status && next.progress === row.progress) return false;
  await prisma.functionalRequirement.update({ where: { id }, data: { ...next, version: { increment: 1 } } });
  return true;
}

/** Bring one epic's stored roll-up up to date. Returns whether it moved. */
export async function refreshEpicRollup(prisma: RollupClient, id: string): Promise<boolean> {
  const row = await prisma.epic.findUnique({
    where: { id },
    select: { status: true, progress: true },
  });
  if (!row) return false;
  const next = await deriveEpicRollup(prisma, id);
  if (next.status === row.status && next.progress === row.progress) return false;
  await prisma.epic.update({ where: { id }, data: { ...next, version: { increment: 1 } } });
  return true;
}

/** Bring one client requirement's stored status up to date. Returns whether it moved. */
export async function refreshClientRequirementRollup(
  prisma: RollupClient,
  id: string,
): Promise<boolean> {
  const row = await prisma.clientRequirement.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!row) return false;
  const requirements = await prisma.functionalRequirement.findMany({
    where: { clientRequirementId: id },
    select: { status: true, progress: true },
  });
  const status = clientRequirementRollup(requirements, row.status);
  if (status === row.status) return false;
  await prisma.clientRequirement.update({
    where: { id },
    data: { status, version: { increment: 1 } },
  });
  return true;
}

type Ids = Iterable<string | null | undefined>;

const distinct = (ids: Ids | undefined): string[] => [
  ...new Set([...(ids ?? [])].filter((id): id is string => Boolean(id))),
];

/**
 * Refresh every parent a change could have moved: pass the requirement and
 * epic a task was under before AND the ones it is under now, and the client
 * requirement a functional requirement left. The client requirement of every
 * functional requirement passed is refreshed as well — its status is part of
 * what that client requirement says.
 *
 * The roll-up is bookkeeping about a change that has already been saved, so a
 * failure here must not be reported as a failure of that change. With
 * `onError` each parent is attempted on its own and a failure is handed over;
 * without it the first failure is thrown.
 */
export async function refreshDeliveryRollups(
  prisma: RollupClient,
  parents: { functionalRequirementIds?: Ids; epicIds?: Ids; clientRequirementIds?: Ids },
  onError?: (error: unknown, kind: RollupKind, id: string) => void,
): Promise<void> {
  const attempt = async (
    kind: RollupKind,
    id: string,
    refresh: (client: RollupClient, parentId: string) => Promise<unknown>,
  ): Promise<void> => {
    try {
      await refresh(prisma, id);
    } catch (error) {
      if (!onError) throw error;
      onError(error, kind, id);
    }
  };
  const requirementIds = distinct(parents.functionalRequirementIds);
  for (const id of requirementIds) {
    await attempt('functionalRequirement', id, refreshRequirementRollup);
  }
  for (const id of distinct(parents.epicIds)) {
    await attempt('epic', id, refreshEpicRollup);
  }
  // Requirements first: a client requirement reads its requirements' new status.
  const clientIds = new Set(distinct(parents.clientRequirementIds));
  if (requirementIds.length > 0) {
    await attempt('clientRequirement', requirementIds.join(','), async (client) => {
      const rows = await client.functionalRequirement.findMany({
        where: { id: { in: requirementIds } },
        select: { clientRequirementId: true },
      });
      for (const row of rows) if (row.clientRequirementId) clientIds.add(row.clientRequirementId);
    });
  }
  for (const id of clientIds) {
    await attempt('clientRequirement', id, refreshClientRequirementRollup);
  }
}
