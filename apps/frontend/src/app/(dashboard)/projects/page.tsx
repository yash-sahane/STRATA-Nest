'use client';

import Link from 'next/link';
import * as React from 'react';
import {
  useProjects,
  useDeleteProject,
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
import { CloneProjectDialog } from '@/components/projects/clone-project-dialog';
import type { CloneProjectData } from '@/components/projects/clone-project-dialog';
import { ProjectHealthBadge } from '@/components/projects/project-health-badge';
import { calculateProjectHealth } from '@/lib/project-health';
import {
  MoreVertical,
  Trash2,
  Calendar,
  FolderKanban,
  Copy,
  Search,
  FolderPlus,
  Archive,
  Settings,
} from 'lucide-react';
import { describeProjectDates } from '@/components/projects/project-dates';
import type { ProjectStatus, Project } from '@/types';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';

export default function ProjectsPage() {
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
  const cloneProject = useCloneProject();

  // Permission checks
  const canEditProject = useHasPermission(Permission.EDIT_PROJECT);
  const canDeleteProject = useHasPermission(Permission.DELETE_PROJECT);
  const canManageSettings = useHasPermission(Permission.MANAGE_PROJECT_SETTINGS);
  const canCreateProject = useHasPermission(Permission.CREATE_PROJECT);
  // What each part of a copy creates, under the permission the API asks for it.
  const canWriteRequirements = useHasPermission(Permission.CREATE_REQUIREMENT);
  const canPlan = useHasPermission(Permission.CREATE_SPRINT);
  const canCreateTask = useHasPermission(Permission.CREATE_TASK);

  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  // The command palette's "New Project" navigates here with ?action=create.
  useCreateActionParam(() => setCreateDialogOpen(true));
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = React.useState(false);
  const [selectedProject, setSelectedProject] = React.useState<Project | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<ProjectStatus | 'ALL'>('ALL');
  const [projectToDelete, setProjectToDelete] = React.useState<Project | null>(null);

  const allProjects = React.useMemo(() => projects ?? [], [projects]);
  // Archived projects are out of the way unless asked for: "All but archived" is
  // every project still in play, and the status filter offers Archived.
  const archivedCount = React.useMemo(
    () => allProjects.filter((project) => project.status === 'ARCHIVED').length,
    [allProjects]
  );

  const visibleProjects = React.useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return allProjects.filter((project) => {
      const matchesStatus =
        statusFilter === 'ALL' ? project.status !== 'ARCHIVED' : project.status === statusFilter;
      const matchesSearch =
        !normalizedSearch ||
        [project.name, project.shortCode, project.description, project.clientName]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(normalizedSearch));

      return matchesStatus && matchesSearch;
    });
  }, [allProjects, searchQuery, statusFilter]);

  const hasActiveProjectFilters = searchQuery.trim().length > 0 || statusFilter !== 'ALL';

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
    if (!selectedProject) return;

    try {
      await cloneProject.mutateAsync({
        sourceProjectId: selectedProject.id,
        newName: cloneData.name,
        includeTasks: cloneData.includeTasks,
        includeSprints: cloneData.includeSprints,
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
          action={{ label: 'Go to Workspaces', href: '/workspaces' }}
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

      {allProjects.length > 0 && (
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
              <SelectItem value="ALL">All but archived</SelectItem>
              {/* Archived is how a project is archived (Project settings), and
                  this is where archived projects are found again. */}
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
      {statusFilter === 'ALL' && archivedCount > 0 && visibleProjects.length > 0 && (
        <p className="-mt-3 text-sm text-muted-foreground">
          {archivedCount} archived {archivedCount === 1 ? 'project is' : 'projects are'} not listed.{' '}
          <Button variant="link" className="h-auto p-0" onClick={() => setStatusFilter('ARCHIVED')}>
            Show {archivedCount === 1 ? 'it' : 'them'}
          </Button>
        </p>
      )}

      {visibleProjects.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visibleProjects.map((project) => {
            const status = getProjectStatusConfig(project.status);
            const projectTasks = allTasks?.filter((task) => task.projectId === project.id) || [];
            const health = calculateProjectHealth(project, allTasks || []);

            return (
              <Card
                key={project.id}
                className="group flex h-full flex-col overflow-hidden"
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
                    {/* Only when it holds something: for somebody who may neither
                        edit, clone nor delete, the ⋮ opened an empty menu. */}
                    {(canEditProject || canManageSettings || canCreateProject || canDeleteProject) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${project.name}`}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {/* One way to edit a project. There were two — an "Edit
                              Project" dialog here and a "Settings" page — over the
                              same fields and behind the same permission, each
                              with its own idea of what a save sends. The page is
                              the one that also deletes. */}
                          {(canEditProject || canManageSettings) && (
                            <DropdownMenuItem asChild className="cursor-pointer">
                              <Link href={`/projects/${project.id}/settings`}>
                                <Settings className="mr-2 h-4 w-4" />
                                Project Settings
                              </Link>
                            </DropdownMenuItem>
                          )}
                          {/* The permission cloning needs, not the Manager role by
                              name: a custom role that may create projects was
                              never offered this. */}
                          {canCreateProject && (
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
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4">
                  <div className="grid gap-2 text-sm text-muted-foreground">
                    <div className="flex items-start gap-1">
                      <Calendar className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{describeProjectDates(project.startDate, project.endDate)}</span>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center gap-2 pt-2">
                    <Button asChild className="flex-1 transition-transform group-hover:-translate-y-px">
                      <Link href={`/projects/${project.id}`}>View Project</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : allProjects.length > 0 && statusFilter === 'ALL' && !searchQuery.trim() ? (
        <EmptyState
          icon={Archive}
          title="Every project here is archived"
          description="Archived projects are kept out of this list."
          action={{ label: 'Show archived projects', onClick: () => setStatusFilter('ARCHIVED') }}
        />
      ) : allProjects.length > 0 ? (
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
          description={
            canCreateProject
              ? 'Create your first project to start organizing tasks and sprints.'
              : 'Projects in this workspace will be listed here.'
          }
          action={canCreateProject ? { label: 'New Project', onClick: () => setCreateDialogOpen(true) } : undefined}
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

      {/* Clone Project Dialog */}
      <CloneProjectDialog
        project={selectedProject}
        open={cloneDialogOpen}
        onOpenChange={setCloneDialogOpen}
        onClone={handleClone}
        isLoading={cloneProject.isPending}
        canCopyWork={canWriteRequirements && canPlan && canCreateTask}
        canCopySprints={canPlan}
      />
    </div>
  );
}
