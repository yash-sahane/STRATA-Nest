import type { Task } from '@/types';
import { format, parseISO } from 'date-fns';

export interface TeamMemberWorkload {
  userId: string;
  userName: string;
  userEmail: string;
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  tasksByDay: Record<string, Task[]>;
  workloadPercentage: number; // 0-100+
}

export interface WorkloadSummary {
  members: TeamMemberWorkload[];
  dateRange: { start: Date; end: Date };
  totalTasks: number;
  averageWorkload: number;
}

function isActiveTaskStatus(status: Task['status']): boolean {
  return status === 'TODO' || status === 'IN_PROGRESS' || status === 'REVIEW';
}

export function calculateTeamWorkload(
  tasks: Task[],
  members: Array<{ id: string; userId?: string; name: string; email: string }>,
  startDate: Date,
  endDate: Date
): WorkloadSummary {
  const memberWorkloads: TeamMemberWorkload[] = members.map((member) => {
    // Use userId if available (workspace_members), otherwise fall back to id
    const memberId = member.userId || member.id;

    // Filter tasks assigned to this member
    // Tasks can carry assignees in either field depending on the workflow that created them.
    const memberTasks = tasks.filter((task) => {
      const assigneeIds = task.assigneeIds || [];
      const assignedTo = task.assignedTo || [];
      return (
        (assigneeIds.includes(memberId) || assignedTo.includes(memberId)) && task.status !== 'DONE'
      );
    });

    // Calculate tasks by day
    const tasksByDay: Record<string, Task[]> = {};
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dateKey = format(currentDate, 'yyyy-MM-dd');

      // Tasks due on this date or overdue
      const tasksForDay = memberTasks.filter((task) => {
        if (!task.dueDate) return false;
        const taskDueDate = parseISO(task.dueDate);
        return taskDueDate <= currentDate && task.status !== 'DONE';
      });

      tasksByDay[dateKey] = tasksForDay;
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Calculate workload metrics
    const activeTasks = memberTasks.filter((task) => isActiveTaskStatus(task.status)).length;
    const completedTasks = tasks.filter((task) => {
      const assigneeIds = task.assigneeIds || [];
      const assignedTo = task.assignedTo || [];
      return (
        (assigneeIds.includes(memberId) || assignedTo.includes(memberId)) && task.status === 'DONE'
      );
    }).length;

    // Use task count as a lightweight workload metric (10 tasks => 100%)
    const totalTasks = memberTasks.length;
    const workloadPercentage = (totalTasks / 10) * 100;

    return {
      userId: memberId,
      userName: member.name,
      userEmail: member.email,
      totalTasks,
      activeTasks,
      completedTasks,
      tasksByDay,
      workloadPercentage: Math.round(workloadPercentage),
    };
  });

  const totalTasks = memberWorkloads.reduce((sum, member) => sum + member.totalTasks, 0);
  const averageWorkload =
    members.length > 0
      ? Math.round(
          memberWorkloads.reduce((sum, member) => sum + member.workloadPercentage, 0) /
            members.length
        )
      : 0;

  return {
    members: memberWorkloads,
    dateRange: { start: startDate, end: endDate },
    totalTasks,
    averageWorkload,
  };
}

export function getWorkloadColor(percentage: number): string {
  if (percentage > 150) return 'text-red-600 dark:text-red-400';
  if (percentage > 100) return 'text-orange-600 dark:text-orange-400';
  if (percentage > 70) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-green-600 dark:text-green-400';
}

export function getWorkloadBgColor(percentage: number): string {
  if (percentage > 150) return 'bg-red-100 dark:bg-red-950/30';
  if (percentage > 100) return 'bg-orange-100 dark:bg-orange-950/30';
  if (percentage > 70) return 'bg-yellow-100 dark:bg-yellow-950/30';
  return 'bg-green-100 dark:bg-green-950/30';
}

export function getWorkloadBarColor(percentage: number): string {
  if (percentage > 150) return 'bg-red-500';
  if (percentage > 100) return 'bg-orange-500';
  if (percentage > 70) return 'bg-yellow-500';
  return 'bg-green-500';
}

export function getWorkloadStatus(percentage: number): string {
  if (percentage > 150) return 'Overloaded';
  if (percentage > 100) return 'High Load';
  if (percentage > 70) return 'Busy';
  if (percentage > 30) return 'Moderate';
  return 'Light';
}
