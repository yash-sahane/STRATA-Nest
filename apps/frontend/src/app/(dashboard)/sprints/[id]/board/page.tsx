'use client';

import { PageHeader } from '@/components/layout/page-header';
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
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, BarChart3, ListChecks } from 'lucide-react';
import { SprintBoard } from '@/components/sprints/sprint-board';
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
    refetch: refetchSprint,
  } = useSprint(sprintId);
  const { data: allTasks, isLoading: tasksLoading } = useTasks(sprint?.projectId);
  const { data: sprintFRs } = useFunctionalRequirementsBySprint(sprintId);

  // Enable real-time updates
  useTasksRealtime(sprint?.projectId);
  useSprintsRealtime(sprint?.projectId);

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
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }, [sprintTasks, visibleFRs]);

  if (sprintLoading || tasksLoading) {
    return <PageLoader message="Loading sprint board..." />;
  }

  // isError BEFORE the not-found branch. A 500 (or an offline blip) leaves
  // `sprint` undefined exactly like a deleted sprint does, so every sub-page
  // told the user a sprint that plainly exists was "Sprint not found" — a
  // dead end with nothing to retry.
  if (sprintError) {
    return (
      <ErrorState
        className="mt-10"
        title="Couldn't load this sprint"
        description="The sprint is still there — this is a connection problem."
        onRetry={() => void refetchSprint()}
      />
    );
  }

  if (!sprint) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] space-y-4">
        <p className="text-muted-foreground">Sprint not found</p>
        <Button onClick={() => router.push('/sprints')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Sprints
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/sprints')}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Sprints
        </Button>
        
        <PageHeader
          title={sprint.name}
          description={sprint.goal || 'Drag and drop tasks to update their status'}
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => router.push(`/sprints/${sprintId}/backlog`)}
              >
                <ListChecks className="mr-2 h-4 w-4" />
                Backlog
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push(`/sprints/${sprintId}/analytics`)}
              >
                <BarChart3 className="mr-2 h-4 w-4" />
                Analytics
              </Button>
            </>
          }
        />
      </div>

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
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
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
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {stats.completed}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.completionRate}% complete
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
          <SprintBoard tasks={sprintTasks} frs={visibleFRs} />
        </TabsContent>

        <TabsContent value="burndown" className="space-y-4">
          {sprint.startDate && sprint.endDate ? (
            <BurndownChart
              tasks={sprintTasks}
              sprintStartDate={sprint.startDate}
              sprintEndDate={sprint.endDate}
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
    </div>
  );
}
