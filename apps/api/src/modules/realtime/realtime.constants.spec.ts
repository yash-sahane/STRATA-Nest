import { MODEL_COLLECTION } from './realtime.constants';

/**
 * Completeness guard: every collection that must be realtime-broadcast (the
 * canonical REALTIME_COLLECTION set) has to map to a Prisma model here, or the
 * write hook silently drops its events.
 */
const REQUIRED_BROADCAST_COLLECTIONS = [
  'active_timers', 'activity_logs', 'attendance', 'client_requirements',
  'discord_integrations', 'epics', 'files', 'functional_requirements',
  'git_commits', 'github_integrations', 'gitlab_integrations', 'holidays',
  'kanban_columns', 'labels', 'leave_balances', 'leave_requests',
  'notifications', 'projects', 'retrospectives', 'saved_searches', 'sprints',
  'task_comments', 'tasks', 'time_entries', 'workspace_members', 'workspaces',
];

describe('MODEL_COLLECTION realtime completeness', () => {
  const covered = new Set(Object.values(MODEL_COLLECTION));

  it.each(REQUIRED_BROADCAST_COLLECTIONS)('broadcasts "%s"', (collection) => {
    expect(covered.has(collection)).toBe(true);
  });

  it('covers every required broadcast collection with no gaps', () => {
    const missing = REQUIRED_BROADCAST_COLLECTIONS.filter((c) => !covered.has(c));
    expect(missing).toEqual([]);
  });
});
