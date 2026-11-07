import { useMemo } from 'react';
import type { Task } from '@/types';
import { useWorkspaceTasks } from './use-task';
import { useWorkspaceSprints } from './use-sprint';
import { useProjects } from './use-project';
import { useWorkspaceMembers } from './use-workspace';
import { isTaskOverdue } from '@/lib/task-dates';

/**
 * The figures the Analytics page shows, and only those.
 *
 * These hooks used to compute a good deal more that no screen drew: a "budget"
 * that was estimated hours under another name, a time "efficiency" and "actual
 * hours" read from a task column nothing ever fills (logged time lives in time
 * entries), a velocity equal to the completed count, and a 30-day completion
 * trend, per-assignee table and overdue list nobody rendered — all recomputed,
 * over every task in the workspace, on each change.
 */

/**
 * When a DONE task actually finished. The API stamps `completedAt` on the
 * transition into DONE (and the migration backfilled existing DONE rows from
 * `updated_at`), so `updatedAt` is only a fallback for rows a client edited
 * before the column existed. Read structurally: the shared `Task` type does not
 * declare `completedAt` yet, but every response carries it.
 */
function completionDate(task: Task): string {
  return (task as Task & { completedAt?: string | null }).completedAt ?? task.updatedAt;
}

/**
 * Project Analytics Hook
 * The selected project's task mix, completion and estimate figures.
 *
 * Derived synchronously (useMemo) from the workspace task query so the metrics
 * always recompute when the source data arrives or changes.
 */
export function useProjectAnalytics(projectId?: string, workspaceId?: string) {
  const tasksQuery = useWorkspaceTasks(workspaceId);
  const allTasks = tasksQuery.data;

  const data = useMemo(() => {
    if (!projectId || !allTasks) return null;

    const projectTasks = allTasks.filter((task) => task.projectId === projectId);

    const statusDistribution = {
      BACKLOG: projectTasks.filter((t) => t.status === 'BACKLOG').length,
      TODO: projectTasks.filter((t) => t.status === 'TODO').length,
      IN_PROGRESS: projectTasks.filter((t) => t.status === 'IN_PROGRESS').length,
      REVIEW: projectTasks.filter((t) => t.status === 'REVIEW').length,
      DONE: projectTasks.filter((t) => t.status === 'DONE').length,
    };

    const priorityDistribution = {
      LOW: projectTasks.filter((t) => t.priority === 'LOW').length,
      MEDIUM: projectTasks.filter((t) => t.priority === 'MEDIUM').length,
      HIGH: projectTasks.filter((t) => t.priority === 'HIGH').length,
      CRITICAL: projectTasks.filter((t) => t.priority === 'CRITICAL').length,
    };

    const totalTasks = projectTasks.length;
    const completionRate = totalTasks > 0 ? (statusDistribution.DONE / totalTasks) * 100 : 0;

    const totalEstimatedHours = projectTasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
    const completedEstimatedHours = projectTasks
      .filter((t) => t.status === 'DONE')
      .reduce((sum, t) => sum + (t.estimatedHours || 0), 0);

    return {
      totalTasks,
      completionRate,
      statusDistribution,
      priorityDistribution,
      totalEstimatedHours,
      completedEstimatedHours,
      // The one definition, shared with every other screen that counts them
      // (lib/task-dates.ts). Due today is not overdue.
      overdueTasks: projectTasks.filter((t) => isTaskOverdue(t)).length,
    };
  }, [projectId, allTasks]);

  return { data, isLoading: tasksQuery.isLoading };
}

/**
 * Team Performance Analytics Hook
 * Who holds the work and how much of it they have finished.
 */
export function useTeamAnalytics(workspaceId?: string) {
  const tasksQuery = useWorkspaceTasks(workspaceId);
  const membersQuery = useWorkspaceMembers(workspaceId);
  const allTasks = tasksQuery.data;
  const members = membersQuery.data;
  // `members` is undefined both while the roster is loading and after it has
  // FAILED, and isLoading goes false either way — so without this flag a failed
  // roster resolves to a leaderboard of identical "Unknown member" rows with
  // nothing anywhere saying the request died. Surfaced on the return so the
  // page can say so, and used below to keep the rows distinguishable.
  const rosterFailed = membersQuery.isError;

  const data = useMemo(() => {
    if (!workspaceId || !allTasks) return null;

    // Members that currently hold at least one task
    const teamMembers = new Set<string>();
    allTasks.forEach((task) => {
      (task.assigneeIds || []).forEach((id) => teamMembers.add(id));
    });

    // Every row this hook returns is keyed by user id, and the screens that
    // render them had nothing else to show — so the leaderboard and the
    // workload axis both read "Member rJJUvZYp". The roster is already loaded
    // here (teamSize below counts it), so the name is resolved once, centrally.
    const nameById = new Map((members ?? []).map((m) => [m.userId, m.name || m.email]));
    // Two different misses. Roster loaded but this assignee is not on it: they
    // genuinely left the workspace, so "Unknown member" is the truth. Roster
    // failed: there is no name to look up for ANYONE, and labelling every row
    // the same would collapse the whole leaderboard into one indistinguishable
    // block — worse than the raw ids this hook was added to replace. Fall back
    // to a short id there and let the page explain the failure.
    const nameOf = (id: string) =>
      nameById.get(id) ?? (rosterFailed ? `Member ${id.slice(0, 8)}` : 'Unknown member');

    const memberPerformance = Array.from(teamMembers).map((memberId) => {
      const memberTasks = allTasks.filter((t) => (t.assigneeIds || []).includes(memberId));
      const completed = memberTasks.filter((t) => t.status === 'DONE').length;
      const total = memberTasks.length;
      return {
        memberId,
        memberName: nameOf(memberId),
        totalTasks: total,
        completedTasks: completed,
        completionRate: total > 0 ? (completed / total) * 100 : 0,
      };
    });

    const avgCompletionRate =
      memberPerformance.length > 0
        ? memberPerformance.reduce((sum, m) => sum + m.completionRate, 0) / memberPerformance.length
        : 0;

    // Workload distribution. The denominator is the number of assignments, not
    // the number of tasks: a task with three assignees counts once per assignee,
    // so shares of a task-count denominator would sum to well over 100%.
    const totalAssignments = allTasks.reduce((sum, t) => sum + (t.assigneeIds || []).length, 0);

    const workloadDistribution = memberPerformance.map((m) => ({
      memberId: m.memberId,
      memberName: m.memberName,
      taskCount: m.totalTasks,
      percentage: totalAssignments > 0 ? (m.totalTasks / totalAssignments) * 100 : 0,
    }));

    return {
      // Team size is the workspace roster — members without an assigned task are
      // still part of the team. `activeAssignees` is the subset holding tasks.
      // null, not 0, when the roster request failed: "this workspace has no
      // members" is a claim, and it is not one this hook can make from an
      // errored query.
      teamSize: rosterFailed ? null : (members?.length ?? 0),
      activeAssignees: teamMembers.size,
      totalTasks: allTasks.length,
      memberPerformance,
      avgCompletionRate,
      workloadDistribution,
    };
  }, [workspaceId, allTasks, members, rosterFailed]);

  return {
    data,
    isLoading: tasksQuery.isLoading || membersQuery.isLoading,
    /**
     * The workspace roster failed to load. Everything derived from tasks is
     * still sound; team size is unknown and member rows carry ids, not names.
     */
    isRosterError: rosterFailed,
    refetchRoster: membersQuery.refetch,
  };
}

/**
 * Workspace Overview Analytics Hook
 * The workspace's headline figures and its six-month completion trend.
 */
export function useWorkspaceAnalytics(workspaceId?: string) {
  const projectsQuery = useProjects(workspaceId);
  const sprintsQuery = useWorkspaceSprints(workspaceId);
  const tasksQuery = useWorkspaceTasks(workspaceId);
  const membersQuery = useWorkspaceMembers(workspaceId);

  const projects = projectsQuery.data;
  const sprints = sprintsQuery.data;
  const allTasks = tasksQuery.data;
  const members = membersQuery.data;
  const rosterFailed = membersQuery.isError;

  const data = useMemo(() => {
    if (!workspaceId || !projects || !sprints || !allTasks) return null;

    const totalTasks = allTasks.length;
    const completedTasks = allTasks.filter((t) => t.status === 'DONE').length;

    // Members that currently hold at least one task
    const teamMembers = new Set<string>();
    allTasks.forEach((task) => {
      (task.assigneeIds || []).forEach((id) => teamMembers.add(id));
    });

    // The last six calendar months, bucketed on the real completion date. Each
    // month is built from its first day: stepping today's date back with
    // setMonth overflows on the 29th–31st (31 March back to "31 November" is
    // 1 December), which listed one month twice and skipped another.
    const now = new Date();
    const monthlyTrends = Array.from({ length: 6 }, (_, i) => {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const nextMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

      const tasksCompletedInMonth = allTasks.filter((t) => {
        if (t.status !== 'DONE') return false;
        const completed = completionDate(t);
        if (!completed) return false;
        const completedOn = new Date(completed);
        return completedOn >= monthStart && completedOn < nextMonthStart;
      }).length;

      return {
        month: monthStart.toLocaleString('default', { month: 'short', year: 'numeric' }),
        completed: tasksCompletedInMonth,
      };
    });

    return {
      projects: {
        total: projects.length,
        active: projects.filter((p) => p.status === 'ACTIVE').length,
      },
      sprints: {
        active: sprints.filter((s) => s.status === 'ACTIVE').length,
      },
      tasks: {
        total: totalTasks,
        completed: completedTasks,
        inProgress: allTasks.filter((t) => t.status === 'IN_PROGRESS').length,
        completionRate: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
      },
      team: {
        // Roster size, not assignee count — see useTeamAnalytics for the same
        // distinction between team membership and active assignment, and for
        // why a failed roster reports null rather than a confident 0.
        size: rosterFailed ? null : (members?.length ?? 0),
        activeAssignees: teamMembers.size,
      },
      monthlyTrends,
    };
  }, [workspaceId, projects, sprints, allTasks, members, rosterFailed]);

  return {
    data,
    isLoading:
      projectsQuery.isLoading ||
      sprintsQuery.isLoading ||
      tasksQuery.isLoading ||
      membersQuery.isLoading,
    /** The workspace roster failed to load, so `team.size` is null. */
    isRosterError: rosterFailed,
    refetchRoster: membersQuery.refetch,
  };
}
