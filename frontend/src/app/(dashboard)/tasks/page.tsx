'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TaskBoard } from '@/components/tasks/task-board';
import { CreateTaskDialog } from '@/components/tasks/create-task-dialog';
import { TaskDetailsDialog } from '@/components/tasks/task-details-dialog';
import { EditTaskDialog } from '@/components/tasks/edit-task-dialog';
import {
  useTasks,
  useCreateTask,
  useUpdateTask,
  useUpdateTaskStatus,
  useDeleteTask,
} from '@/hooks/use-task';
import { useProjects } from '@/hooks/use-project';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useEpics } from '@/hooks/use-epic';
import { useFunctionalRequirements } from '@/hooks/use-functional-requirement';
import { useSprints } from '@/hooks/use-sprint';
import { Plus, Search, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Task, TaskStatus } from '@/types';
import { useIsAdmin, useHasPermission, useUserRole } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';

export default function TasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const projectIdFromUrl = searchParams.get('projectId');
  const taskIdFromUrl = searchParams.get('taskId');

  // Permission checks - only managers/assistant managers can edit/delete tasks
  const isAdmin = useIsAdmin();
  const userRole = useUserRole();
  const canEditAnyTask = useHasPermission(Permission.EDIT_ANY_TASK);
  const canDeleteTask = useHasPermission(Permission.DELETE_TASK);
  const canCreateTask = useHasPermission(Permission.CREATE_TASK);

  const [selectedProjectId, setSelectedProjectId] = React.useState<string>(projectIdFromUrl || '');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = React.useState(false);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = React.useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);
  const [selectedTask, setSelectedTask] = React.useState<Task | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [deleteTaskId, setDeleteTaskId] = React.useState<string | null>(null);
  // Multi-field sorting: array of { field, direction } objects
  const [sortCriteria, setSortCriteria] = React.useState<
    Array<{ field: string; direction: 'asc' | 'desc' }>
  >([{ field: 'priority', direction: 'desc' }]);

  const { data: projects } = useProjects(currentWorkspace?.id);
  const { data: tasks = [], isLoading: isLoadingTasks } = useTasks(selectedProjectId || undefined);
  const { data: epics = [] } = useEpics(selectedProjectId || undefined);
  const { data: functionalRequirements = [] } = useFunctionalRequirements(
    selectedProjectId || undefined
  );
  const { data: sprints = [] } = useSprints(selectedProjectId || undefined);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const updateTaskStatus = useUpdateTaskStatus();
  const deleteTask = useDeleteTask();

  // Open task dialog if taskId is in URL (from notification click)
  React.useEffect(() => {
    if (taskIdFromUrl && tasks.length > 0) {
      const task = tasks.find((t) => t.id === taskIdFromUrl);
      if (task) {
        setSelectedTask(task);
        setIsDetailsDialogOpen(true);
        // Clear the taskId from URL after opening the dialog
        const params = new URLSearchParams(searchParams.toString());
        params.delete('taskId');
        router.replace(`/tasks?${params.toString()}`);
      }
    }
  }, [taskIdFromUrl, tasks, searchParams, router]);

  // Restore project selection from localStorage or set from URL/first project
  React.useEffect(() => {
    const STORAGE_KEY = 'selected-project-id';

    // Priority: URL param > localStorage > first project
    if (projectIdFromUrl) {
      setSelectedProjectId(projectIdFromUrl);
      localStorage.setItem(STORAGE_KEY, projectIdFromUrl);
    } else {
      const savedProjectId = localStorage.getItem(STORAGE_KEY);

      if (savedProjectId && projects?.some((p) => p.id === savedProjectId)) {
        // Restore saved project if it still exists
        setSelectedProjectId(savedProjectId);
      } else if (projects && projects.length > 0 && !selectedProjectId) {
        // Default to first project if no saved selection
        const firstProjectId = projects[0].id;
        setSelectedProjectId(firstProjectId);
        localStorage.setItem(STORAGE_KEY, firstProjectId);
      }
    }
  }, [projects, projectIdFromUrl, selectedProjectId]);

  const selectedProject = React.useMemo(() => {
    return projects?.find((p) => p.id === selectedProjectId);
  }, [projects, selectedProjectId]);

  // Extract all unique labels from existing tasks
  const existingLabels = React.useMemo(() => {
    const allLabels = new Set<string>();
    tasks.forEach((task) => {
      if (task.labels && Array.isArray(task.labels)) {
        task.labels.forEach((label) => allLabels.add(label));
      }
    });
    return Array.from(allLabels);
  }, [tasks]);

  // Create a map of FR IDs to their sprint status for quick lookup
  const frSprintStatusMap = React.useMemo(() => {
    const map = new Map<string, 'PLANNING' | 'ACTIVE' | 'COMPLETED' | null>();

    functionalRequirements.forEach((fr) => {
      if (fr.sprintId) {
        const sprint = sprints.find((s) => s.id === fr.sprintId);
        map.set(fr.id, sprint?.status || null);
      } else {
        map.set(fr.id, null); // FR not in any sprint
      }
    });

    return map;
  }, [functionalRequirements, sprints]);

  // Create a map of sprint IDs to their status for quick lookup
  const sprintStatusMap = React.useMemo(() => {
    const map = new Map<string, 'PLANNING' | 'ACTIVE' | 'COMPLETED'>();
    sprints.forEach((sprint) => {
      map.set(sprint.id, sprint.status);
    });
    return map;
  }, [sprints]);

  // Filter tasks to show only those:
  // 1. Assigned to current user OR created by current user
  // 2. If task has a direct sprintId, only show if sprint is ACTIVE
  // 3. If linked to an FR in a sprint, only show if sprint is ACTIVE
  const myTasks = React.useMemo(() => {
    if (!user) return tasks;

    return tasks.filter((task) => {
      const isAssignedToMe = task.assignedTo?.includes(user.id) || false;
      const isCreatedByMe = task.createdBy === user.id;

      // First check user assignment
      if (!isAssignedToMe && !isCreatedByMe) return false;

      // If task has a direct sprintId, check if that sprint is ACTIVE
      if (task.sprintId) {
        const sprintStatus = sprintStatusMap.get(task.sprintId);
        // Hide tasks in sprints that are PLANNING or COMPLETED
        if (sprintStatus && sprintStatus !== 'ACTIVE') {
          return false;
        }
      }

      // If task is linked to an FR, check if the FR's sprint is active
      if (task.functionalRequirementId) {
        const frSprintStatus = frSprintStatusMap.get(task.functionalRequirementId);

        // If FR is in a sprint that is NOT active (PLANNING or COMPLETED), hide the task
        if (frSprintStatus && frSprintStatus !== 'ACTIVE') {
          return false;
        }
      }

      return true;
    });
  }, [tasks, user, frSprintStatusMap, sprintStatusMap]);

  // Priority order for sorting (higher number = higher priority)
  const priorityOrder: Record<string, number> = React.useMemo(
    () => ({
      CRITICAL: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    }),
    []
  );

  // Status order for sorting (based on workflow)
  const statusOrder: Record<string, number> = React.useMemo(
    () => ({
      BACKLOG: 1,
      TODO: 2,
      IN_PROGRESS: 3,
      REVIEW: 4,
      DONE: 5,
    }),
    []
  );

  // Calculate urgency score based on due date
  const getUrgencyScore = (task: Task): number => {
    if (!task.dueDate) return 0; // No due date = lowest urgency
    const now = new Date();
    const dueDate = new Date(task.dueDate);
    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilDue < 0) return 100; // Overdue = highest urgency
    if (daysUntilDue === 0) return 90; // Due today
    if (daysUntilDue === 1) return 80; // Due tomorrow
    if (daysUntilDue <= 3) return 70; // Due within 3 days
    if (daysUntilDue <= 7) return 50; // Due within a week
    return Math.max(1, 30 - daysUntilDue); // Further out = lower urgency
  };

  // Compare function for a single field
  const compareByField = React.useCallback(
    (a: Task, b: Task, field: string): number => {
      switch (field) {
        case 'priority':
          return (priorityOrder[a.priority] || 0) - (priorityOrder[b.priority] || 0);
        case 'urgency':
          return getUrgencyScore(a) - getUrgencyScore(b);
        case 'dueDate': {
          const dateA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const dateB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          return dateA - dateB;
        }
        case 'status':
          return (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
        case 'title':
          return a.title.localeCompare(b.title);
        case 'hierarchyId':
          return a.hierarchyId.localeCompare(b.hierarchyId);
        case 'createdAt':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'updatedAt':
          return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        case 'labels':
          return (a.labels?.length || 0) - (b.labels?.length || 0);
        case 'estimatedHours':
          return (a.estimatedHours || 0) - (b.estimatedHours || 0);
        default:
          return 0;
      }
    },
    [priorityOrder, statusOrder]
  );

  // Multi-field sort function
  const sortTasks = React.useCallback(
    (tasksToSort: Task[]): Task[] => {
      if (sortCriteria.length === 0) return tasksToSort;

      return [...tasksToSort].sort((a, b) => {
        for (const criterion of sortCriteria) {
          const comparison = compareByField(a, b, criterion.field);
          if (comparison !== 0) {
            return criterion.direction === 'asc' ? comparison : -comparison;
          }
        }
        return 0;
      });
    },
    [sortCriteria, compareByField]
  );

  const filteredTasks = React.useMemo(() => {
    let result = myTasks;

    // Apply search filter (includes labels)
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((task) => {
        // Check title, hierarchyId, description
        if (task.title.toLowerCase().includes(query)) return true;
        if (task.hierarchyId.toLowerCase().includes(query)) return true;
        if (task.description?.toLowerCase().includes(query)) return true;

        // Check labels (search in label text)
        if (task.labels && Array.isArray(task.labels)) {
          for (const label of task.labels) {
            // Labels can be "color:text" format or just text
            const labelText = label.includes(':') ? label.split(':')[1] : label;
            if (labelText.toLowerCase().includes(query)) return true;
          }
        }

        return false;
      });
    }

    // Apply sorting
    return sortTasks(result);
  }, [myTasks, searchQuery, sortTasks]);

  // Toggle sort - add field to criteria or toggle its direction
  const handleSort = (field: string, addToExisting: boolean = false) => {
    const defaultDirection: 'asc' | 'desc' =
      field === 'title' || field === 'hierarchyId' ? 'asc' : 'desc';

    setSortCriteria((prev) => {
      const existingIndex = prev.findIndex((c) => c.field === field);

      if (existingIndex !== -1) {
        // Field exists - toggle direction or remove if clicking again with same direction
        const existing = prev[existingIndex];
        const newDirection = existing.direction === 'asc' ? 'desc' : 'asc';
        const newCriteria = [...prev];
        newCriteria[existingIndex] = { field, direction: newDirection };
        return newCriteria;
      } else if (addToExisting && prev.length < 3) {
        // Add as secondary sort (max 3 criteria)
        return [...prev, { field, direction: defaultDirection }];
      } else {
        // Replace all with single sort
        return [{ field, direction: defaultDirection }];
      }
    });
  };

  // Remove a sort criterion
  const removeSortCriterion = (field: string) => {
    setSortCriteria((prev) => {
      const filtered = prev.filter((c) => c.field !== field);
      // Keep at least one criterion
      return filtered.length > 0 ? filtered : [{ field: 'priority', direction: 'desc' }];
    });
  };

  // Check if field is in sort criteria
  const getSortCriterion = (field: string) => {
    return sortCriteria.find((c) => c.field === field);
  };

  // Field labels for display
  const fieldLabels: Record<string, string> = {
    priority: 'Priority',
    urgency: 'Urgency',
    dueDate: 'Due Date',
    status: 'Status',
    title: 'Title',
    hierarchyId: 'Task id',
    createdAt: 'Created',
    updatedAt: 'Updated',
    labels: 'Labels',
    estimatedHours: 'Hours',
  };

  // Get sort label for display
  const getSortLabel = () => {
    if (sortCriteria.length === 0) return 'Sort';
    if (sortCriteria.length === 1) {
      return fieldLabels[sortCriteria[0].field] || 'Sort';
    }
    return `${sortCriteria.length} fields`;
  };

  const handleProjectChange = (projectId: string) => {
    setSelectedProjectId(projectId);
    localStorage.setItem('selected-project-id', projectId);
    const params = new URLSearchParams(searchParams.toString());
    params.set('projectId', projectId);
    router.push(`/tasks?${params.toString()}`);
  };

  const handleCreateTask = async (values: any) => {
    if (!selectedProjectId || !selectedProject || !user || !currentWorkspace) return;

    await createTask.mutateAsync({
      workspaceId: currentWorkspace.id,
      projectId: selectedProjectId,
      projectCode: selectedProject.shortCode,
      title: values.title,
      description: values.description,
      status: values.status,
      priority: values.priority,
      createdBy: user.id,
      createdByName: user.name, // ✅ Add creator name
      assignedBy: user.id, // ✅ Who is assigning the task
      assignedByName: user.name, // ✅ Assigner's name
      dueDate: values.dueDate?.toISOString(),
      epicId: values.epicId && values.epicId !== 'none' ? values.epicId : undefined,
      functionalRequirementId:
        values.functionalRequirementId && values.functionalRequirementId !== 'none'
          ? values.functionalRequirementId
          : undefined,
      labels: values.labels || [],
      assigneeIds: values.assignedTo || [], // Map assignedTo from form to assigneeIds for mutation
    });

    setIsCreateDialogOpen(false);
  };

  const handleTaskMove = async (taskId: string, newStatus: TaskStatus, newPosition: number) => {
    if (!selectedProjectId) return;

    await updateTaskStatus.mutateAsync({
      taskId,
      projectId: selectedProjectId,
      status: newStatus,
      position: newPosition,
      currentUserRole: userRole || undefined, // ✅ Pass role for permission check
    });
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setIsDetailsDialogOpen(true);
  };

  const handleTaskEdit = (task: Task) => {
    setSelectedTask(task);
    setIsDetailsDialogOpen(false);
    setIsEditDialogOpen(true);
  };

  const handleTaskDelete = (taskId: string) => {
    setDeleteTaskId(taskId);
    setIsDetailsDialogOpen(false);
  };

  const handleEditTask = async (values: any) => {
    if (!selectedTask || !selectedProjectId) return;

    await updateTask.mutateAsync({
      taskId: selectedTask.id,
      projectId: selectedProjectId,
      updates: {
        title: values.title,
        description: values.description,
        status: values.status,
        priority: values.priority,
        dueDate: values.dueDate?.toISOString(),
        epicId: values.epicId && values.epicId !== 'none' ? values.epicId : undefined,
        labels: values.labels || [],
        assigneeIds: values.assigneeIds || [],
        assignedTo: values.assigneeIds || [],
      },
    });

    setIsEditDialogOpen(false);
    setSelectedTask(null);
  };

  const confirmDelete = async () => {
    if (!deleteTaskId || !selectedProjectId) return;

    await deleteTask.mutateAsync({
      taskId: deleteTaskId,
      projectId: selectedProjectId,
    });

    setDeleteTaskId(null);
  };

  if (!currentWorkspace) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
          <p className="text-muted-foreground">Create a workspace first to manage tasks</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>No Workspace</CardTitle>
            <CardDescription>
              You need to create or join a workspace before you can manage tasks.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push('/onboarding')}>Create Workspace</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">My Tasks</h1>
        <p className="text-muted-foreground">
          Tasks assigned to you or created by you ({myTasks.length} total)
        </p>
      </div>

      {/* Filters and Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="w-full sm:w-64">
          <Select value={selectedProjectId || ''} onValueChange={handleProjectChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              {projects?.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{project.shortCode}</span>
                    <span>{project.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 w-full sm:max-w-md">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        <div className="flex gap-2 w-full sm:w-auto">
          {canCreateTask && (
            <Button
              onClick={() => setIsCreateDialogOpen(true)}
              disabled={!selectedProjectId}
              className="flex-1 sm:flex-none"
            >
              <Plus className="mr-2 h-4 w-4" />
              New Task
            </Button>
          )}

          {/* Sort Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <ArrowUpDown className="h-4 w-4" />
                <span className="hidden sm:inline">{getSortLabel()}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                Sort by{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  (Shift+Click to add)
                </span>
              </DropdownMenuLabel>

              {/* Active sort criteria */}
              {sortCriteria.length > 0 && (
                <>
                  <div className="px-2 py-1.5 space-y-1">
                    {sortCriteria.map((criterion, index) => (
                      <div
                        key={criterion.field}
                        className="flex items-center gap-2 text-xs bg-muted rounded px-2 py-1"
                      >
                        <span className="text-muted-foreground">{index + 1}.</span>
                        <span className="flex-1">{fieldLabels[criterion.field]}</span>
                        {criterion.direction === 'asc' ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )}
                        {sortCriteria.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              removeSortCriterion(criterion.field);
                            }}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <DropdownMenuSeparator />
                </>
              )}

              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={(e) => handleSort('priority', e.shiftKey)}
                  className="gap-2"
                >
                  {getSortCriterion('priority') ? (
                    getSortCriterion('priority')?.direction === 'asc' ? (
                      <ArrowUp className="h-4 w-4 text-primary" />
                    ) : (
                      <ArrowDown className="h-4 w-4 text-primary" />
                    )
                  ) : (
                    <span className="w-4" />
                  )}
                  Priority
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => handleSort('urgency', e.shiftKey)}
                  className="gap-2"
                >
                  {getSortCriterion('urgency') ? (
                    getSortCriterion('urgency')?.direction === 'asc' ? (
                      <ArrowUp className="h-4 w-4 text-primary" />
                    ) : (
                      <ArrowDown className="h-4 w-4 text-primary" />
                    )
                  ) : (
                    <span className="w-4" />
                  )}
                  Urgency (Due Date)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => handleSort('dueDate', e.shiftKey)}
                  className="gap-2"
                >
                  {getSortCriterion('dueDate') ? (
                    getSortCriterion('dueDate')?.direction === 'asc' ? (
                      <ArrowUp className="h-4 w-4 text-primary" />
                    ) : (
                      <ArrowDown className="h-4 w-4 text-primary" />
                    )
                  ) : (
                    <span className="w-4" />
                  )}
                  Due Date
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => handleSort('status', e.shiftKey)}
                  className="gap-2"
                >
                  {getSortCriterion('status') ? (
                    getSortCriterion('status')?.direction === 'asc' ? (
                      <ArrowUp className="h-4 w-4 text-primary" />
                    ) : (
                      <ArrowDown className="h-4 w-4 text-primary" />
                    )
                  ) : (
                    <span className="w-4" />
                  )}
                  Status
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={(e) => handleSort('title', e.shiftKey)}
                  className="gap-2"
                >
                  {getSortCriterion('title') ? (
                    getSortCriterion('title')?.direction === 'asc' ? (
                      <ArrowUp className="h-4 w-4 text-primary" />
                    ) : (
                      <ArrowDown className="h-4 w-4 text-primary" />
                    )
                  ) : (
                    <span className="w-4" />
                  )}
                  Title (A-Z)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => handleSort('hierarchyId', e.shiftKey)}
                  className="gap-2"
                >
                  {getSortCriterion('hierarchyId') ? (
                    getSortCriterion('hierarchyId')?.direction === 'asc' ? (
                      <ArrowUp className="h-4 w-4 text-primary" />
                    ) : (
                      <ArrowDown className="h-4 w-4 text-primary" />
                    )
                  ) : (
                    <span className="w-4" />
                  )}
                  Task id
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => handleSort('labels', e.shiftKey)}
                  className="gap-2"
                >
                  {getSortCriterion('labels') ? (
                    getSortCriterion('labels')?.direction === 'asc' ? (
                      <ArrowUp className="h-4 w-4 text-primary" />
                    ) : (
                      <ArrowDown className="h-4 w-4 text-primary" />
                    )
                  ) : (
                    <span className="w-4" />
                  )}
                  Labels Count
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={(e) => handleSort('createdAt', e.shiftKey)}
                  className="gap-2"
                >
                  {getSortCriterion('createdAt') ? (
                    getSortCriterion('createdAt')?.direction === 'asc' ? (
                      <ArrowUp className="h-4 w-4 text-primary" />
                    ) : (
                      <ArrowDown className="h-4 w-4 text-primary" />
                    )
                  ) : (
                    <span className="w-4" />
                  )}
                  Created Date
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => handleSort('updatedAt', e.shiftKey)}
                  className="gap-2"
                >
                  {getSortCriterion('updatedAt') ? (
                    getSortCriterion('updatedAt')?.direction === 'asc' ? (
                      <ArrowUp className="h-4 w-4 text-primary" />
                    ) : (
                      <ArrowDown className="h-4 w-4 text-primary" />
                    )
                  ) : (
                    <span className="w-4" />
                  )}
                  Updated Date
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => handleSort('estimatedHours', e.shiftKey)}
                  className="gap-2"
                >
                  {getSortCriterion('estimatedHours') ? (
                    getSortCriterion('estimatedHours')?.direction === 'asc' ? (
                      <ArrowUp className="h-4 w-4 text-primary" />
                    ) : (
                      <ArrowDown className="h-4 w-4 text-primary" />
                    )
                  ) : (
                    <span className="w-4" />
                  )}
                  Estimated Hours
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Task Board */}
      {selectedProjectId ? (
        isLoadingTasks ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading tasks...</p>
            </div>
          </div>
        ) : (
          <TaskBoard
            tasks={filteredTasks}
            projectId={selectedProjectId}
            showMenu={true}
            sortCriteria={sortCriteria}
            canEdit={canEditAnyTask || isAdmin}
            canDelete={canDeleteTask || isAdmin}
            onTaskMove={handleTaskMove}
            onTaskClick={handleTaskClick}
            onTaskEdit={handleTaskEdit}
            onTaskDelete={handleTaskDelete}
          />
        )
      ) : (
        <div className="flex items-center justify-center h-96 border-2 border-dashed rounded-lg">
          <div className="text-center">
            <p className="text-lg font-medium mb-2">Select a Project</p>
            <p className="text-sm text-muted-foreground">
              Choose a project from the dropdown to view its tasks
            </p>
          </div>
        </div>
      )}

      {/* Create Task Dialog */}
      <CreateTaskDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onSubmit={handleCreateTask}
        isLoading={createTask.isPending}
        existingLabels={existingLabels}
        epics={epics}
        functionalRequirements={functionalRequirements}
        workspaceId={currentWorkspace.id}
      />

      {/* Task Details Dialog */}
      <TaskDetailsDialog
        task={selectedTask}
        open={isDetailsDialogOpen}
        onOpenChange={setIsDetailsDialogOpen}
        onEdit={canEditAnyTask || isAdmin ? handleTaskEdit : undefined}
        onDelete={canDeleteTask || isAdmin ? handleTaskDelete : undefined}
      />

      {/* Edit Task Dialog */}
      <EditTaskDialog
        task={selectedTask}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        onSubmit={handleEditTask}
        isLoading={updateTask.isPending}
        existingLabels={existingLabels}
        epics={epics}
        workspaceId={currentWorkspace.id}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTaskId} onOpenChange={() => setDeleteTaskId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this task? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
