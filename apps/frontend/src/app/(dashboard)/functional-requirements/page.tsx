'use client';

import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/ui/error-state';
import {
  FUNCTIONAL_REQUIREMENT_STATUSES,
  getFunctionalRequirementStatusConfig,
} from '@/lib/semantic/status';
import { getPriorityConfig } from '@/lib/semantic/priority';
import { getComplexityConfig } from '@/lib/semantic/complexity';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineLoader, PageLoader } from '@/components/ui/page-loader';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useProjects } from '@/hooks/use-project';
import {
  useFunctionalRequirement,
  useFunctionalRequirements,
} from '@/hooks/use-functional-requirement';
import { useClientRequirements } from '@/hooks/use-client-requirement';
import { useEpics } from '@/hooks/use-epic';
import { useTasks } from '@/hooks/use-task';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, FileText, Search, Filter, FolderPlus } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { formatDate } from '@/lib/utils';
import type { FunctionalRequirement } from '@/types';
import { CreateFunctionalRequirementDialog } from '@/components/requirements/create-functional-requirement-dialog';
import { FunctionalRequirementDetailDialog } from '@/components/requirements/functional-requirement-detail-dialog';
import { useIsAdmin, useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';

function FunctionalRequirementsPageContent() {
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const { data: projects = [] } = useProjects(currentWorkspace?.id);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Permission checks
  const isAdmin = useIsAdmin();
  const canCreateFR = useHasPermission(Permission.CREATE_FUNCTIONAL_REQUIREMENT);
  const canEditFR = useHasPermission(Permission.EDIT_FUNCTIONAL_REQUIREMENT);
  const canDeleteFR = useHasPermission(Permission.DELETE_FUNCTIONAL_REQUIREMENT);

  const [selectedProjectId, setSelectedProjectId] = React.useState<string>('');
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  // Hold the id, not a snapshot: an object captured here never sees the refetch
  // that follows a save, so the dialog kept rendering stale values.
  const [selectedRequirementId, setSelectedRequirementId] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');

  // A `?projectId=` from a deep link seeds the picker ONCE PER VALUE.
  //
  // Keyed on the value, not on "has ever run". The effect re-runs whenever
  // `selectedProjectId` changes (it is a dep), and re-asserting the URL's
  // project on every run snapped the picker straight back to the address bar —
  // the page was stuck on one project. But a bare "spent" flag over-corrected:
  // the notification bell lives in the global header and deep-links to THIS
  // route, and Next treats a query-only push to the same segment as a soft
  // navigation, so the component stays mounted and the ref stays spent. A second
  // FR notification for a DIFFERENT project then did literally nothing — no
  // switch, no dialog, and `?frId=` never stripped. Storing the applied VALUE
  // lets the user re-pick freely while still honouring a new deep link.
  const lastAppliedUrlProject = React.useRef<string | null>(null);

  // Project selection: URL param (notification deep links) > localStorage > first project
  React.useEffect(() => {
    const STORAGE_KEY = 'selected-project-id';
    const urlParam = searchParams.get('projectId');
    const urlProjectId = urlParam && urlParam !== lastAppliedUrlProject.current ? urlParam : null;
    const savedProjectId = localStorage.getItem(STORAGE_KEY);

    if (urlProjectId && projects.some((p) => p.id === urlProjectId)) {
      lastAppliedUrlProject.current = urlProjectId;
      setSelectedProjectId(urlProjectId);
      localStorage.setItem(STORAGE_KEY, urlProjectId);
    } else if (savedProjectId && projects.some((p) => p.id === savedProjectId)) {
      // Restore saved project if it still exists
      setSelectedProjectId(savedProjectId);
    } else if (projects.length > 0 && !selectedProjectId) {
      // Default to first project if no saved selection
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
  } = useFunctionalRequirements(selectedProjectId);
  const { data: clientRequirements = [] } = useClientRequirements(selectedProjectId);
  const { data: epics = [] } = useEpics(selectedProjectId);
  const { data: tasks = [] } = useTasks(selectedProjectId);

  // Open the FR detail dialog when a notification deep-links to one (?frId=…)
  const frIdFromUrl = searchParams.get('frId');

  // Global search / the /requirements?reqId= redirect send an frId with NO
  // projectId, so the target FR often lives in a project other than the one
  // restored from localStorage — and then nothing below ever matches it. Resolve
  // the FR on its own and switch the picker to its project first.
  const { data: deepLinkedFR } = useFunctionalRequirement(frIdFromUrl ?? undefined);
  React.useEffect(() => {
    // Skip when the URL pins a project: both effects would fight over the picker.
    if (!deepLinkedFR || searchParams.get('projectId')) return;
    if (!deepLinkedFR.projectId || deepLinkedFR.projectId === selectedProjectId) return;
    if (!projects.some((p) => p.id === deepLinkedFR.projectId)) return;
    handleProjectChange(deepLinkedFR.projectId);
  }, [deepLinkedFR, projects, selectedProjectId, searchParams, handleProjectChange]);

  React.useEffect(() => {
    if (!frIdFromUrl || requirements.length === 0) return;
    if (!requirements.some((r) => r.id === frIdFromUrl)) return;
    setSelectedRequirementId(frIdFromUrl);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('frId');
    router.replace(
      params.toString() ? `/functional-requirements?${params.toString()}` : '/functional-requirements'
    );
  }, [frIdFromUrl, requirements, searchParams, router]);

  // The API returns parentRequirementId on every FR (requirements/mappers.ts), so
  // sub-requirements can be ordered under their parent — which is what the card
  // below claims to show.
  const hierarchicalRequirements = React.useMemo(() => {
    const parentOf = (req: FunctionalRequirement) => req.parentRequirementId || '';
    const known = new Set(requirements.map((r) => r.id));
    const byParent = new Map<string, FunctionalRequirement[]>();

    for (const req of requirements) {
      // A parent that is not in this list (other project, deleted) must not hide
      // the row, so treat it as top level.
      const parentId = parentOf(req);
      const key = parentId && known.has(parentId) ? parentId : '';
      const bucket = byParent.get(key);
      if (bucket) bucket.push(req);
      else byParent.set(key, [req]);
    }
    for (const bucket of byParent.values()) {
      bucket.sort((a, b) => (a.hierarchyId || '').localeCompare(b.hierarchyId || ''));
    }

    const rows: { req: FunctionalRequirement; depth: number }[] = [];
    const seen = new Set<string>(); // guards against a cyclic parent chain
    const walk = (parentId: string, depth: number) => {
      for (const req of byParent.get(parentId) ?? []) {
        if (seen.has(req.id)) continue;
        seen.add(req.id);
        rows.push({ req, depth });
        walk(req.id, depth + 1);
      }
    };
    walk('', 0);
    // Anything still unvisited sat in a cycle — render it rather than drop it.
    for (const req of requirements) {
      if (!seen.has(req.id)) rows.push({ req, depth: 0 });
    }
    return rows;
  }, [requirements]);

  // Filter requirements
  const filteredRequirements = React.useMemo(() => {
    let filtered = hierarchicalRequirements;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        ({ req }) =>
          req.title.toLowerCase().includes(query) ||
          req.hierarchyId.toLowerCase().includes(query) ||
          req.description?.toLowerCase().includes(query)
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(({ req }) => req.status === statusFilter);
    }

    return filtered;
  }, [hierarchicalRequirements, searchQuery, statusFilter]);

  // Calculate stats
  const stats = React.useMemo(() => {
    return {
      total: requirements.length,
      draft: requirements.filter((r) => r.status === 'DRAFT').length,
      review: requirements.filter((r) => r.status === 'REVIEW').length,
      approved: requirements.filter((r) => r.status === 'APPROVED').length,
      implemented: requirements.filter((r) => r.status === 'IMPLEMENTED').length,
      tested: requirements.filter((r) => r.status === 'TESTED').length,
      deployed: requirements.filter((r) => r.status === 'DEPLOYED').length,
    };
  }, [requirements]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  // Read the live row out of the query data so the dialog re-renders after a save.
  const selectedRequirement = requirements.find((r) => r.id === selectedRequirementId) ?? null;

  const renderRequirement = (req: FunctionalRequirement, depth = 0) => {
    const complexity = getComplexityConfig(req.complexity);
    const clientReq = clientRequirements.find((cr) => cr.id === req.clientRequirementId);

    // Calculate progress from linked tasks if stored progress is 0
    const linkedTasks = tasks.filter((t) => t.functionalRequirementId === req.id);
    const completedTasks = linkedTasks.filter((t) => t.status === 'DONE').length;
    let progress = req.progress ?? 0;
    if (progress === 0 && linkedTasks.length > 0) {
      progress = Math.round((completedTasks / linkedTasks.length) * 100);
    }

    return (
      <TableRow
        key={req.id}
        className="cursor-pointer"
        onClick={() => setSelectedRequirementId(req.id)}
      >
        <TableCell>
          {/* Indent sub-requirements so the parent/child nesting is visible. */}
          <div style={{ paddingLeft: depth * 16 }}>
            <Badge variant="outline" className="font-mono">
              {req.hierarchyId}
            </Badge>
          </div>
        </TableCell>
        <TableCell>
          <div className="font-medium">{req.title}</div>
          {req.description && (
            <div className="text-sm text-muted-foreground line-clamp-1 mt-1">
              {req.description}
            </div>
          )}
          {clientReq && (
            <div className="text-xs text-muted-foreground mt-1">Linked to: {clientReq.title}</div>
          )}
        </TableCell>
        <TableCell>
          {req.priority ? (
            <Badge variant={getPriorityConfig(req.priority).badgeVariant}>
              {getPriorityConfig(req.priority).label}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-sm">-</span>
          )}
        </TableCell>
        <TableCell>
          <Badge variant={complexity.badgeVariant}>{complexity.label}</Badge>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <Progress value={progress} className="w-20 h-2" />
            <span className="text-sm text-muted-foreground">{progress}%</span>
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">{formatDate(req.createdAt)}</TableCell>
      </TableRow>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Functional Requirements"
        description="Technical specifications derived from client requirements"
        actions={
          (canCreateFR || isAdmin) && (
            <Button onClick={() => setCreateDialogOpen(true)} disabled={!selectedProjectId}>
              <Plus className="mr-2 h-4 w-4" />
              New Functional Requirement
            </Button>
          )
        }
      />

      {/* Nothing below the picker renders without a project, so say why. */}
      {projects.length === 0 && (
        <EmptyState
          icon={FolderPlus}
          title="No projects yet"
          description="Create a project before breaking work down into functional requirements."
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
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-7">
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
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.draft}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Review</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.review}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Approved</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.approved}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Implemented</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.implemented}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Tested</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.tested}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Deployed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.deployed}</div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search requirements..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger aria-label="Filter requirements by status">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {FUNCTIONAL_REQUIREMENT_STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {getFunctionalRequirementStatusConfig(value).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Requirements Table */}
          <Card>
            <CardHeader>
              <CardTitle>Requirements ({filteredRequirements.length})</CardTitle>
              <CardDescription>
                Hierarchical structure showing requirements and sub-requirements
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <InlineLoader />
              ) : isError ? (
                <ErrorState onRetry={() => refetch()} />
              ) : filteredRequirements.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title={
                    searchQuery || statusFilter !== 'all'
                      ? 'No requirements match your filters'
                      : 'No functional requirements yet'
                  }
                  description={
                    searchQuery || statusFilter !== 'all'
                      ? 'Try a different search term or status filter.'
                      : 'Break client requirements down into functional requirements to get started.'
                  }
                  action={
                    canCreateFR || isAdmin
                      ? {
                          label: 'Create First Requirement',
                          onClick: () => setCreateDialogOpen(true),
                        }
                      : undefined
                  }
                />
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Complexity</TableHead>
                        <TableHead>Progress</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRequirements.map(({ req, depth }) =>
                        renderRequirement(req, depth)
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Create Dialog */}
      <CreateFunctionalRequirementDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        projectId={selectedProjectId}
        projectCode={selectedProject?.shortCode || ''}
        workspaceId={currentWorkspace?.id || ''}
        userId={user?.id || ''}
        clientRequirements={clientRequirements}
        functionalRequirements={requirements}
        epics={epics}
      />

      {/* Detail Dialog */}
      {selectedRequirement && (
        <FunctionalRequirementDetailDialog
          requirement={selectedRequirement}
          open={!!selectedRequirement}
          onOpenChange={(open: boolean) => !open && setSelectedRequirementId(null)}
          projectId={selectedProjectId}
          workspaceId={currentWorkspace?.id || ''}
          clientRequirements={clientRequirements}
          canEdit={canEditFR || isAdmin}
          canDelete={canDeleteFR || isAdmin}
        />
      )}
    </div>
  );
}

// useSearchParams() bails out of prerendering, which fails `next build` unless a
// Suspense boundary sits above the component that reads it.
export default function FunctionalRequirementsPage() {
  return (
    <React.Suspense fallback={<PageLoader message="Loading requirements..." />}>
      <FunctionalRequirementsPageContent />
    </React.Suspense>
  );
}
