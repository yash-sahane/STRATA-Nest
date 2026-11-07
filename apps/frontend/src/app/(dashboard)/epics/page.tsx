'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useCreateActionParam } from '@/hooks/use-create-action-param';
import { useEpicsRealtime } from '@/hooks/use-realtime';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useProjects } from '@/hooks/use-project';
import { deriveEpicMetrics, useEpics } from '@/hooks/use-epic';
import { useTasks } from '@/hooks/use-task';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Plus, Target, CheckCircle2, Clock, TrendingUp, Calendar } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { CreateEpicDialog } from '@/components/epic/create-epic-dialog';
import { EpicDetailDialog } from '@/components/epic/epic-detail-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { getEpicStatusConfig } from '@/lib/semantic/status';
import { InlineLoader } from '@/components/ui/page-loader';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { ProjectPicker } from '@/components/projects/project-picker';
import { useProjectSelectionSync } from '@/hooks/use-project-selection-sync';
import { useConsumeParam } from '@/hooks/use-tab-param';

const CREATE_CARRIES = ['requirementId'];

function EpicsPageContent() {
  const { currentWorkspace } = useCurrentWorkspace();
  const { data: projects = [] } = useProjects(currentWorkspace?.id);
  const searchParams = useSearchParams();
  const projectIdFromUrl = searchParams.get('projectId');
  const epicIdFromUrl = searchParams.get('epicId');

  // Permission checks
  const canCreateEpic = useHasPermission(Permission.CREATE_EPIC);
  const canDeleteEpic = useHasPermission(Permission.DELETE_EPIC);
  const canEditEpic = useHasPermission(Permission.EDIT_EPIC);

  const [selectedProjectId, setSelectedProjectId] = React.useState<string>('');
  // Realtime: an epic deleted by a teammate used to stay on this page until a refresh.
  useEpicsRealtime(selectedProjectId);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  // The ID, never the row. Holding the Epic OBJECT froze the open detail dialog
  // at the snapshot it was opened with: after an edit saved, the invalidated
  // ['epics', projectId] refetch replaced the list but not that snapshot, so
  // clearing Start/Target End left the Timeline still showing the deleted dates
  // and reopening Edit re-seeded them. Resolving it out of `epics` on every
  // render means the dialog always renders the row the cache holds.
  const [selectedEpicId, setSelectedEpicId] = React.useState<string | null>(null);
  // The command palette's "New Epic" navigates here with ?action=create.
  // Gated on a project the same way the "New Epic" button is — an epic needs one.
  // ?action=create&requirementId=… — raised from a client requirement.
  const [createFor, setCreateFor] = React.useState('');
  useCreateActionParam(
    (asked) => {
      setCreateFor(asked.get('requirementId') ?? '');
      setCreateDialogOpen(true);
    },
    !!selectedProjectId,
    CREATE_CARRIES
  );

  const { data: epics = [], isLoading, isError, refetch } = useEpics(selectedProjectId);
  const { data: tasks = [], isLoading: tasksLoading } = useTasks(selectedProjectId);

  const selectedEpic = React.useMemo(
    () => epics.find((e) => e.id === selectedEpicId) ?? null,
    [epics, selectedEpicId]
  );

  // Restore project selection from URL or localStorage
  // URL param (once) > remembered project > first project.
  useProjectSelectionSync({
    projects,
    urlProjectId: projectIdFromUrl,
    selectedProjectId,
    setSelectedProjectId,
  });

  // ?epicId= opens that epic, and is spent once it is open (useConsumeParam):
  // router.replace left it on the address bar, and a refetch reopened the dialog.
  React.useEffect(() => {
    if (!epicIdFromUrl || epics.length === 0) return;
    if (epics.some((e) => e.id === epicIdFromUrl)) setSelectedEpicId(epicIdFromUrl);
  }, [epicIdFromUrl, epics]);
  useConsumeParam('epicId', Boolean(epicIdFromUrl) && selectedEpicId === epicIdFromUrl);

  // Save project selection to localStorage when changed
  const handleProjectChange = React.useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    localStorage.setItem('selected-project-id', projectId);
  }, []);

  // Every epic's rollup, derived once from this project's tasks.
  //
  // The card badge and the stat tiles used to read the STORED `epic.status`
  // while the detail dialog behind the very same card derived it, so an epic
  // whose last task had been deleted showed "Done - 0% - Tasks 0 / 0" on the
  // card and "Todo (Auto-calculated from tasks)" one click later, and the
  // "Completed" tile counted it. deriveEpicMetrics is the single answer.
  const metricsByEpic = React.useMemo(() => {
    const tasksByEpic = new Map<string, typeof tasks>();
    for (const task of tasks) {
      if (!task.epicId) continue;
      const bucket = tasksByEpic.get(task.epicId);
      if (bucket) bucket.push(task);
      else tasksByEpic.set(task.epicId, [task]);
    }
    return new Map<string, ReturnType<typeof deriveEpicMetrics>>(
      epics.map((epic) => [epic.id, deriveEpicMetrics(epic, tasksByEpic.get(epic.id) ?? [])] as const)
    );
  }, [epics, tasks]);

  // Calculate stats
  const stats = React.useMemo(() => {
    const statuses = epics.map((e) => metricsByEpic.get(e.id)?.status ?? 'TODO');
    return {
      total: epics.length,
      todo: statuses.filter((s) => s === 'TODO').length,
      inProgress: statuses.filter((s) => s === 'IN_PROGRESS').length,
      done: statuses.filter((s) => s === 'DONE').length,
    };
  }, [epics, metricsByEpic]);

  // Epic dates are date-only wire values ("2026-08-11"). `new Date(...)` reads
  // those as UTC midnight and renders the previous day west of UTC.
  const formatEpicDate = (value: string) => format(parseISO(value), 'MMM d, yyyy');

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={Target}
        title="Epics"
        description="The features that deliver your client requirements, each broken into functional requirements"
        actions={
          (canCreateEpic) && (
            <Button onClick={() => setCreateDialogOpen(true)} disabled={!selectedProjectId}>
              <Plus className="mr-2 h-4 w-4" />
              New Epic
            </Button>
          )
        }
      />

      {/* Project Selector */}
      <Card>
        <CardHeader>
          <CardTitle>Select Project</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectPicker
            projects={projects}
            value={selectedProjectId}
            onChange={handleProjectChange}
            className="md:w-[400px]"
          />
        </CardContent>
      </Card>

      {selectedProjectId && (
        <>
          {/* Stats */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Epics</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.total}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">To Do</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.todo}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">In Progress</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.inProgress}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Completed</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.done}</div>
              </CardContent>
            </Card>
          </div>

          {/* Epics Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* tasksLoading counts as loading: every number on a card is derived
                from the task set, so drawing one before the tasks arrive shows
                an epic as Todo / 0% for a beat and then corrects itself. */}
            {isLoading || tasksLoading ? (
              <div className="col-span-full">
                <InlineLoader />
              </div>
            ) : isError ? (
              <div className="col-span-full">
                <ErrorState onRetry={() => refetch()} />
              </div>
            ) : epics.length === 0 ? (
              <div className="col-span-full">
                <EmptyState
                  icon={Target}
                  title="No epics yet"
                  description="Create your first epic to group related functional requirements."
                  action={
                    canCreateEpic
                      ? { label: 'New Epic', onClick: () => setCreateDialogOpen(true) }
                      : undefined
                  }
                />
              </div>
            ) : (
              epics.map((epic) => {
                const metrics = metricsByEpic.get(epic.id) ?? deriveEpicMetrics(epic, []);
                const status = getEpicStatusConfig(metrics.status);

                return (
                  <Card
                    key={epic.id}
                    // The card is the only way into an epic's detail dialog, so
                    // without this a keyboard user could never open, edit or
                    // delete one — Tab went straight from the project picker to
                    // the sidebar. It cannot be a <button>: it contains the
                    // status badge and progress bar, and nesting interactives is
                    // what the drag-handle split elsewhere exists to avoid.
                    role="button"
                    tabIndex={0}
                    aria-label={`Open epic: ${epic.name}`}
                    className="cursor-pointer hover-lift outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    onClick={() => setSelectedEpicId(epic.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedEpicId(epic.id);
                      }
                    }}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between mb-2">
                        <Badge variant="outline" className="font-mono">
                          {epic.hierarchyId}
                        </Badge>
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: epic.color }}
                        />
                      </div>
                      <CardTitle className="text-lg">{epic.name}</CardTitle>
                      {epic.description && (
                        <CardDescription className="line-clamp-2">
                          {epic.description}
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Status */}
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Status</span>
                        <Badge variant={status.badgeVariant}>{status.label}</Badge>
                      </div>

                      {/* Progress */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Progress</span>
                          <span className="font-medium">{metrics.progress}%</span>
                        </div>
                        <Progress value={metrics.progress} />
                      </div>

                      {/* Tasks */}
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Tasks</span>
                        <span className="font-medium">
                          {metrics.completedTasks} / {metrics.totalTasks}
                        </span>
                      </div>

                      {/* Dates */}
                      {(epic.startDate || epic.endDate) && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {epic.startDate && <span>{formatEpicDate(epic.startDate)}</span>}
                          {epic.startDate && epic.endDate && <span>→</span>}
                          {epic.endDate && <span>{formatEpicDate(epic.endDate)}</span>}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Create Dialog */}
      <CreateEpicDialog
        open={createDialogOpen}
        onOpenChange={(next) => {
          setCreateDialogOpen(next);
          if (!next) setCreateFor('');
        }}
        defaultRequirementId={createFor}
        projectId={selectedProjectId}
        projectCode={selectedProject?.shortCode || ''}
        workspaceId={currentWorkspace?.id || ''}
      />

      {/* Detail Dialog */}
      {selectedEpic && (
        <EpicDetailDialog
          epic={selectedEpic}
          open={!!selectedEpic}
          onOpenChange={(open: boolean) => !open && setSelectedEpicId(null)}
          projectId={selectedProjectId}
          tasks={tasks.filter((t) => t.epicId === selectedEpic.id)}
          canDelete={canDeleteEpic}
          canEdit={canEditEpic}
        />
      )}
    </div>
  );
}

// useSearchParams() bails out of prerendering, which fails `next build` unless a
// Suspense boundary sits above the component that reads it.
export default function EpicsPage() {
  return (
    <React.Suspense fallback={<InlineLoader />}>
      <EpicsPageContent />
    </React.Suspense>
  );
}
