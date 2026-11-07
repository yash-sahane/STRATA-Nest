'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useClientRequirementsRealtime } from '@/hooks/use-realtime';
import { useIsProjectArchived, useProjects } from '@/hooks/use-project';
import { ArchivedProjectBanner } from '@/components/projects/archived-project-banner';
import { useFunctionalRequirements } from '@/hooks/use-functional-requirement';
import { useClientRequirements } from '@/hooks/use-client-requirement';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RowActivator } from '@/components/ui/row-activator';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Search, FileText, CheckCircle2, Clock, Archive, Sparkles, FolderPlus } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import type { RequirementStatus, RequirementPriority } from '@/types';
import { CreateClientRequirementDialog } from '@/components/requirements/create-client-requirement-dialog';
import { ClientRequirementDetailDialog } from '@/components/requirements/client-requirement-detail-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { getRequirementStatusConfig } from '@/lib/semantic/status';
import { getPriorityConfig } from '@/lib/semantic/priority';
import { InlineLoader, PageLoader } from '@/components/ui/page-loader';
import { AIGenerateDialog } from '@/components/ai/ai-generate-dialog';
import type { GeneratedHierarchy } from '@/lib/ai-generator';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { logger } from '@/lib/logger';
import { ProjectPicker } from '@/components/projects/project-picker';
import { useProjectSelectionSync } from '@/hooks/use-project-selection-sync';
import { useConsumeParam } from '@/hooks/use-tab-param';

// Add permission for requirements (using epic permission as proxy since requirements follow similar hierarchy)
// Note: In a production app, you might want to add specific requirement permissions

/**
 * Icon per status. Colour and label come from lib/semantic/status — this map
 * only owns the icon, which is a separate axis from tone.
 */
const statusIcons: Record<RequirementStatus, React.ComponentType<{ className?: string }>> = {
  DRAFT: FileText,
  SUBMITTED: Clock,
  APPROVED: CheckCircle2,
  IN_PROGRESS: Clock,
  COMPLETED: CheckCircle2,
  ARCHIVED: Archive,
};

function RequirementsPageContent() {
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const { data: projects = [], isLoading: projectsLoading } = useProjects(currentWorkspace?.id);
  const searchParams = useSearchParams();
  const crIdFromUrl = searchParams.get('crId');

  const [selectedProjectId, setSelectedProjectId] = React.useState<string>('');
  // An archived project is read-only (the server refuses the change): no new,
  // edited, generated or deleted requirement is offered while it is open.
  const projectArchived = useIsProjectArchived(selectedProjectId);

  const canCreateRequirement = useHasPermission(Permission.CREATE_REQUIREMENT) && !projectArchived;
  // A generated plan is saved as requirements AND epics AND tasks, and the API
  // checks all three (requirement:write, planning:write, task:create) before it
  // calls the model. Offered on requirement:write alone, a custom role could run
  // a generation only to be refused at the end.
  const canCreateEpics = useHasPermission(Permission.CREATE_EPIC) && !projectArchived;
  const canCreateTasks = useHasPermission(Permission.CREATE_TASK) && !projectArchived;
  const canGenerate = canCreateRequirement && canCreateEpics && canCreateTasks;
  const canEditRequirement = useHasPermission(Permission.EDIT_REQUIREMENT) && !projectArchived;
  const canDeleteRequirement = useHasPermission(Permission.DELETE_REQUIREMENT) && !projectArchived;

  // Realtime for this list.
  useClientRequirementsRealtime(selectedProjectId);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<RequirementStatus | 'ALL'>('ALL');
  const [priorityFilter, setPriorityFilter] = React.useState<RequirementPriority | 'ALL'>('ALL');
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [aiGenerateDialogOpen, setAiGenerateDialogOpen] = React.useState(false);
  const [selectedRequirement, setSelectedRequirement] = React.useState<string | null>(null);

  // How much of each is delivered: the functional requirements raised for it,
  // and how many of those are done — the figure its dialog gives.
  const { data: functionalRequirements = [] } = useFunctionalRequirements(selectedProjectId || undefined);
  const deliveryOf = React.useMemo(() => {
    const byRequirement = new Map<string, { total: number; done: number }>();
    for (const fr of functionalRequirements) {
      if (!fr.clientRequirementId) continue;
      const entry = byRequirement.get(fr.clientRequirementId) ?? { total: 0, done: 0 };
      entry.total += 1;
      if (fr.status === 'DEPLOYED') entry.done += 1;
      byRequirement.set(fr.clientRequirementId, entry);
    }
    return byRequirement;
  }, [functionalRequirements]);

  // URL param from "View Requirements" (once) > remembered project > first project.
  useProjectSelectionSync({
    projects,
    urlProjectId: searchParams.get('projectId'),
    selectedProjectId,
    setSelectedProjectId,
  });

  // Save project selection to localStorage when changed
  const handleProjectChange = React.useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    localStorage.setItem('selected-project-id', projectId);
  }, []);

  const {
    data: requirements = [],
    isLoading,
    isError,
    refetch,
  } = useClientRequirements(selectedProjectId);

  // ?crId= (a link, a notification) opens that client requirement, and is spent
  // once it is open — as on the functional-requirements page. router.replace left
  // it on the address bar, and every refetch of the list reopened the dialog.
  React.useEffect(() => {
    if (!crIdFromUrl || requirements.length === 0) return;
    if (requirements.some((r) => r.id === crIdFromUrl)) setSelectedRequirement(crIdFromUrl);
  }, [crIdFromUrl, requirements]);
  useConsumeParam('crId', Boolean(crIdFromUrl) && selectedRequirement === crIdFromUrl);

  // Filter requirements
  const filteredRequirements = React.useMemo(() => {
    return requirements.filter((req) => {
      const matchesSearch =
        req.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        req.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        req.clientName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'ALL' || req.status === statusFilter;
      const matchesPriority = priorityFilter === 'ALL' || req.priority === priorityFilter;

      return matchesSearch && matchesStatus && matchesPriority;
    });
  }, [requirements, searchQuery, statusFilter, priorityFilter]);

  // Calculate stats
  const stats = React.useMemo(() => {
    return {
      total: requirements.length,
      draft: requirements.filter((r) => r.status === 'DRAFT').length,
      submitted: requirements.filter((r) => r.status === 'SUBMITTED').length,
      approved: requirements.filter((r) => r.status === 'APPROVED').length,
      inProgress: requirements.filter((r) => r.status === 'IN_PROGRESS').length,
      completed: requirements.filter((r) => r.status === 'COMPLETED').length,
    };
  }, [requirements]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // The dialog now handles bulk save internally, this callback is for any additional handling
  const handleAIGenerated = (generated: GeneratedHierarchy) => {
    logger.debug('AI Generated Data', { generated });
    // The dialog handles saving, toasts, and page reload
  };

  return (
    <div className="space-y-6">
      {/* Header. The two actions measure 410px and never shrink, so the title
          column is only what the sidebar and the buttons leave it: 137px at
          640px wide, 50px at 768px (where the 256px sidebar appears). The <h1>
          needs 232px — 192px of "Requirements" plus a 28px icon and a 12px gap
          — and cannot wrap, so below ~976px its box hangs out of the column and
          over the buttons.
          Wrap on CONTENT, not on a breakpoint: flex-basis gives the title
          column a 240px floor, so the actions drop to their own line exactly
          when 240 + 16 + <actions> stops fitting. A `md:flex-col` override
          would instead be pinned to today's 410px of buttons — it would miss
          the 640-767px band entirely and reopen the overlap at >=1024px (only
          46px of slack there) the next time a label grows. */}
      <PageHeader
        className="sm:flex-wrap sm:[&>div:first-child]:grow sm:[&>div:first-child]:basis-60"
        icon={FileText}
        title="Client Requirements"
        description="What the client has asked for. Each one is broken down into epics and functional requirements."
        actions={
          (canCreateRequirement) && (
            <>
              {canGenerate && (
                <Button
                  variant="outline"
                  onClick={() => setAiGenerateDialogOpen(true)}
                  disabled={!selectedProjectId}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate with AI
                </Button>
              )}
              <Button onClick={() => setCreateDialogOpen(true)} disabled={!selectedProjectId}>
                <Plus className="mr-2 h-4 w-4" />
                New Client Requirement
              </Button>
            </>
          )
        }
      />

      {/* While the projects query is in flight we do not KNOW whether this
          workspace has any, and `data = []` is what React Query holds either
          way — so the empty state below waits for an answer rather than
          asserting one. Telling a workspace that plainly has projects to
          "create a project" was a straight lie for as long as the request took. */}
      {projectsLoading && <Skeleton className="h-40 w-full" />}

      {/* Nothing below the picker renders without a project, so say why. */}
      {!projectsLoading && projects.length === 0 && (
        <EmptyState
          icon={FolderPlus}
          title="No projects yet"
          description="Create a project before capturing client requirements."
          action={{ label: 'Go to Projects', href: '/projects' }}
        />
      )}

      {/* Project Selector */}
      {projects.length > 0 && (
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
      )}

      {selectedProjectId && (
        <>
          <ArchivedProjectBanner projectId={selectedProjectId} />

          {/* Stats */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.total}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Draft</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.draft}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Submitted</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.submitted}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Approved</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.approved}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">In Progress</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
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
                <div className="text-2xl font-bold">{stats.completed}</div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search requirements..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </div>
                <Select
                  value={statusFilter}
                  onValueChange={(value) => setStatusFilter(value as RequirementStatus | 'ALL')}
                >
                  <SelectTrigger aria-label="Filter requirements by status" className="w-full md:w-[200px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Statuses</SelectItem>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="SUBMITTED">Submitted</SelectItem>
                    <SelectItem value="APPROVED">Approved</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                    <SelectItem value="ARCHIVED">Archived</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={priorityFilter}
                  onValueChange={(value) => setPriorityFilter(value as RequirementPriority | 'ALL')}
                >
                  <SelectTrigger aria-label="Filter requirements by priority" className="w-full md:w-[200px]">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Priorities</SelectItem>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Requirements Table */}
          <Card>
            <CardHeader>
              <CardTitle>Client Requirements</CardTitle>
              <CardDescription>
                {filteredRequirements.length} of {requirements.length} requirements
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <InlineLoader />
              ) : isError ? (
                <ErrorState onRetry={() => refetch()} />
              ) : filteredRequirements.length === 0 ? (
                requirements.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title="No client requirements yet"
                    description="Capture your first client requirement to start the delivery chain."
                    action={
                      canCreateRequirement
                        ? {
                            label: 'New Client Requirement',
                            onClick: () => setCreateDialogOpen(true),
                          }
                        : undefined
                    }
                  />
                ) : (
                  <EmptyState
                    icon={Search}
                    title="No requirements match your filters"
                    description="Try a different search term or status filter."
                  />
                )
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Delivered</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRequirements.map((requirement) => {
                        const status = getRequirementStatusConfig(requirement.status);
                        const priority = getPriorityConfig(requirement.priority);
                        const StatusIcon = statusIcons[requirement.status] ?? FileText;

                        return (
                          <TableRow
                            key={requirement.id}
                            className="cursor-pointer hover:bg-accent"
                            onClick={() => setSelectedRequirement(requirement.id)}
                          >
                            <TableCell className="font-medium">
                              {/* Keyboard path to the row's own action: a
                                  <TableRow> is not focusable and Enter does
                                  nothing to it. A sibling of the row's action
                                  button, not its ancestor. */}
                              <RowActivator
                                label={`Open requirement: ${requirement.title}`}
                                onActivate={() => setSelectedRequirement(requirement.id)}
                                className="font-medium"
                              >
                                {requirement.title}
                              </RowActivator>
                            </TableCell>
                            <TableCell>{requirement.clientName}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <span className={`h-2 w-2 rounded-full ${priority.dot}`} />
                                <span className="text-sm">{priority.label}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={status.badgeVariant}
                                className="flex items-center gap-1 w-fit"
                              >
                                <StatusIcon className="h-3 w-3" />
                                {status.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">
                              {(() => {
                                const raised = deliveryOf.get(requirement.id);
                                return raised && raised.total > 0 ? (
                                  `${raised.done} of ${raised.total} done`
                                ) : (
                                  <span className="text-muted-foreground">Nothing raised yet</span>
                                );
                              })()}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDate(requirement.createdAt)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedRequirement(requirement.id);
                                }}
                              >
                                View Details
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Create Dialog */}
      <CreateClientRequirementDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        projectId={selectedProjectId}
        workspaceId={currentWorkspace?.id || ''}
        userId={user?.id || ''}
        clientName={selectedProject?.clientName || ''}
      />

      {/* AI Generate Dialog */}
      <AIGenerateDialog
        open={aiGenerateDialogOpen}
        onOpenChange={setAiGenerateDialogOpen}
        projectId={selectedProjectId}
        projectCode={selectedProject?.shortCode || ''}
        workspaceId={currentWorkspace?.id || ''}
        userId={user?.id || ''}
        onGenerated={handleAIGenerated}
      />

      {/* Detail Dialog */}
      <ClientRequirementDetailDialog
        requirementId={selectedRequirement}
        open={!!selectedRequirement}
        onOpenChange={(open: boolean) => !open && setSelectedRequirement(null)}
        projectId={selectedProjectId}
        canEdit={canEditRequirement}
        canDelete={canDeleteRequirement}
      />
    </div>
  );
}

// useSearchParams() bails out of prerendering, which fails `next build` unless a
// Suspense boundary sits above the component that reads it.
export default function RequirementsPage() {
  return (
    <React.Suspense fallback={<PageLoader message="Loading requirements..." />}>
      <RequirementsPageContent />
    </React.Suspense>
  );
}
