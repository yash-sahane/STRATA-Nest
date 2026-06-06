'use client';

import * as React from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useProjects } from '@/hooks/use-project';
import { useFunctionalRequirements } from '@/hooks/use-functional-requirement';
import { useClientRequirements } from '@/hooks/use-client-requirement';
import { useEpics } from '@/hooks/use-epic';
import { useTasks } from '@/hooks/use-task';
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
import { Plus, FileText, Search, Filter } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { formatDate } from '@/lib/utils';
import type { FunctionalRequirement } from '@/types';
import { CreateFunctionalRequirementDialog } from '@/components/requirements/create-functional-requirement-dialog';
import { FunctionalRequirementDetailDialog } from '@/components/requirements/functional-requirement-detail-dialog';
import { useIsAdmin, useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';

const statusConfig: Record<FunctionalRequirement['status'], { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: 'bg-gray-500' },
  REVIEW: { label: 'In Review', color: 'bg-yellow-500' },
  APPROVED: { label: 'Approved', color: 'bg-blue-500' },
  IMPLEMENTED: { label: 'Implemented', color: 'bg-purple-500' },
  TESTED: { label: 'Tested', color: 'bg-indigo-500' },
  DEPLOYED: { label: 'Deployed', color: 'bg-green-500' },
};

const complexityConfig: Record<
  FunctionalRequirement['complexity'],
  { label: string; color: string }
> = {
  LOW: { label: 'Low', color: 'green' },
  MEDIUM: { label: 'Medium', color: 'yellow' },
  HIGH: { label: 'High', color: 'orange' },
  VERY_HIGH: { label: 'Very High', color: 'red' },
};

export default function FunctionalRequirementsPage() {
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const { data: projects = [] } = useProjects(currentWorkspace?.id);

  // Permission checks
  const isAdmin = useIsAdmin();
  const canCreateFR = useHasPermission(Permission.CREATE_EPIC);
  const canEditFR = useHasPermission(Permission.EDIT_EPIC);
  const canDeleteFR = useHasPermission(Permission.DELETE_EPIC);

  const [selectedProjectId, setSelectedProjectId] = React.useState<string>('');
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [selectedRequirement, setSelectedRequirement] =
    React.useState<FunctionalRequirement | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');

  // Restore project selection from localStorage or set first project as default
  React.useEffect(() => {
    const STORAGE_KEY = 'selected-project-id';
    const savedProjectId = localStorage.getItem(STORAGE_KEY);

    if (savedProjectId && projects.some((p) => p.id === savedProjectId)) {
      // Restore saved project if it still exists
      setSelectedProjectId(savedProjectId);
    } else if (projects.length > 0 && !selectedProjectId) {
      // Default to first project if no saved selection
      const firstProjectId = projects[0].id;
      setSelectedProjectId(firstProjectId);
      localStorage.setItem(STORAGE_KEY, firstProjectId);
    }
  }, [projects, selectedProjectId]);

  // Save project selection to localStorage when changed
  const handleProjectChange = React.useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    localStorage.setItem('selected-project-id', projectId);
  }, []);

  const { data: requirements = [], isLoading } = useFunctionalRequirements(selectedProjectId);
  const { data: clientRequirements = [] } = useClientRequirements(selectedProjectId);
  const { data: epics = [] } = useEpics(selectedProjectId);
  const { data: tasks = [] } = useTasks(selectedProjectId);

  // NOTE: The FunctionalRequirement type no longer includes a parentRequirementId field.
  // Render requirements as a flat list (ordered by hierarchyId) to avoid relying on a parent reference.
  const hierarchicalRequirements = React.useMemo(() => {
    return [...requirements].sort((a, b) =>
      (a.hierarchyId || '').localeCompare(b.hierarchyId || '')
    );
  }, [requirements]);

  // Filter requirements
  const filteredRequirements = React.useMemo(() => {
    let filtered = hierarchicalRequirements;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (req) =>
          req.title.toLowerCase().includes(query) ||
          req.hierarchyId.toLowerCase().includes(query) ||
          req.description?.toLowerCase().includes(query)
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter((req) => req.status === statusFilter);
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

  const renderRequirement = (req: FunctionalRequirement) => {
    const complexity = complexityConfig[req.complexity];
    const clientReq = clientRequirements.find((cr) => cr.id === req.clientRequirementId);

    // Calculate progress from linked tasks if stored progress is 0
    const linkedTasks = tasks.filter((t) => t.functionalRequirementId === req.id);
    const completedTasks = linkedTasks.filter((t) => t.status === 'DONE').length;
    let progress = req.progress ?? 0;
    if (progress === 0 && linkedTasks.length > 0) {
      progress = Math.round((completedTasks / linkedTasks.length) * 100);
    }

    const priorityColors = {
      CRITICAL: 'bg-red-500 text-white',
      HIGH: 'bg-orange-500 text-white',
      MEDIUM: 'bg-yellow-500 text-black',
      LOW: 'bg-green-500 text-white',
    };

    return (
      <tr
        key={req.id}
        className="hover:bg-muted/50 cursor-pointer transition-colors"
        onClick={() => setSelectedRequirement(req)}
      >
        <td className="p-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {req.hierarchyId}
            </Badge>
          </div>
        </td>
        <td className="p-4">
          <div>
            <div className="font-medium">{req.title}</div>
            {req.description && (
              <div className="text-sm text-muted-foreground line-clamp-1 mt-1">
                {req.description}
              </div>
            )}
            {clientReq && (
              <div className="text-xs text-muted-foreground mt-1">Linked to: {clientReq.title}</div>
            )}
          </div>
        </td>
        <td className="p-4">
          {req.priority ? (
            <Badge className={priorityColors[req.priority]}>{req.priority}</Badge>
          ) : (
            <span className="text-muted-foreground text-sm">-</span>
          )}
        </td>
        <td className="p-4">
          <Badge
            variant="outline"
            className={`bg-${complexity.color}-500/10 text-${complexity.color}-700`}
          >
            {complexity.label}
          </Badge>
        </td>
        <td className="p-4">
          <div className="flex items-center gap-2">
            <Progress value={progress} className="w-20 h-2" />
            <span className="text-sm text-muted-foreground">{progress}%</span>
          </div>
        </td>
        <td className="p-4 text-sm text-muted-foreground">{formatDate(req.createdAt)}</td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Functional Requirements</h1>
          <p className="text-muted-foreground">
            Technical specifications derived from client requirements
          </p>
        </div>
        {(canCreateFR || isAdmin) && (
          <Button onClick={() => setCreateDialogOpen(true)} disabled={!selectedProjectId}>
            <Plus className="mr-2 h-4 w-4" />
            New Requirement
          </Button>
        )}
      </div>

      {/* Project Selector */}
      <Card>
        <CardHeader>
          <CardTitle>Select Project</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedProjectId} onValueChange={handleProjectChange}>
            <SelectTrigger className="w-full md:w-[400px]">
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
                  <SelectTrigger>
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {Object.entries(statusConfig).map(([value, { label }]) => (
                      <SelectItem key={value} value={value}>
                        {label}
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
                <div className="text-center py-8 text-muted-foreground">
                  Loading requirements...
                </div>
              ) : filteredRequirements.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-4" />
                  <p className="text-muted-foreground mb-4">
                    {searchQuery || statusFilter !== 'all'
                      ? 'No requirements match your filters'
                      : 'No functional requirements yet'}
                  </p>
                  {(canCreateFR || isAdmin) && (
                    <Button onClick={() => setCreateDialogOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Create First Requirement
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b">
                      <tr className="text-left">
                        <th className="p-4 font-medium">id</th>
                        <th className="p-4 font-medium">Title</th>
                        <th className="p-4 font-medium">Priority</th>
                        <th className="p-4 font-medium">Complexity</th>
                        <th className="p-4 font-medium">Progress</th>
                        <th className="p-4 font-medium">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredRequirements.map((req) => renderRequirement(req))}
                    </tbody>
                  </table>
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
          onOpenChange={(open: boolean) => !open && setSelectedRequirement(null)}
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
