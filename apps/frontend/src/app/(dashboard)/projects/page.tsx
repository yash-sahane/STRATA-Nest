'use client';

import * as React from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useProjects,
  useDeleteProject,
  useUpdateProject,
  useCloneProject,
} from '@/hooks/use-project';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useWorkspaceTasks } from '@/hooks/use-task';
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
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/layout/page-header';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageLoader } from '@/components/ui/page-loader';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import { EditProjectDialog } from '@/components/projects/edit-project-dialog';
import { CloneProjectDialog } from '@/components/projects/clone-project-dialog';
import type { CloneProjectData } from '@/components/projects/clone-project-dialog';
import { ProjectHealthBadge } from '@/components/projects/project-health-badge';
import { calculateProjectHealth } from '@/lib/project-health';
import {
  MoreVertical,
  Settings,
  Trash2,
  Calendar,
  FolderKanban,
  Users,
  GitBranch,
  Kanban,
  Edit,
  Copy,
  Search,
  FolderPlus,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import type { ProjectStatus, Project } from '@/types';
import { useHasPermission, useIsAdmin } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';

const statusConfig: Record<
  ProjectStatus,
  {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info';
  }
> = {
  PLANNING: { label: 'Planning', variant: 'outline' },
  ACTIVE: { label: 'Active', variant: 'success' },
  ON_HOLD: { label: 'On Hold', variant: 'warning' },
  COMPLETED: { label: 'Completed', variant: 'info' },
  ARCHIVED: { label: 'Archived', variant: 'secondary' },
};

export default function ProjectsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();
  const {
    data: projects,
    isLoading: projectsLoading,
    isError: projectsError,
    refetch: refetchProjects,
  } = useProjects(currentWorkspace?.id);
  const { data: allTasks } = useWorkspaceTasks(currentWorkspace?.id);
  const deleteProject = useDeleteProject();
  const updateProject = useUpdateProject();
  const cloneProject = useCloneProject();

  // Permission checks
  const canEditProject = useHasPermission(Permission.EDIT_PROJECT);
  const canDeleteProject = useHasPermission(Permission.DELETE_PROJECT);
  const canManageSettings = useHasPermission(Permission.MANAGE_PROJECT_SETTINGS);
  const canCreateProject = useHasPermission(Permission.CREATE_PROJECT);
  const isAdmin = useIsAdmin();

  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [editDialogOpen, setEditDialogOpen] = React.useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = React.useState(false);
  const [selectedProject, setSelectedProject] = React.useState<Project | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<ProjectStatus | 'ALL'>('ALL');
  const [projectToDelete, setProjectToDelete] = React.useState<{
    projectId: string;
    workspaceId: string;
  } | null>(null);

  // Filter out archived projects completely
  const filteredProjects = React.useMemo(() => {
    if (!projects) return [];
    return projects.filter((project) => !project.archived);
  }, [projects]);

  const visibleProjects = React.useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return filteredProjects.filter((project) => {
      const matchesStatus = statusFilter === 'ALL' || project.status === statusFilter;
      const matchesSearch =
        !normalizedSearch ||
        [project.name, project.shortCode, project.description, project.clientName]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(normalizedSearch));

      return matchesStatus && matchesSearch;
    });
  }, [filteredProjects, searchQuery, statusFilter]);

  const hasActiveProjectFilters = searchQuery.trim().length > 0 || statusFilter !== 'ALL';

  const handleEdit = async (values: any) => {
    if (!selectedProject || !currentWorkspace) return;

    await updateProject.mutateAsync({
      projectId: selectedProject.id,
      workspaceId: currentWorkspace.id,
      name: values.name,
      description: values.description,
      status: values.status,
      startDate: values.startDate?.toISOString(),
      endDate: values.endDate?.toISOString(),
    });

    setEditDialogOpen(false);
    setSelectedProject(null);
  };

  const handleDelete = async () => {
    if (!projectToDelete) return;

    await deleteProject.mutateAsync(projectToDelete);
    setDeleteDialogOpen(false);
    setProjectToDelete(null);
  };

  const handleClone = async (cloneData: CloneProjectData) => {
    if (!selectedProject || !user) return;

    await cloneProject.mutateAsync({
      sourceProjectId: selectedProject.id,
      newName: cloneData.name,
      includeSettings: cloneData.includeSettings,
      includeTasks: cloneData.includeTasks,
      includeMembers: cloneData.includeMembers,
      includeSprints: cloneData.includeSprints,
      userId: user.id,
    });

    setCloneDialogOpen(false);
    setSelectedProject(null);
  };

  if (workspacesLoading || projectsLoading) {
    return <PageLoader message="Loading projects..." />;
  }

  if (projectsError) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          icon={FolderKanban}
          title="Projects"
          description="We couldn't load your projects."
        />
        <ErrorState onRetry={() => refetchProjects()} />
      </div>
    );
  }

  if (!currentWorkspace) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          icon={FolderKanban}
          title="Projects"
          description="Create a workspace first to manage projects"
        />
        <EmptyState
          icon={FolderPlus}
          title="No workspace selected"
          description="Create or join a workspace before creating projects."
          action={{ label: 'Go to Workspaces', onClick: () => router.push('/workspaces') }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        icon={FolderKanban}
        title="Projects"
        description={`Manage project delivery in ${currentWorkspace.name}`}
        actions={canCreateProject && <CreateProjectDialog workspaceId={currentWorkspace.id} />}
      />

      {filteredProjects.length > 0 && (
        <div className="grid gap-3 rounded-lg border bg-card p-3 animate-in fade-in slide-in-from-bottom-2 duration-500 lg:grid-cols-[minmax(0,1fr)_12rem_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search projects, codes, clients..."
              className="pl-9"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as ProjectStatus | 'ALL')}
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Status</SelectItem>
              {Object.entries(statusConfig)
                .filter(([status]) => status !== 'ARCHIVED')
                .map(([status, config]) => (
                  <SelectItem key={status} value={status}>
                    {config.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {hasActiveProjectFilters && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('ALL');
              }}
            >
              Clear Filters
            </Button>
          )}
        </div>
      )}

      {filteredProjects.length > 0 && visibleProjects.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visibleProjects.map((project, index) => {
            const status = statusConfig[project.status];
            const projectTasks = allTasks?.filter((task) => task.projectId === project.id) || [];
            const health = calculateProjectHealth(project, allTasks || []);

            return (
              <Card
                key={project.id}
                className="group flex h-full flex-col overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md animate-in fade-in slide-in-from-bottom-2"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge variant="outline" className="font-mono">
                          {project.shortCode}
                        </Badge>
                        <Badge variant={status.variant}>{status.label}</Badge>
                        {projectTasks.length > 0 && (
                          <ProjectHealthBadge score={health.score} showLabel={false} size="sm" />
                        )}
                      </div>
                      <CardTitle className="line-clamp-2 text-lg">{project.name}</CardTitle>
                      <CardDescription className="mt-1.5 line-clamp-2">
                        {project.description || 'No description'}
                      </CardDescription>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canEditProject && (
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedProject(project);
                              setEditDialogOpen(true);
                            }}
                            className="cursor-pointer"
                          >
                            <Edit className="mr-2 h-4 w-4" />
                            Edit Project
                          </DropdownMenuItem>
                        )}
                        {canManageSettings && (
                          <DropdownMenuItem
                            onClick={() => router.push(`/projects/${project.id}/settings`)}
                            className="cursor-pointer"
                          >
                            <Settings className="mr-2 h-4 w-4" />
                            Settings
                          </DropdownMenuItem>
                        )}
                        {isAdmin && (
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedProject(project);
                              setCloneDialogOpen(true);
                            }}
                            className="cursor-pointer"
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Clone Project
                          </DropdownMenuItem>
                        )}
                        {(canEditProject || canDeleteProject) && <DropdownMenuSeparator />}
                        {canDeleteProject && (
                          <DropdownMenuItem
                            onClick={() => {
                              setProjectToDelete({
                                projectId: project.id,
                                workspaceId: project.workspaceId,
                              });
                              setDeleteDialogOpen(true);
                            }}
                            className="cursor-pointer text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4">
                  <div className="flex items-center gap-2 text-sm">
                    {project.methodology === 'SCRUM' ? (
                      <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                        <GitBranch className="h-4 w-4" />
                        <span>Scrum</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-purple-600 dark:text-purple-400">
                        <Kanban className="h-4 w-4" />
                        <span>Kanban</span>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      <span>{project.memberIds.length} members</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      <span>{project.startDate ? formatDate(project.startDate) : 'Not set'}</span>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center gap-2 pt-2">
                    <Button
                      onClick={() => router.push(`/projects/${project.id}`)}
                      className="flex-1 transition-transform group-hover:-translate-y-px"
                    >
                      View Project
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : filteredProjects.length > 0 ? (
        <EmptyState
          icon={Search}
          title="No matching projects"
          description="Try a different search or status filter."
          action={{
            label: 'Clear Filters',
            onClick: () => {
              setSearchQuery('');
              setStatusFilter('ALL');
            },
          }}
        />
      ) : (
        <EmptyState
          icon={FolderPlus}
          title="No projects yet"
          description="Create your first project to start organizing tasks and sprints."
          className="animate-in fade-in slide-in-from-bottom-2 duration-500"
        />
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this project and all associated tasks, sprints, and
              requirements. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteProject.isPending ? 'Deleting...' : 'Delete Project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Project Dialog */}
      <EditProjectDialog
        project={selectedProject}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSubmit={handleEdit}
        isLoading={updateProject.isPending}
      />

      {/* Clone Project Dialog */}
      <CloneProjectDialog
        project={selectedProject}
        open={cloneDialogOpen}
        onOpenChange={setCloneDialogOpen}
        onClone={handleClone}
        isLoading={cloneProject.isPending}
      />
    </div>
  );
}
