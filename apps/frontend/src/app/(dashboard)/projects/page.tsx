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
import { useProjectsRealtime } from '@/hooks/use-realtime';
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
import { PROJECT_STATUSES, getProjectStatusConfig } from '@/lib/semantic/status';
import { plural } from '@/lib/plural';
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
import { useCreateActionParam } from '@/hooks/use-create-action-param';
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
import { formatProjectDate } from '@/components/projects/project-dates';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import type { ProjectStatus, Project } from '@/types';
import { useHasPermission, useIsAdmin } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';

export default function ProjectsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();
  // Live updates: the gateway already broadcasts every write on this
  // collection, this page just never subscribed — so another member's
  // change only appeared after a manual navigation.
  useProjectsRealtime(currentWorkspace?.id);
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

  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  // The command palette's "Create New Project" navigates here with ?action=create.
  useCreateActionParam(() => setCreateDialogOpen(true));
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [editDialogOpen, setEditDialogOpen] = React.useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = React.useState(false);
  const [selectedProject, setSelectedProject] = React.useState<Project | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<ProjectStatus | 'ALL'>('ALL');
  const [projectToDelete, setProjectToDelete] = React.useState<Project | null>(null);

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

    try {
      await updateProject.mutateAsync({
        projectId: selectedProject.id,
        workspaceId: currentWorkspace.id,
        name: values.name,
        description: values.description,
        clientName: values.clientName,
        status: values.status,
        // Date-only fields — see create-project-dialog: an ISO instant lands on
        // the previous day for any UTC+ timezone. `null` (not `undefined`) for a
        // cleared field: JSON.stringify drops undefined, so the PATCH carried no
        // field and the date the user had just removed came straight back.
        startDate: values.startDate ? format(values.startDate, 'yyyy-MM-dd') : null,
        endDate: values.endDate ? format(values.endDate, 'yyyy-MM-dd') : null,
      });
    } catch {
      return; // error toast handled inside the mutation
    }

    setEditDialogOpen(false);
    setSelectedProject(null);
  };

  const handleDelete = async () => {
    if (!projectToDelete) return;

    try {
      await deleteProject.mutateAsync({
        projectId: projectToDelete.id,
        workspaceId: projectToDelete.workspaceId,
      });
    } catch {
      return; // error toast handled inside the mutation; keep the dialog open
    }

    setDeleteDialogOpen(false);
    setProjectToDelete(null);
  };

  const handleClone = async (cloneData: CloneProjectData) => {
    if (!selectedProject || !user) return;

    try {
      await cloneProject.mutateAsync({
        sourceProjectId: selectedProject.id,
        newName: cloneData.name,
        includeSettings: cloneData.includeSettings,
        includeTasks: cloneData.includeTasks,
        includeMembers: cloneData.includeMembers,
        includeSprints: cloneData.includeSprints,
        userId: user.id,
      });
    } catch {
      return; // error toast handled inside the mutation
    }

    setCloneDialogOpen(false);
    setSelectedProject(null);
  };

  if (workspacesLoading || projectsLoading) {
    return <PageLoader message="Loading projects..." />;
  }

  if (projectsError) {
    return (
      <div className="flex flex-col gap-6">
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
      <div className="flex flex-col gap-6">
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
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={FolderKanban}
        title="Projects"
        description={`Manage project delivery in ${currentWorkspace.name}`}
        actions={
          canCreateProject && (
            <CreateProjectDialog
              workspaceId={currentWorkspace.id}
              open={createDialogOpen}
              onOpenChange={setCreateDialogOpen}
            />
          )
        }
      />

      {filteredProjects.length > 0 && (
        <div className="grid gap-3 rounded-lg border bg-card p-3 lg:grid-cols-[minmax(0,1fr)_12rem_auto]">
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
            <SelectTrigger aria-label="Filter projects by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Status</SelectItem>
              {/* ARCHIVED is a real, settable status (edit dialog + settings),
                  so it has to be filterable — hiding it made those projects
                  unreachable while still listing them. */}
              {PROJECT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {getProjectStatusConfig(status).label}
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
          {visibleProjects.map((project) => {
            const status = getProjectStatusConfig(project.status);
            const projectTasks = allTasks?.filter((task) => task.projectId === project.id) || [];
            const health = calculateProjectHealth(project, allTasks || []);

            return (
              <Card
                key={project.id}
                className="group flex h-full flex-col overflow-hidden hover-lift"
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge variant="outline" className="font-mono">
                          {project.shortCode}
                        </Badge>
                        <Badge variant={status.badgeVariant}>{status.label}</Badge>
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
                              setProjectToDelete(project);
                              setDeleteDialogOpen(true);
                            }}
                            className="cursor-pointer text-destructive-text focus:text-destructive-text"
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
                      <span>{plural(project.memberIds.length, 'member')}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      <span>{formatProjectDate(project.startDate) ?? 'Not set'}</span>
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
        />
      )}

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setProjectToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{projectToDelete?.name}</strong> and all
              associated tasks, sprints, and requirements. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProject.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              // preventDefault: Radix closes the dialog on click otherwise, so
              // the pending label never renders and a failed delete looks done.
              onClick={(event) => {
                event.preventDefault();
                handleDelete();
              }}
              disabled={deleteProject.isPending}
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
