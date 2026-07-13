import { useQuery } from '@tanstack/react-query';
import { useWorkspaceTasks } from './use-task';
import { useSprints } from './use-sprint';
import { useProjects } from './use-project';

/**
 * Project Analytics Hook
 * Returns comprehensive metrics for a specific project
 */
export function useProjectAnalytics(projectId?: string) {
  const { data: allTasks = [] } = useWorkspaceTasks();

  return useQuery({
    queryKey: ['project-analytics', projectId],
    queryFn: async () => {
      if (!projectId) return null;

      // Filter tasks for this project
      const projectTasks = allTasks.filter(task => task.projectId === projectId);

      // Task status distribution
      const statusDistribution = {
        BACKLOG: projectTasks.filter(t => t.status === 'BACKLOG').length,
        TODO: projectTasks.filter(t => t.status === 'TODO').length,
        IN_PROGRESS: projectTasks.filter(t => t.status === 'IN_PROGRESS').length,
        REVIEW: projectTasks.filter(t => t.status === 'REVIEW').length,
        DONE: projectTasks.filter(t => t.status === 'DONE').length,
      };

      // Priority distribution
      const priorityDistribution = {
        LOW: projectTasks.filter(t => t.priority === 'LOW').length,
        MEDIUM: projectTasks.filter(t => t.priority === 'MEDIUM').length,
        HIGH: projectTasks.filter(t => t.priority === 'HIGH').length,
        CRITICAL: projectTasks.filter(t => t.priority === 'CRITICAL').length,
      };

      // Completion metrics
      const totalTasks = projectTasks.length;
      const completedTasks = statusDistribution.DONE;
      const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

      // Time tracking
      const totalEstimatedHours = projectTasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
      const totalActualHours = projectTasks.reduce((sum, t) => sum + (t.actualHours || 0), 0);
      const timeEfficiency = totalEstimatedHours > 0
        ? (totalActualHours / totalEstimatedHours) * 100
        : 0;

      const totalStoryPoints = projectTasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
      const completedStoryPoints = projectTasks
        .filter(t => t.status === 'DONE')
        .reduce((sum, t) => sum + (t.estimatedHours || 0), 0);

      // Overdue tasks
      const now = new Date();
      const overdueTasks = projectTasks.filter(t =>
        t.dueDate &&
        new Date(t.dueDate) < now &&
        t.status !== 'DONE'
      );

      // Tasks by assignee
      const assigneeStats = projectTasks.reduce((acc, task) => {
        const assignees = task.assigneeIds || [];
        assignees.forEach(assigneeId => {
          if (!acc[assigneeId]) {
            acc[assigneeId] = {
              total: 0,
              completed: 0,
              inProgress: 0,
            };
          }
          acc[assigneeId].total++;
          if (task.status === 'DONE') acc[assigneeId].completed++;
          if (task.status === 'IN_PROGRESS') acc[assigneeId].inProgress++;
        });
        return acc;
      }, {} as Record<string, { total: number; completed: number; inProgress: number }>);

      // Completion trend (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const completionTrend = Array.from({ length: 30 }, (_, i) => {
        const date = new Date(thirtyDaysAgo);
        date.setDate(date.getDate() + i);

        const completedOnDay = projectTasks.filter(t => {
          if (!t.updatedAt || t.status !== 'DONE') return false;
          const updatedDate = new Date(t.updatedAt);
          return updatedDate.toDateString() === date.toDateString();
        }).length;

        return {
          date: date.toISOString().split('T')[0],
          completed: completedOnDay,
        };
      });

      return {
        totalTasks,
        completedTasks,
        completionRate,
        statusDistribution,
        priorityDistribution,
        totalEstimatedHours,
        totalActualHours,
        timeEfficiency,
        totalStoryPoints,
        completedStoryPoints,
        overdueTasks: overdueTasks.length,
        overdueTasksList: overdueTasks,
        assigneeStats,
        completionTrend,
      };
    },
    enabled: !!projectId,
  });
}

/**
 * Sprint Analytics Hook
 * Returns metrics for sprint performance
 */
export function useSprintAnalytics(sprintId?: string) {
  const { data: allTasks = [] } = useWorkspaceTasks();

  return useQuery({
    queryKey: ['sprint-analytics', sprintId],
    queryFn: async () => {
      if (!sprintId) return null;

      // Get sprint tasks
      const sprintTasks = allTasks.filter(task => task.sprintId === sprintId);

      const taskBreakdown = {
        total: sprintTasks.length,
        completed: sprintTasks.filter(t => t.status === 'DONE').length,
        inProgress: sprintTasks.filter(t => t.status === 'IN_PROGRESS').length,
        todo: sprintTasks.filter(t => t.status === 'TODO').length,
        blocked: sprintTasks.filter(t => t.status === 'REVIEW').length,
      };

      // Use estimatedHours as a proxy for story points (1 hour ≈ 1 point)
      const totalPoints = sprintTasks.reduce((sum, t) => sum + (t.estimatedHours || 1), 0);
      const completedPoints = sprintTasks
        .filter(t => t.status === 'DONE')
        .reduce((sum, t) => sum + (t.estimatedHours || 1), 0);
      const remainingPoints = totalPoints - completedPoints;
      const velocity = completedPoints;

      // Scope change: tasks added after sprint started (use position as a rough proxy)
      const scopeChange = 0;

      return {
        totalPoints,
        completedPoints,
        remainingPoints,
        velocity,
        taskBreakdown,
        scopeChange,
        completionRate: totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0,
      };
    },
    enabled: !!sprintId,
  });
}

/**
 * Team Performance Analytics Hook
 * Returns team-wide performance metrics
 */
export function useTeamAnalytics(workspaceId?: string) {
  const { data: allTasks = [] } = useWorkspaceTasks(workspaceId);

  return useQuery({
    queryKey: ['team-analytics', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return null;

      // Get unique team members
      const teamMembers = new Set<string>();
      allTasks.forEach(task => {
        (task.assigneeIds || []).forEach(id => teamMembers.add(id));
      });

      // Individual performance
      const memberPerformance = Array.from(teamMembers).map(memberId => {
        const memberTasks = allTasks.filter(t =>
          (t.assigneeIds || []).includes(memberId)
        );

        const completed = memberTasks.filter(t => t.status === 'DONE').length;
        const inProgress = memberTasks.filter(t => t.status === 'IN_PROGRESS').length;
        const total = memberTasks.length;

        const velocityPoints = memberTasks.filter(t => t.status === 'DONE').length;

        // Time efficiency
        const estimatedHours = memberTasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
        const actualHours = memberTasks.reduce((sum, t) => sum + (t.actualHours || 0), 0);

        return {
          memberId,
          totalTasks: total,
          completedTasks: completed,
          inProgressTasks: inProgress,
          completionRate: total > 0 ? (completed / total) * 100 : 0,
          velocity: velocityPoints,
          estimatedHours,
          actualHours,
          efficiency: estimatedHours > 0 ? (actualHours / estimatedHours) * 100 : 0,
        };
      });

      // Team averages
      const avgCompletionRate = memberPerformance.length > 0
        ? memberPerformance.reduce((sum, m) => sum + m.completionRate, 0) / memberPerformance.length
        : 0;

      const avgVelocity = memberPerformance.length > 0
        ? memberPerformance.reduce((sum, m) => sum + m.velocity, 0) / memberPerformance.length
        : 0;

      // Workload distribution
      const workloadDistribution = memberPerformance.map(m => ({
        memberId: m.memberId,
        taskCount: m.totalTasks,
        percentage: allTasks.length > 0 ? (m.totalTasks / allTasks.length) * 100 : 0,
      }));

      return {
        teamSize: teamMembers.size,
        totalTasks: allTasks.length,
        memberPerformance,
        avgCompletionRate,
        avgVelocity,
        workloadDistribution,
      };
    },
    enabled: !!workspaceId,
  });
}

/**
 * Workspace Overview Analytics Hook
 * Returns high-level KPIs for the entire workspace
 */
export function useWorkspaceAnalytics(workspaceId?: string) {
  const { data: projects = [] } = useProjects(workspaceId);
  const { data: sprints = [] } = useSprints(workspaceId);
  const { data: allTasks = [] } = useWorkspaceTasks(workspaceId);

  return useQuery({
    queryKey: ['workspace-analytics', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return null;

      // Project health
      const activeProjects = projects.filter(p => p.status === 'ACTIVE' || p.status === 'PLANNING').length;
      const completedProjects = projects.filter(p => p.status === 'COMPLETED').length;
      const onHoldProjects = projects.filter(p => p.status === 'ON_HOLD').length;

      // Sprint health
      const activeSprints = sprints.filter(s => s.status === 'ACTIVE').length;
      const completedSprints = sprints.filter(s => s.status === 'COMPLETED').length;

      // Overall task metrics
      const totalTasks = allTasks.length;
      const completedTasks = allTasks.filter(t => t.status === 'DONE').length;
      const inProgressTasks = allTasks.filter(t => t.status === 'IN_PROGRESS').length;

      // Time metrics
      const totalEstimatedHours = allTasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
      const totalActualHours = allTasks.reduce((sum, t) => sum + (t.actualHours || 0), 0);

      // Budget: uses estimated vs actual hours as a proxy for planned vs spent effort.
      // To track monetary budget, add `budget` and `hourlyRate` fields to the Project type.
      const totalBudget = totalEstimatedHours;
      const spentBudget = totalActualHours;

      // Team size
      const teamMembers = new Set<string>();
      allTasks.forEach(task => {
        (task.assigneeIds || []).forEach(id => teamMembers.add(id));
      });

      // Monthly trends (last 6 months)
      const monthlyTrends = Array.from({ length: 6 }, (_, i) => {
        const date = new Date();
        date.setMonth(date.getMonth() - (5 - i));

        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);

        const tasksCompletedInMonth = allTasks.filter(t => {
          if (!t.updatedAt || t.status !== 'DONE') return false;
          const updated = new Date(t.updatedAt);
          return updated >= monthStart && updated <= monthEnd;
        }).length;

        return {
          month: date.toLocaleString('default', { month: 'short', year: 'numeric' }),
          completed: tasksCompletedInMonth,
        };
      });

      return {
        projects: {
          total: projects.length,
          active: activeProjects,
          completed: completedProjects,
          onHold: onHoldProjects,
        },
        sprints: {
          total: sprints.length,
          active: activeSprints,
          completed: completedSprints,
        },
        tasks: {
          total: totalTasks,
          completed: completedTasks,
          inProgress: inProgressTasks,
          completionRate: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
        },
        budget: {
          total: totalBudget,
          spent: spentBudget,
          remaining: totalBudget - spentBudget,
          utilization: totalBudget > 0 ? (spentBudget / totalBudget) * 100 : 0,
        },
        time: {
          estimated: totalEstimatedHours,
          actual: totalActualHours,
          efficiency: totalEstimatedHours > 0 ? (totalActualHours / totalEstimatedHours) * 100 : 0,
        },
        team: {
          size: teamMembers.size,
        },
        monthlyTrends,
      };
    },
    enabled: !!workspaceId,
  });
}
