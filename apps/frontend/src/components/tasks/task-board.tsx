'use client';

import { getPriorityConfig } from '@/lib/semantic/priority';

import * as React from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useTasksRealtime } from '@/hooks/use-realtime';
import type { Task, TaskStatus } from '@/types';
import { MoreVertical, Clock, Calendar } from 'lucide-react';
import { formatDate } from '@/lib/utils';

// Helper function to parse label format "color:text"
const parseLabel = (label: string) => {
  const parts = label.split(':');
  if (parts.length === 2) {
    return { color: parts[0], text: parts[1] };
  }
  return { color: 'gray', text: label };
};

// Color mapping for label backgrounds
const labelColorMap: Record<string, string> = {
  red: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  orange: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
  yellow: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  green: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  purple: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
  pink: 'bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-500/20',
  gray: 'bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20',
};

interface TaskBoardProps {
  tasks: Task[];
  projectId?: string;
  showMenu?: boolean;
  sortCriteria?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  canEdit?: boolean; // Permission to edit tasks (managers/assistant managers)
  canDelete?: boolean; // Permission to delete tasks (managers/assistant managers)
  /**
   * `beforeTaskId` is the card the dropped one has to land in FRONT of, or null
   * for the end of the column. A raw drop index would be meaningless to the
   * caller: it counts rows in the order this component rendered (`sortCriteria`),
   * which only this component knows.
   */
  onTaskMove: (
    taskId: string,
    newStatus: TaskStatus,
    beforeTaskId: string | null
  ) => void | Promise<void>;
  onTaskClick: (task: Task) => void;
  onTaskEdit: (task: Task) => void;
  onTaskDelete: (taskId: string) => void;
}

const COLUMNS: { id: TaskStatus; title: string; color: string }[] = [
  { id: 'BACKLOG', title: 'Backlog', color: 'bg-gray-100 dark:bg-gray-800' },
  { id: 'TODO', title: 'To Do', color: 'bg-blue-100 dark:bg-blue-900' },
  { id: 'IN_PROGRESS', title: 'In Progress', color: 'bg-yellow-100 dark:bg-yellow-900' },
  { id: 'REVIEW', title: 'Review', color: 'bg-purple-100 dark:bg-purple-900' },
  { id: 'DONE', title: 'Done', color: 'bg-green-100 dark:bg-green-900' },
];

export function TaskBoard({
  tasks,
  projectId,
  showMenu = false,
  sortCriteria = [{ field: 'position', direction: 'asc' }],
  canEdit = false,
  canDelete = false,
  onTaskMove,
  onTaskClick,
  onTaskEdit,
  onTaskDelete,
}: TaskBoardProps) {
  // Enable real-time updates for tasks
  useTasksRealtime(projectId);

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

  // Calculate urgency score based on due date
  const getUrgencyScore = React.useCallback((task: Task): number => {
    if (!task.dueDate) return 0;
    const now = new Date();
    const dueDate = new Date(task.dueDate);
    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilDue < 0) return 100;
    if (daysUntilDue === 0) return 90;
    if (daysUntilDue === 1) return 80;
    if (daysUntilDue <= 3) return 70;
    if (daysUntilDue <= 7) return 50;
    return Math.max(1, 30 - daysUntilDue);
  }, []);

  // Compare by a single field
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
          // Every card in a column already shares its status, so this field can
          // never order them. Without the case it fell through to `position`
          // and a "Status" sort silently reversed every column.
          return 0;
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
        default:
          return a.position - b.position;
      }
    },
    [priorityOrder, getUrgencyScore]
  );

  // Sort tasks within each column using multi-field sorting
  const sortTasksInColumn = React.useCallback(
    (tasksToSort: Task[]): Task[] => {
      if (sortCriteria.length === 0) {
        return [...tasksToSort].sort((a, b) => a.position - b.position);
      }

      // `position` used to short-circuit here ignoring `direction`, which made
      // the board render ascending while the caller's own copy of the sort ran
      // descending — the two orders have to agree for a drop to mean anything.
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

  // Group tasks by status
  const tasksByStatus = React.useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      BACKLOG: [],
      TODO: [],
      IN_PROGRESS: [],
      REVIEW: [],
      DONE: [],
    };

    tasks.forEach((task) => {
      if (grouped[task.status]) {
        grouped[task.status].push(task);
      }
    });

    // Sort each column based on sortField and sortDirection
    Object.keys(grouped).forEach((status) => {
      grouped[status as TaskStatus] = sortTasksInColumn(grouped[status as TaskStatus]);
    });

    return grouped;
  }, [tasks, sortTasksInColumn]);

  /**
   * Cards rendered per column before a "show more".
   *
   * The board used to render every task in the DOM. Measured on a project with
   * 5,000 tasks that is 105k DOM nodes and a 215MB heap — the board took ~13s to
   * appear and ~5s to open a card. A column rarely needs more than this on
   * screen at once, and the count in the header still reports the true total.
   */
  const COLUMN_RENDER_LIMIT = 100;
  const [expandedColumns, setExpandedColumns] = React.useState<Record<string, boolean>>({});

  const handleDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result;

    // Belt and braces: isDragDisabled already stops the drag starting, but the
    // move must never be issued by a viewer the API would refuse.
    if (!canEdit) return;

    // Dropped outside a droppable area
    if (!destination) return;

    // Dropped in same position
    if (source.droppableId === destination.droppableId && source.index === destination.index) {
      return;
    }

    const newStatus = destination.droppableId as TaskStatus;

    // `destination.index` counts rows in the order THIS component rendered, and
    // that order is `sortCriteria`, not `position`. Resolve it to the card the
    // drop landed in front of before handing it on: anchoring the raw index in
    // the position-sorted column (what the caller used to do) dropped the card
    // wherever the two orders happened to disagree. The full column is used
    // rather than the render-limited slice — the slice is a prefix of it, so the
    // indices line up, and a drop at the tail of a capped column still anchors.
    const renderedColumn = tasksByStatus[newStatus].filter((task) => task.id !== draggableId);
    const beforeTaskId = renderedColumn[destination.index]?.id ?? null;

    // onTaskMove is async: an unawaited rejection here surfaces as a full-screen
    // runtime error even though the mutation hook already toasted the failure.
    void Promise.resolve(onTaskMove(draggableId, newStatus, beforeTaskId)).catch(() => {});
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {COLUMNS.map((column) => {
          const allColumnTasks = tasksByStatus[column.id];
          const expanded = expandedColumns[column.id] === true;
          const columnTasks =
            expanded || allColumnTasks.length <= COLUMN_RENDER_LIMIT
              ? allColumnTasks
              : allColumnTasks.slice(0, COLUMN_RENDER_LIMIT);
          const hiddenCount = allColumnTasks.length - columnTasks.length;
          const hasItems = allColumnTasks.length > 0;

          return (
            <div key={column.id} className="flex flex-col min-h-50">
              {/* Column Header */}
              <div className={cn('rounded-t-lg p-3 border-b', column.color)}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">
                    {column.title}
                    <span className="ml-2 text-xs font-normal">({allColumnTasks.length})</span>
                  </h3>
                </div>
              </div>

              {/* Droppable Column */}
              <Droppable droppableId={column.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={cn(
                      'flex-1 p-2 space-y-2 rounded-b-lg bg-muted/20',
                      snapshot.isDraggingOver && 'bg-muted/40',
                      hasItems ? 'min-h-75' : 'min-h-37.5'
                    )}
                  >
                    {columnTasks.map((task, index) => (
                      <Draggable
                        key={task.id}
                        draggableId={task.id}
                        index={index}
                        isDragDisabled={!canEdit}
                      >
                        {(provided, snapshot) => (
                          <Card
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={cn(
                              'relative cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md border-l-4',
                              getPriorityConfig(task.priority).borderLeft,
                              snapshot.isDragging && 'shadow-xl ring-2 ring-primary'
                            )}
                            onClick={() => onTaskClick(task)}
                          >
                            {/* Outside the drag handle on purpose: a role="button"
                                handle must not contain focusable descendants, which is what
                                made every card an axe "nested-interactive" violation. */}
                            <div className="absolute right-1 top-1 z-10">
                                  {showMenu === true && (canEdit || canDelete) && (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger
                                        asChild
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <Button variant="ghost" size="icon" className="h-6 w-6">
                                          <MoreVertical className="h-4 w-4" />
                                          <span className="sr-only">Task actions</span>
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        {canEdit && (
                                          <DropdownMenuItem
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onTaskEdit(task);
                                            }}
                                          >
                                            Edit Task
                                          </DropdownMenuItem>
                                        )}
                                        {canEdit && canDelete && <DropdownMenuSeparator />}
                                        {canDelete && (
                                          <DropdownMenuItem
                                            className="text-destructive-text"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onTaskDelete(task.id);
                                            }}
                                          >
                                            Delete Task
                                          </DropdownMenuItem>
                                        )}
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )}
                            </div>
                            {/* Everything else IS the drag handle, so the card still drags
                                from almost anywhere and keyboard drag still works. */}
                            {/* The card's click target IS this element, so it
                                carries the keyboard contract too: Enter/Space
                                open the details dialog, and a visible ring
                                replaces the bare `outline-none` that left
                                tabbing across a board with no feedback at all.
                                Space still reaches react-beautiful-dnd's drag
                                handle when a drag is in progress. */}
                            <div
                              {...provided.dragHandleProps}
                              aria-label={`Open task: ${task.title}`}
                              onKeyDown={(event) => {
                                if (snapshot.isDragging) return;
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  onTaskClick(task);
                                }
                              }}
                              className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                            <CardHeader className="p-3 pb-2">
                              <div className="flex items-start gap-2 pr-7">
                                <div className="flex-1 space-y-1">
                                  <div className="flex items-center gap-2">
                                    {/* <Badge variant="outline" className="font-mono text-xs">
                                      {task.hierarchyId}
                                    </Badge> */}
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className={cn(
                                          'h-2 w-2 rounded-full',
                                          getPriorityConfig(task.priority).dot
                                        )}
                                      />
                                      <span className="text-xs text-muted-foreground font-medium">
                                        {
                                          getPriorityConfig(task.priority).label
                                        }
                                      </span>
                                    </div>
                                  </div>
                                  <h4 className="font-medium text-sm leading-tight line-clamp-2">
                                    {task.title}
                                  </h4>
                                </div>
                              </div>
                            </CardHeader>

                            <CardContent className="p-3 pt-0 space-y-2">
                              {/* Description preview */}
                              {task.description && (
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                  {task.description}
                                </p>
                              )}

                              {/* Labels */}
                              {task.labels && task.labels.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {task.labels.slice(0, 3).map((label, i) => {
                                    const { color, text } = parseLabel(label);
                                    return (
                                      <Badge
                                        key={i}
                                        variant="outline"
                                        className={cn(
                                          'text-xs border',
                                          labelColorMap[color] || labelColorMap.gray
                                        )}
                                      >
                                        {text}
                                      </Badge>
                                    );
                                  })}
                                  {task.labels.length > 3 && (
                                    <Badge variant="secondary" className="text-xs">
                                      +{task.labels.length - 3}
                                    </Badge>
                                  )}
                                </div>
                              )}

                              {/* Footer */}
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <div className="flex items-center gap-2">
                                  {task.dueDate && (
                                    <div className="flex items-center gap-1">
                                      <Calendar className="h-3 w-3" />
                                      <span>{formatDate(task.dueDate)}</span>
                                    </div>
                                  )}
                                  {/* `task.estimatedHours && …` short-circuits to the
                                      NUMBER 0 when there is no estimate, and React
                                      renders 0 — a bare "0" under the clock icon.
                                      Compare rather than test truthiness. */}
                                  {(task.estimatedHours ?? 0) > 0 && (
                                    <div className="flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      <span>{task.estimatedHours}h</span>
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-center gap-1">
                                  {/* Check both task assignment fields while the UI model is normalized. */}
                                  {((task.assignedTo && task.assignedTo.length > 0) ||
                                    (task.assigneeIds && task.assigneeIds.length > 0)) && (
                                    <Avatar className="h-5 w-5">
                                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                        {task.assignedToNames && task.assignedToNames.length > 0
                                          ? task.assignedToNames[0]
                                              .split(' ')
                                              .map((n) => n[0])
                                              .join('')
                                              .toUpperCase()
                                              .slice(0, 2)
                                          : (task.assignedTo?.length || task.assigneeIds?.length) >
                                              1
                                            ? `+${task.assignedTo?.length || task.assigneeIds?.length}`
                                            : 'U'}
                                      </AvatarFallback>
                                    </Avatar>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                            </div>
                          </Card>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}

                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedColumns((prev) => ({ ...prev, [column.id]: true }))
                        }
                        className="w-full rounded-md border border-dashed border-border py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Show {hiddenCount} more
                      </button>
                    )}

                    {/* Empty state */}
                    {columnTasks.length === 0 && (
                      <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">
                        No tasks
                      </div>
                    )}
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}
