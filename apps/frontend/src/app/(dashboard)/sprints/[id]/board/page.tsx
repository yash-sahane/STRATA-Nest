'use client';

import { SprintHeader, SprintUnavailable } from '@/components/sprints/sprint-header';
import { sprintFigures } from '@/lib/sprint-figures';
import { PageLoader } from '@/components/ui/page-loader';
import { ErrorState } from '@/components/ui/error-state';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useWorkspaces } from '@/hooks/use-workspace';
import { useSprint } from '@/hooks/use-sprint';
import { useTasks } from '@/hooks/use-task';
import { useTasksRealtime, useSprintsRealtime } from '@/hooks/use-realtime';
import { useFunctionalRequirementsBySprint } from '@/hooks/use-functional-requirement';
import { FunctionalRequirementStatus, TaskStatus } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SprintBoard } from '@/components/sprints/sprint-board';
import { TaskDetailsDialog } from '@/components/tasks/task-details-dialog';
import { useTaskReview } from '@/hooks/use-task-review';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { BurndownChart } from '@/components/sprints/burndown-chart';

const getBoardStatusForFR = (status: FunctionalRequirementStatus): TaskStatus => {
  switch (status) {
    case 'IMPLEMENTED': return 'IN_PROGRESS';
    case 'TESTED': return 'REVIEW';
    case 'DEPLOYED': return 'DONE';
    default: return 'TODO';
  }
};

export default function SprintBoardPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  useWorkspaces(user?.id); // Keep workspace context active
  const sprintId = params.id as string;

  const {
    data: sprint,
    isLoading: sprintLoading,
    isError: sprintError,
    error: sprintLoadError,
    refetch: refetchSprint,
  } = useSprint(sprintId);
  const {
    data: allTasks,
    isLoading: tasksLoading,
    isError: tasksError,
    refetch: refetchTasks,
  } = useTasks(sprint?.projectId);
  const { data: sprintFRs } = useFunctionalRequirementsBySprint(sprintId);

  // Enable real-time updates
  useTasksRealtime(sprint?.projectId);
  useSprintsRealtime(sprint?.projectId);

  // The task whose details are open. Held by id and read back out of the live
  // list, so the dialog follows a save made while it is up.
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null);
  const openTask = React.useMemo(
    () => allTasks?.find((task) => task.id === openTaskId) ?? null,
    [allTasks, openTaskId]
  );
  const canEditTasks = useHasPermission(Permission.EDIT_ANY_TASK);
  const review = useTaskReview();

  // Filter tasks for this sprint
  const sprintTasks = React.useMemo(() => {
    if (!allTasks || !sprintId) return [];
    return allTasks.filter((task) => task.sprintId === sprintId);
  }, [allTasks, sprintId]);

  // Filter out FRs that are already represented by tasks in this sprint
  const visibleFRs = React.useMemo(() => {
    if (!sprintFRs) return [];
    const linkedFRIds = new Set(sprintTasks.map(t => t.functionalRequirementId).filter(Boolean));
    return sprintFRs.filter(fr => !linkedFRIds.has(fr.id));
  }, [sprintFRs, sprintTasks]);

  // How far it got — the same figure Analytics and the sprint list give
  // (sprintFigures: tasks only, and a closed sprint as it closed). The stat
  // card and the Burndown tab both read it, so the two cannot disagree.
  const figures = React.useMemo(() => sprintFigures(sprint, sprintTasks), [sprint, sprintTasks]);

  // Calculate stats
  const stats = React.useMemo(() => {
    const frStatuses = visibleFRs.map(fr => getBoardStatusForFR(fr.status));
    
    const total = sprintTasks.length + visibleFRs.length;
    
    const completed = sprintTasks.filter(t => t.status === 'DONE').length + 
                      frStatuses.filter(s => s === 'DONE').length;
                      
    const inProgress = sprintTasks.filter(t => t.status === 'IN_PROGRESS').length + 
                       frStatuses.filter(s => s === 'IN_PROGRESS').length;
                       
    const review = sprintTasks.filter(t => t.status === 'REVIEW').length + 
                   frStatuses.filter(s => s === 'REVIEW').length;
                   
    const todo = sprintTasks.filter(t => t.status === 'TODO').length +
                 frStatuses.filter(s => s === 'TODO').length;

    // BACKLOG is a real status (auto-created sprint tasks start there). Without
    // its own bucket it counted towards `total` but towards none of the cards,
    // so the four numbers did not sum and completionRate was understated.
    const backlog = sprintTasks.filter(t => t.status === 'BACKLOG').length;

    const recorded =
      figures.source === 'snapshot' ? { total: figures.total, completed: figures.completed } : null;

    return {
      total,
      // Kept apart so the card can say what the total is made of. The Analytics
      // tab counts tasks alone, and until the board said which it was counting,
      // the two tabs showed different numbers under the same word.
      taskCount: sprintTasks.length,
      frCount: visibleFRs.length,
      completed,
      inProgress,
      review,
      todo,
      backlog,
      recorded,
      completionRate: figures.completionRate,
    };
  }, [sprintTasks, visibleFRs, figures]);

  if (sprintLoading || tasksLoading) {
    return <PageLoader message="Loading sprint board..." />;
  }

  // isError BEFORE the not-found branch: a 500 or an offline blip leaves
  // `sprint` undefined exactly like a deleted sprint does. SprintUnavailable
  // tells the two apart — a retry for the blip, a way back for the 404.
  if (sprintError || !sprint) {
    return (
      <SprintUnavailable
        error={sprintError ? sprintLoadError : null}
        onRetry={() => void refetchSprint()}
      />
    );
  }

  const header = (
    <SprintHeader sprint={sprint} current="board" description="Move the sprint's work across the board as it gets done" />
  );

  // Without its tasks the board is empty, and an empty board says "nothing in
  // this sprint" rather than "couldn't load it" — with nothing to retry. Only
  // when there is no list at all: a failed background refetch keeps the cached one.
  if (tasksError && !allTasks) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title="Couldn't load this sprint's tasks"
          description="The board needs them to show anything. This is a connection or server problem — try again."
          onRetry={() => void refetchTasks()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header — shared by the sprint's three views. */}
      {header}

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Board Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.frCount > 0
                ? `${stats.taskCount} ${stats.taskCount === 1 ? 'task' : 'tasks'} · ` +
                  `${stats.frCount} ${stats.frCount === 1 ? 'requirement' : 'requirements'}`
                : `${stats.taskCount} ${stats.taskCount === 1 ? 'task' : 'tasks'}`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Backlog</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-600 dark:text-gray-400">
              {stats.backlog}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">To Do</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-600 dark:text-slate-400">
              {stats.todo}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-info-text">
              {stats.inProgress}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Review</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {stats.review}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success-text">
              {stats.completed}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.recorded
                ? `${stats.completionRate}% of the ${stats.recorded.total} tasks it closed with`
                : `${stats.completionRate}% of its tasks done`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Board and Charts */}
      <Tabs defaultValue="board" className="space-y-4">
        <TabsList>
          <TabsTrigger value="board">Sprint Board</TabsTrigger>
          <TabsTrigger value="burndown">Burndown Chart</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="space-y-4">
          <SprintBoard
            tasks={sprintTasks}
            frs={visibleFRs}
            onTaskClick={(task) => setOpenTaskId(task.id)}
            // A closed sprint is a record. Dragging a Done card back to To Do
            // put open work inside a sprint that will never roll it out.
            readOnly={sprint.status === 'COMPLETED'}
            started={sprint.status !== 'PLANNING'}
          />
        </TabsContent>

        <TabsContent value="burndown" className="space-y-4">
          {sprint.startDate && sprint.endDate ? (
            <BurndownChart
              tasks={sprintTasks}
              sprintStartDate={sprint.startDate}
              sprintEndDate={sprint.endDate}
              figures={figures}
            />
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center h-[400px]">
                <p className="text-muted-foreground">
                  Sprint dates not configured. Please set start and end dates in sprint settings.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Reading, commenting and logging time happen here. Editing hands over to
          the Tasks page, which owns the one task editor — with the task already
          open in it, and scoped to the whole project so it is there to be found. */}
      <TaskDetailsDialog
        task={openTask}
        open={openTask !== null}
        onOpenChange={(open) => {
          if (!open) setOpenTaskId(null);
        }}
        onEdit={
          canEditTasks
            ? (task) =>
                router.push(
                  `/tasks?projectId=${task.projectId}&taskId=${task.id}&scope=all&edit=1`
                )
            : undefined
        }
        canEditDependencies={canEditTasks}
        onMoveStatus={review.move}
        canSignOff={review.canSignOff}
      />
    </div>
  );
}
