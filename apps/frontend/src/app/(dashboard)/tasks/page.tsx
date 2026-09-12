'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCreateActionParam } from '@/hooks/use-create-action-param';
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
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/ui/error-state';
import { InlineLoader, PageLoader } from '@/components/ui/page-loader';
import {
  useTasks,
  useCreateTask,
  useUpdateTask,
  useUpdateTaskStatus,
  useDeleteTask,
  useReorderTasks,
} from '@/hooks/use-task';
import { useProjects } from '@/hooks/use-project';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useEpics } from '@/hooks/use-epic';
import { useFunctionalRequirements } from '@/hooks/use-functional-requirement';
import { useSprints } from '@/hooks/use-sprint';
import { Plus, Search, ArrowUpDown, ArrowUp, ArrowDown, X } from 'lucide-react';
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
import { useIsAdmin, useHasPermission, useHasPermissionResolved } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';

// The two halves of the Manual-order notice, shared by the banner and the live
// region that announces it, so they can never drift apart.
const MANUAL_ORDER_NOTICE = 'Sorted by Manual order so your arrangement stays put.';
// Manual order is board-wide, not per column: the other four columns swap from
// the old sort to their own saved order at the same moment, which is alarming
// if nothing says it is coming.
const MANUAL_ORDER_NOTICE_DETAIL = 'Every column now shows its saved order.';

function TasksPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const projectIdFromUrl = searchParams.get('projectId');
  const taskIdFromUrl = searchParams.get('taskId');

  // Permission checks - only managers/assistant managers can edit/delete tasks
  const isAdmin = useIsAdmin();
  // Tri-state on purpose: `undefined` while the membership request is in
  // flight, so the DONE gate never refuses on an unresolved answer. The server
  // (TasksService.patchStatus) is the enforcement point either way.
  const doneGate = useHasPermissionResolved(Permission.EDIT_ANY_TASK);
  const canMarkDone = doneGate.isLoading ? undefined : doneGate.allowed;
  const canEditAnyTask = useHasPermission(Permission.EDIT_ANY_TASK);
  const canDeleteTask = useHasPermission(Permission.DELETE_TASK);
  const canCreateTask = useHasPermission(Permission.CREATE_TASK);

  const [selectedProjectId, setSelectedProjectId] = React.useState<string>(projectIdFromUrl || '');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = React.useState(false);
  // The command palette's "Create New Task" navigates here with ?action=create.
  useCreateActionParam(() => setIsCreateDialogOpen(true));
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = React.useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);
  const [selectedTask, setSelectedTask] = React.useState<Task | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [deleteTaskId, setDeleteTaskId] = React.useState<string | null>(null);
  // Multi-field sorting: array of { field, direction } objects
  const [sortCriteria, setSortCriteria] = React.useState<
    Array<{ field: string; direction: 'asc' | 'desc' }>
  >([{ field: 'priority', direction: 'desc' }]);
  // The "we switched you to Manual order" notice, and the sort to put back.
  // This used to be a toast with an action, and the action could not be
  // clicked: dropping a card raises a realtime "Task Status Changed"
  // notification for the same user a beat later, Sonner stacks the newcomer in
  // FRONT, and everything behind the front toast is pointer-events: none — so
  // the undo rendered, was reported as shown, and swallowed every click. An
  // undo the user cannot reach is not an undo, and it has no business expiring
  // after four seconds either, so it is a banner on the page now.
  const [sortSwitchNotice, setSortSwitchNotice] = React.useState<{
    previous: Array<{ field: string; direction: 'asc' | 'desc' }>;
  } | null>(null);

  const { data: projects } = useProjects(currentWorkspace?.id);
  const {
    data: tasks = [],
    isLoading: isLoadingTasks,
    isError: isErrorTasks,
    refetch: refetchTasks,
  } = useTasks(selectedProjectId || undefined);
  const { data: epics = [] } = useEpics(selectedProjectId || undefined);
  const { data: functionalRequirements = [] } = useFunctionalRequirements(
    selectedProjectId || undefined
  );
  const { data: sprints = [] } = useSprints(selectedProjectId || undefined);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const updateTaskStatus = useUpdateTaskStatus();
  const deleteTask = useDeleteTask();
  const reorderTasks = useReorderTasks();

  // `?taskId` ADDRESSES the open task; it is not a one-shot command like
  // `?action=create` (see useCreateActionParam, which is right to consume its
  // parameter — "open the create dialog" has no record behind it to point at).
  // This used to strip `taskId` the instant the dialog opened, which threw the
  // address away before the user could use it: F5 landed on the bare board, and
  // the link a notification handed them could be neither shared nor bookmarked.
  // So the parameter now lives exactly as long as the dialog does — written
  // whenever a task dialog opens, removed when it closes.
  //
  // Shallow, for the same reason as handleProjectChange below: this is a URL
  // correction on a client page that reads `useSearchParams`, not a navigation.
  // `replaceState`, not `pushState`, because opening a dialog is not a place in
  // history — and the state argument must be null or the App Router treats the
  // entry as its own and skips syncing `useSearchParams` to it.
  const setTaskParam = React.useCallback((taskId: string | null) => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('taskId') === (taskId ?? null)) return;
    if (taskId) url.searchParams.set('taskId', taskId);
    else url.searchParams.delete('taskId');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  // Honour an inbound `?taskId` once per arrival. `tasks` is empty on the first
  // pass of a hard load, so this keeps trying until the task turns up; the ref
  // is what stops it re-opening a dialog the user has since closed, because the
  // close writes the URL and this effect re-runs on the way out.
  const autoOpenedTaskId = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!taskIdFromUrl) {
      autoOpenedTaskId.current = null;
      return;
    }
    if (autoOpenedTaskId.current === taskIdFromUrl) return;
    const task = tasks.find((t) => t.id === taskIdFromUrl);
    if (!task) return;
    autoOpenedTaskId.current = taskIdFromUrl;
    setSelectedTask(task);
    setIsDetailsDialogOpen(true);
  }, [taskIdFromUrl, tasks]);

  // `?projectId` is an entry point (bookmark, refresh, deep link, back button),
  // not a live binding. Re-applying it on every render fought the selector: the
  // state update from handleProjectChange re-ran this effect while the URL still
  // carried the OLD id, so the choice — and the trigger label — snapped straight
  // back and the page stayed stuck on the project it was loaded with.
  const appliedUrlProjectId = React.useRef<string | null>(null);

  // Restore project selection from localStorage or set from URL/first project
  React.useEffect(() => {
    const STORAGE_KEY = 'selected-project-id';

    // Priority: URL param > localStorage > first project
    if (projectIdFromUrl) {
      if (appliedUrlProjectId.current === projectIdFromUrl) return;
      appliedUrlProjectId.current = projectIdFromUrl;
      setSelectedProjectId(projectIdFromUrl);
      localStorage.setItem(STORAGE_KEY, projectIdFromUrl);
    } else {
      appliedUrlProjectId.current = null;
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
        case 'position':
          // The hand-made board order. It has to be sortable here as well as in
          // TaskBoard, because handleTaskMove renumbers against this order.
          return a.position - b.position;
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

  // A drag can only ever be stored in `position`, so this is the one sort under
  // which the board can show a hand-made arrangement back to the user.
  const isManualOrder = sortCriteria.length === 1 && sortCriteria[0].field === 'position';

  // Toggle sort - add field to criteria or toggle its direction
  const handleSort = (field: string, addToExisting: boolean = false) => {
    // Any deliberate choice from the sort menu supersedes the automatic switch,
    // so the offer to undo it goes away — including a deliberate pick of Manual
    // order, which the user then owns rather than having had it done to them.
    setSortSwitchNotice(null);

    // Manual order IS the stored board order: it is exclusive (no secondary
    // field can refine it) and it never reverses, because a column shown upside
    // down would make every subsequent drop read backwards.
    if (field === 'position') {
      setSortCriteria([{ field: 'position', direction: 'asc' }]);
      return;
    }

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
    setSortSwitchNotice(null);
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
    position: 'Manual',
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

  // Name a sort. Takes the criteria explicitly rather than reading state, so
  // the Manual-order notice can offer to put back a sort that is no longer the
  // current one.
  const labelForCriteria = (criteria: Array<{ field: string; direction: 'asc' | 'desc' }>) => {
    if (criteria.length === 0) return 'Sort';
    if (criteria.length === 1) return fieldLabels[criteria[0].field] || 'Sort';
    return `${criteria.length} fields`;
  };

  // Get sort label for display
  const getSortLabel = () => labelForCriteria(sortCriteria);

  const handleProjectChange = (projectId: string) => {
    setSelectedProjectId(projectId);
    localStorage.setItem('selected-project-id', projectId);

    const params = new URLSearchParams(searchParams.toString());
    params.set('projectId', projectId);
    // `?taskId` names a task in the project being left behind, so it cannot
    // survive the swap — the board would carry an address that resolves to
    // nothing on the next load.
    params.delete('taskId');
    // Shallow, like useCreateActionParam: swapping the project re-renders this
    // client page off `useSearchParams`, it is not a navigation. It also has to
    // be shallow to work at all — on a page HARD-LOADED with a query string,
    // router.push() of a query-only change never reached the address bar, so
    // the selector was dead on exactly the URLs a bookmark or a deep link gives
    // you. The state argument must be null: the App Router only syncs itself to
    // a pushState it did not originate, and passing history.state back hands it
    // its own marker, which makes it skip the update and leave the board behind.
    window.history.pushState(null, '', `/tasks?${params.toString()}`);
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
      estimatedHours: values.estimatedHours,
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

  const handleTaskMove = async (
    taskId: string,
    newStatus: TaskStatus,
    beforeTaskId: string | null
  ) => {
    if (!selectedProjectId) return;

    const movedTask = tasks.find((t) => t.id === taskId);
    if (!movedTask) return;

    // The board renders a FILTERED subset, so the drop only names a card to land
    // in front of. Anchor it in the full column — sorted the way the board just
    // rendered it, NOT by position — and renumber from there: renumbering only
    // the visible rows would overwrite the positions of hidden siblings, and
    // anchoring in position order (what this used to do) put the card wherever
    // the rendered order and the stored order happened to disagree.
    const destinationColumn = sortTasks(
      tasks.filter((t) => t.status === newStatus && t.id !== taskId)
    );
    const anchorIndex = beforeTaskId
      ? destinationColumn.findIndex((t) => t.id === beforeTaskId)
      : -1;
    const insertAt = anchorIndex >= 0 ? anchorIndex : destinationColumn.length;
    const isReorderWithinColumn = movedTask.status === newStatus;

    // Where the CURRENT sort would put this card in that column on its own. If
    // that is already the slot it was dropped in, the sort HONOURS the drop:
    // nothing has to be stored and nothing has to be re-sorted. (Array#sort is
    // stable and the card is appended before sorting, so it settles after its
    // equals — which is where dragging past them would leave it.)
    const sortedIndex = sortTasks([...destinationColumn, movedTask]).findIndex(
      (t) => t.id === taskId
    );
    const dropMatchesSort = insertAt === sortedIndex;

    // Same column, and the sort already renders the card in the dropped slot:
    // the drag only looked like a move because the board renders a filtered
    // subset of the column, so there is nothing to write and nothing to
    // explain. NOT under Manual order though — there `position` is what is on
    // screen, `insertAt` is a dense index while the stored positions can be
    // sparse or (on legacy rows) all zero, and a drag is the user curating the
    // order by hand. Every manual drop writes.
    if (isReorderWithinColumn && !isManualOrder && dropMatchesSort) return;

    // A drop only means something the board can show back if the arrangement is
    // both STORED and VISIBLE. `position` is the only place a drag can be
    // stored, and it is invisible under every sort but Manual — so an
    // arrangement the current sort would not reproduce has to switch the board
    // over, or the card springs back and the gesture looks discarded.
    //
    // This used to fire for WITHIN-column drops only. A cross-column drop at a
    // chosen slot was appended to the end and returned early, before both the
    // renumber AND the toast — i.e. the finding's own symptom, a chosen drop
    // position ignored with no explanation, still happened verbatim whenever
    // the drag crossed columns. Both paths take the same route now.
    const storeArrangement = isManualOrder || !dropMatchesSort;
    const needsManualOrder = !isManualOrder && storeArrangement;
    const endPosition = destinationColumn.reduce((max, t) => Math.max(max, t.position), -1) + 1;

    const previousSort = sortCriteria;
    const restoreSort = () => {
      if (needsManualOrder) {
        setSortCriteria(previousSort);
        setSortSwitchNotice(null);
      }
    };

    if (needsManualOrder) {
      // Flip BEFORE the writes, not after them. `mutateAsync` settles only once
      // onSuccess has finished — parent-progress recompute, parent
      // invalidations and a project fetch — and every invalidation in between
      // re-renders the board under the OLD sort, so the card visibly sprang
      // back to where it started and only jumped into place seconds later.
      setSortCriteria([{ field: 'position', direction: 'asc' }]);
      setSortSwitchNotice({ previous: previousSort });
    }

    let statusWritten = false;

    try {
      const updatedTask = await updateTaskStatus.mutateAsync({
        taskId,
        projectId: selectedProjectId,
        status: newStatus,
        // When the sort already honours the drop, nobody's stored order needs
        // rewriting: the card is simply a new arrival in this column, so park
        // it at the end rather than flattening a hand-made order that another
        // user set from Manual order and that nobody is currently looking at.
        position: storeArrangement ? insertAt : endPosition,
        canMarkDone,
      });

      // The status change can be refused (e.g. DONE gating); skip renumbering
      // then, and hand the user back the sort they were on.
      if (updatedTask.status !== newStatus) {
        restoreSort();
        return;
      }
      statusWritten = true;
      if (!storeArrangement) return;

      destinationColumn.splice(insertAt, 0, movedTask);

      const positionUpdates = destinationColumn
        .map((t, index) => ({ taskId: t.id, position: index }))
        .filter(
          // The moved task's position was already persisted by the status update above.
          (update, index) =>
            destinationColumn[index].id !== taskId &&
            destinationColumn[index].position !== update.position
        );

      if (positionUpdates.length > 0) {
        await reorderTasks.mutateAsync({ tasks: positionUpdates, projectId: selectedProjectId });
      }
    } catch (error) {
      // The mutation hooks toast their own failures. All this owes the user is
      // not leaving the board on a sort they never asked for when the move that
      // justified it never landed. Once the card HAS moved the manual order is
      // real, so a failed sibling renumber keeps it. Rethrow either way —
      // TaskBoard's drag handler is what swallows it.
      if (!statusWritten) restoreSort();
      throw error;
    }
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setIsDetailsDialogOpen(true);
    // A task opened by hand is just as addressable as one opened from a
    // notification link, so it earns the same URL.
    setTaskParam(task.id);
  };

  // The details and edit dialogs are two views of the SAME record, so the
  // handover between them leaves `?taskId` alone — a refresh mid-edit reopens
  // the task (in details), which is the honest thing for the URL to promise.
  const handleTaskEdit = (task: Task) => {
    setSelectedTask(task);
    setIsDetailsDialogOpen(false);
    setIsEditDialogOpen(true);
    setTaskParam(task.id);
  };

  const closeDetailsDialog = (open: boolean) => {
    setIsDetailsDialogOpen(open);
    if (!open) setTaskParam(null);
  };

  const closeEditDialog = (open: boolean) => {
    setIsEditDialogOpen(open);
    if (!open) setTaskParam(null);
  };

  const handleTaskDelete = (taskId: string) => {
    setDeleteTaskId(taskId);
    setIsDetailsDialogOpen(false);
    // The confirmation is not a view of the task, and the record is about to
    // stop existing — a link to it would 404 the dialog open on the next load.
    setTaskParam(null);
  };

  const handleEditTask = async (values: any) => {
    if (!selectedTask || !selectedProjectId) return;

    await updateTask.mutateAsync({
      taskId: selectedTask.id,
      projectId: selectedProjectId,
      canMarkDone,
      updates: {
        title: values.title,
        description: values.description,
        status: values.status,
        priority: values.priority,
        // Explicit clear values: undefined keys are dropped from the PATCH body, so a
        // cleared due date must travel as null and "No epic" as '' (the schema default).
        dueDate: values.dueDate ? values.dueDate.toISOString() : (null as unknown as string),
        // Same rule as dueDate above: `?? 0` stored a real 0h estimate for a
        // field the user had cleared, and every surface then printed "0h".
        // UpdateTaskDto marks estimatedHours @IsOptional() (which skips null as
        // well as undefined) and TasksService.patch copies any non-undefined
        // value straight through, so null is the clear.
        estimatedHours: values.estimatedHours ?? (null as unknown as number),
        epicId: values.epicId && values.epicId !== 'none' ? values.epicId : '',
        labels: values.labels || [],
        assigneeIds: values.assigneeIds || [],
        assignedTo: values.assigneeIds || [],
      },
    });

    setIsEditDialogOpen(false);
    setSelectedTask(null);
    setTaskParam(null);
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
        <PageHeader title="Tasks" description="Create a workspace first to manage tasks" />
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
      <PageHeader
        title="My Tasks"
        description={`Tasks assigned to you or created by you (${myTasks.length} total)`}
      />

      {/* Filters and Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="w-full sm:w-64">
          <Select value={selectedProjectId || ''} onValueChange={handleProjectChange}>
            <SelectTrigger aria-label="Select a project">
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
            {/* The primitive is `overflow-hidden` with no cap (see
                components/ui/dropdown-menu.tsx), and this menu is ~14 rows tall
                once the active-criteria chips are in it. On a short viewport
                the bottom entries fell off the screen and could not be reached
                by mouse, wheel or keyboard, with Radix's scroll lock holding
                the page still behind it. Radix already measures the room it
                has — cap the height with it and scroll. The real home for this
                is DropdownMenuContent itself, which this file does not own. */}
            <DropdownMenuContent
              align="end"
              className="w-56 max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto"
            >
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
                            className="text-muted-foreground hover:text-destructive-text"
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
                {/* The board can only persist a drag as `position`, so this is
                    the only entry under which a card stays where it is dropped.
                    Without it there was no way to see a hand-made order at all. */}
                <DropdownMenuItem onClick={() => handleSort('position')} className="gap-2">
                  {getSortCriterion('position') ? (
                    <ArrowUp className="h-4 w-4 text-primary" />
                  ) : (
                    <span className="w-4" />
                  )}
                  Manual order (drag & drop)
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
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

      {/* The switch is announced from a live region that is ALWAYS mounted, the
          way Sonner's own announcer is. A `role="status"` that arrives together
          with its text is announced unreliably, and this is replacing a toast
          that did announce — so the region stays and only its text changes.
          `sr-only` is absolutely positioned, so it costs the layout nothing. */}
      <div aria-live="polite" className="sr-only">
        {sortSwitchNotice && isManualOrder
          ? `${MANUAL_ORDER_NOTICE} ${MANUAL_ORDER_NOTICE_DETAIL}`
          : ''}
      </div>

      {/* The undo for the automatic switch to Manual order — a banner, not a
          toast. It is an ordinary, permanently clickable part of the layout
          that no overlay can cover, it sits directly above the board it is
          talking about, and it does not expire. Rendered only while Manual
          order is still in force: once the user has sorted by something else
          there is nothing left to undo. */}
      {sortSwitchNotice && isManualOrder && (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{MANUAL_ORDER_NOTICE}</p>
            <p className="text-xs text-muted-foreground">{MANUAL_ORDER_NOTICE_DETAIL}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1 self-start sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSortCriteria(sortSwitchNotice.previous);
                setSortSwitchNotice(null);
              }}
            >
              Back to {labelForCriteria(sortSwitchNotice.previous)}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Dismiss and keep Manual order"
              onClick={() => setSortSwitchNotice(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Task Board */}
      {selectedProjectId ? (
        isLoadingTasks ? (
          <InlineLoader />
        ) : isErrorTasks ? (
          <ErrorState onRetry={() => refetchTasks()} />
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
        onOpenChange={closeDetailsDialog}
        onEdit={canEditAnyTask || isAdmin ? handleTaskEdit : undefined}
        onDelete={canDeleteTask || isAdmin ? handleTaskDelete : undefined}
        canEditDependencies={canEditAnyTask || isAdmin}
      />

      {/* Edit Task Dialog */}
      <EditTaskDialog
        task={selectedTask}
        open={isEditDialogOpen}
        onOpenChange={closeEditDialog}
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
              This permanently deletes the task and its comments. Subtasks are kept and unlinked
              from this task, and logged time entries are kept. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// useSearchParams() bails out of prerendering, which fails `next build` unless a
// Suspense boundary sits above the component that reads it.
export default function TasksPage() {
  return (
    <React.Suspense fallback={<PageLoader message="Loading tasks..." />}>
      <TasksPageContent />
    </React.Suspense>
  );
}
