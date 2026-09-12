'use client';

import * as React from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useProjects } from '@/hooks/use-project';
import { useClientRequirements } from '@/hooks/use-client-requirement';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { useIsAdmin, useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { logger } from '@/lib/logger';

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
  const { data: projects = [] } = useProjects(currentWorkspace?.id);
  const router = useRouter();
  const searchParams = useSearchParams();
  const frIdFromUrl = searchParams.get('frId');
  const reqIdFromUrl = searchParams.get('reqId');

  const isAdmin = useIsAdmin();
  const canCreateRequirement = useHasPermission(Permission.CREATE_REQUIREMENT);
  const canEditRequirement = useHasPermission(Permission.EDIT_REQUIREMENT);
  const canDeleteRequirement = useHasPermission(Permission.DELETE_REQUIREMENT);

  const [selectedProjectId, setSelectedProjectId] = React.useState<string>('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<RequirementStatus | 'ALL'>('ALL');
  const [priorityFilter, setPriorityFilter] = React.useState<RequirementPriority | 'ALL'>('ALL');
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [aiGenerateDialogOpen, setAiGenerateDialogOpen] = React.useState(false);
  const [selectedRequirement, setSelectedRequirement] = React.useState<string | null>(null);

  // Handle project selection: prioritize URL param, then localStorage, then first project
  React.useEffect(() => {
    const STORAGE_KEY = 'selected-project-id';
    const urlProjectId = searchParams.get('projectId');
    const savedProjectId = localStorage.getItem(STORAGE_KEY);

    // Priority 1: URL parameter (from "View Requirements" button)
    if (urlProjectId && projects.some((p) => p.id === urlProjectId)) {
      setSelectedProjectId(urlProjectId);
      localStorage.setItem(STORAGE_KEY, urlProjectId);
    }
    // Priority 2: localStorage (previously selected)
    else if (savedProjectId && projects.some((p) => p.id === savedProjectId)) {
      setSelectedProjectId(savedProjectId);
    }
    // Priority 3: First project as default
    else if (projects.length > 0 && !selectedProjectId) {
      const firstProjectId = projects[0].id;
      setSelectedProjectId(firstProjectId);
      localStorage.setItem(STORAGE_KEY, firstProjectId);
    }
  }, [projects, selectedProjectId, searchParams]);

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

  // Global search emits `?reqId=` for its "requirement" hits, but that corpus is
  // functional_requirements (use-global-search), not the client requirements this
  // page lists — so the id can only ever be resolved on /functional-requirements.
  React.useEffect(() => {
    if (!reqIdFromUrl) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('reqId');
    params.set('frId', reqIdFromUrl);
    router.replace(`/functional-requirements?${params.toString()}`);
  }, [reqIdFromUrl, searchParams, router]);

  // Open FR detail dialog if frId is in URL (from notification click)
  React.useEffect(() => {
    if (frIdFromUrl && requirements.length > 0) {
      const requirement = requirements.find((r) => r.id === frIdFromUrl);
      if (requirement) {
        setSelectedRequirement(requirement.id);
        // Clear the frId from URL after opening the dialog
        const params = new URLSearchParams(searchParams.toString());
        params.delete('frId');
        const newUrl = params.toString() ? `/requirements?${params.toString()}` : '/requirements';
        router.replace(newUrl);
      }
    }
  }, [frIdFromUrl, requirements, searchParams, router]);

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
        title="Requirements"
        description="Manage client and functional requirements"
        actions={
          (canCreateRequirement || isAdmin) && (
            <>
              <Button
                variant="outline"
                onClick={() => setAiGenerateDialogOpen(true)}
                disabled={!selectedProjectId}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Generate with AI
              </Button>
              <Button onClick={() => setCreateDialogOpen(true)} disabled={!selectedProjectId}>
                <Plus className="mr-2 h-4 w-4" />
                New Client Requirement
              </Button>
            </>
          )
        }
      />

      {/* Nothing below the picker renders without a project, so say why. */}
      {projects.length === 0 && (
        <EmptyState
          icon={FolderPlus}
          title="No projects yet"
          description="Create a project before capturing client requirements."
          action={{ label: 'Go to Projects', onClick: () => router.push('/projects') }}
        />
      )}

      {/* Project Selector */}
      {projects.length > 0 && (
      <Card>
        <CardHeader>
          <CardTitle>Select Project</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedProjectId} onValueChange={handleProjectChange}>
            <SelectTrigger aria-label="Select a project" className="w-full md:w-[400px]">
              <SelectValue placeholder="Select a project..." />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.shortCode} - {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      )}

      {selectedProjectId && (
        <>
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
                  onValueChange={(value) => setStatusFilter(value as any)}
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
                  onValueChange={(value) => setPriorityFilter(value as any)}
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
                    action={{
                      label: 'Create First Requirement',
                      onClick: () => setCreateDialogOpen(true),
                    }}
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
                            <TableCell className="font-medium">{requirement.title}</TableCell>
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
        canEdit={canEditRequirement || isAdmin}
        canDelete={canDeleteRequirement || isAdmin}
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
