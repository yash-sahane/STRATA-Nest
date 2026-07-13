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
import { Plus, Search, FileText, CheckCircle2, Clock, Archive, Sparkles } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import type { RequirementStatus, RequirementPriority } from '@/types';
import { CreateClientRequirementDialog } from '@/components/requirements/create-client-requirement-dialog';
import { ClientRequirementDetailDialog } from '@/components/requirements/client-requirement-detail-dialog';
import { AIGenerateDialog } from '@/components/ai/ai-generate-dialog';
import type { GeneratedHierarchy } from '@/lib/ai-generator';
import { useIsAdmin, useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { logger } from '@/lib/logger';

// Add permission for requirements (using epic permission as proxy since requirements follow similar hierarchy)
// Note: In a production app, you might want to add specific requirement permissions

const statusConfig: Record<
  RequirementStatus,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    variant: 'default' | 'secondary' | 'outline' | 'destructive';
  }
> = {
  DRAFT: { label: 'Draft', icon: FileText, variant: 'secondary' },
  SUBMITTED: { label: 'Submitted', icon: Clock, variant: 'default' },
  APPROVED: { label: 'Approved', icon: CheckCircle2, variant: 'default' },
  IN_PROGRESS: { label: 'In Progress', icon: Clock, variant: 'default' },
  COMPLETED: { label: 'Completed', icon: CheckCircle2, variant: 'default' },
  ARCHIVED: { label: 'Archived', icon: Archive, variant: 'secondary' },
};

const priorityConfig: Record<RequirementPriority, { label: string; color: string }> = {
  LOW: { label: 'Low', color: 'text-green-500' },
  MEDIUM: { label: 'Medium', color: 'text-yellow-500' },
  HIGH: { label: 'High', color: 'text-orange-500' },
  CRITICAL: { label: 'Critical', color: 'text-red-500' },
};

export default function RequirementsPage() {
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const { data: projects = [] } = useProjects(currentWorkspace?.id);
  const router = useRouter();
  const searchParams = useSearchParams();
  const frIdFromUrl = searchParams.get('frId');

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

  const { data: requirements = [], isLoading } = useClientRequirements(selectedProjectId);

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Requirements</h1>
          <p className="text-muted-foreground">Manage client and functional requirements</p>
        </div>
        <div className="flex gap-2">
          {(canCreateRequirement || isAdmin) && (
            <>
              <Button
                onClick={() => setAiGenerateDialogOpen(true)}
                disabled={!selectedProjectId}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Generate with AI
              </Button>
              <Button onClick={() => setCreateDialogOpen(true)} disabled={!selectedProjectId}>
                <Plus className="mr-2 h-4 w-4" />
                New Requirement
              </Button>
            </>
          )}
        </div>
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
                  <SelectTrigger className="w-full md:w-[200px]">
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
                  <SelectTrigger className="w-full md:w-[200px]">
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
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : filteredRequirements.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {requirements.length === 0 ? (
                    <>
                      <FileText className="mx-auto h-12 w-12 mb-4 opacity-50" />
                      <p>No client requirements yet</p>
                      <Button className="mt-4" onClick={() => setCreateDialogOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Create First Requirement
                      </Button>
                    </>
                  ) : (
                    <p>No requirements match your filters</p>
                  )}
                </div>
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
                        const status = statusConfig[requirement.status];
                        const priority = priorityConfig[requirement.priority];
                        const StatusIcon = status.icon;

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
                                <span className={`text-lg ${priority.color}`}>●</span>
                                <span className="text-sm">{priority.label}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={status.variant}
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
