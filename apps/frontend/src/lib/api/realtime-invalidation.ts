import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Where the record a frame is about lives, as the server names it
 * (RealtimeService.announce): always its workspace, and its project for the
 * project-scoped collections. Either can be missing, and then nothing is ruled
 * out on that count.
 */
export interface FrameScope {
  workspaceId?: string;
  projectId?: string;
}

export function frameScope(payload: unknown): FrameScope {
  const p = (payload ?? {}) as { workspaceId?: unknown; projectId?: unknown };
  return {
    workspaceId: typeof p.workspaceId === 'string' && p.workspaceId ? p.workspaceId : undefined,
    projectId: typeof p.projectId === 'string' && p.projectId ? p.projectId : undefined,
  };
}

/**
 * Events arriving within this quiet period share one refetch.
 *
 * Bursts are the normal case — a teammate reordering a board emits one event
 * per card moved — and five remote writes in quick succession used to cost five
 * full list refetches. Invalidation is idempotent, so coalescing changes how
 * many times a list is fetched, never what is fetched.
 */
const QUIET_MS = 200;
/** A steady stream of events (a bulk import) still refetches this often, so
 *  the screen does not wait for the stream to stop. */
const MAX_WAIT_MS = 1000;

interface PendingRoot {
  /** Some event named no workspace: nothing under this root can be ruled out. */
  everything: boolean;
  scopes: FrameScope[];
}

interface Batch {
  roots: Map<string, PendingRoot>;
  timer: ReturnType<typeof setTimeout> | null;
  openedAt: number;
}

// One batch per QueryClient, shared by every subscription. Two hooks on one page
// often listen for the same collection (the task board and its assignee picker
// both invalidate 'member-task-counts'), and each used to refetch it for the
// same event.
const batches = new WeakMap<QueryClient, Batch>();

/** Note that an event touched these query roots; they are invalidated together
 *  once the events stop for QUIET_MS, or after MAX_WAIT_MS at the latest. */
export function queueInvalidation(
  client: QueryClient,
  roots: readonly string[],
  scope: FrameScope
): void {
  let batch = batches.get(client);
  if (!batch) {
    batch = { roots: new Map(), timer: null, openedAt: 0 };
    batches.set(client, batch);
  }
  if (batch.roots.size === 0) batch.openedAt = Date.now();
  for (const root of roots) {
    const pending = batch.roots.get(root) ?? { everything: false, scopes: [] };
    if (scope.workspaceId) pending.scopes.push(scope);
    else pending.everything = true;
    batch.roots.set(root, pending);
  }
  if (batch.timer !== null) clearTimeout(batch.timer);
  const wait = Math.max(0, Math.min(QUIET_MS, batch.openedAt + MAX_WAIT_MS - Date.now()));
  batch.timer = setTimeout(() => flushInvalidations(client), wait);
}

/**
 * Invalidate everything queued now.
 *
 * Called on the timer, and when a subscription unmounts: what it heard must
 * still land. Invalidating a query nobody is watching only marks it stale — no
 * request — so the next screen that reads it refetches instead of showing what
 * was cached before the change.
 */
export function flushInvalidations(client: QueryClient): void {
  const batch = batches.get(client);
  if (!batch) return;
  if (batch.timer !== null) {
    clearTimeout(batch.timer);
    batch.timer = null;
  }
  if (batch.roots.size === 0) return;
  const roots = batch.roots;
  batch.roots = new Map();

  let known: KnownScopes | undefined;
  roots.forEach((pending, root) => {
    if (pending.everything) {
      void client.invalidateQueries({ queryKey: [root] });
      return;
    }
    known ??= knownScopes(client);
    const scopes = pending.scopes;
    const ids = known;
    void client.invalidateQueries({
      queryKey: [root],
      // Kept unless EVERY event of the burst provably could not have changed it.
      predicate: (query) => !scopes.every((scope) => outside(query.queryKey, scope, ids)),
    });
  });
}

interface KnownScopes {
  workspaces: Set<string>;
  projects: Set<string>;
}

/**
 * The workspace and project ids this client holds, read from the cache.
 *
 * A key element counts as a workspace or project id only when it is one of
 * these. Anything else — a discriminator such as 'functional-requirement' or
 * 'assigned', an id of some other kind, a key shape added tomorrow — is never a
 * reason to skip a query, so a key this module does not understand is always
 * refetched.
 */
function knownScopes(client: QueryClient): KnownScopes {
  const workspaces = new Set<string>();
  const projects = new Set<string>();
  const add = (set: Set<string>, value: unknown) => {
    // '' is "none" (a workspace-level file has projectId ''), never an id.
    if (typeof value === 'string' && value) set.add(value);
  };
  for (const query of client.getQueryCache().getAll()) {
    const [root, first] = query.queryKey;
    const data = query.state.data;
    if (root === 'workspace') add(workspaces, first);
    if (root === 'workspaces' && Array.isArray(data)) {
      for (const w of data) add(workspaces, (w as { id?: unknown } | null)?.id);
    }
    if (root === 'project') add(projects, first);
    if (root === 'projects') {
      add(workspaces, first);
      if (Array.isArray(data)) {
        for (const p of data) {
          add(projects, (p as { id?: unknown } | null)?.id);
          add(workspaces, (p as { workspaceId?: unknown } | null)?.workspaceId);
        }
      }
    }
  }
  return { workspaces, projects };
}

/**
 * Whether a query provably holds nothing the record could have changed: its key
 * names a workspace (or project) this client knows, and not the record's.
 *
 * This leans on one rule for query keys: a key that carries a workspace or
 * project id holds that workspace's or project's data alone. Records never move
 * between projects or workspaces, so the scope a frame names is the only one it
 * can change.
 */
function outside(key: QueryKey, scope: FrameScope, known: KnownScopes): boolean {
  const named = key.filter((part): part is string => typeof part === 'string' && part !== '');
  if (scope.workspaceId) {
    const workspaces = named.filter((part) => known.workspaces.has(part));
    if (workspaces.length > 0 && !workspaces.includes(scope.workspaceId)) return true;
  }
  if (scope.projectId) {
    const projects = named.filter((part) => known.projects.has(part));
    if (projects.length > 0 && !projects.includes(scope.projectId)) return true;
  }
  return false;
}
