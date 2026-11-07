'use client';

import { getPriorityConfig } from '@/lib/semantic/priority';

import * as React from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { MoreVertical, Clock } from 'lucide-react';
import { sortTasks } from '@/lib/task-sort';
import { TASK_STATUSES } from '@/lib/semantic/status';
import {
  BoardColumnHeader,
  CardAssignees,
  TaskDueDate,
  labelColorClass,
  labelText,
} from '@/components/tasks/task-display';

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
  /**
   * Whether this person signs work off (the Done transition, and reopening).
   * `false` closes the Done column to their drops and keeps finished cards
   * where they are; `undefined` (not known yet) blocks nothing.
   */
  canComplete?: boolean;
}

// The columns, in workflow order; their names and colours are the status's own
// (lib/semantic/status.ts), the same as on the sprint board.
const COLUMNS = TASK_STATUSES as TaskStatus[];

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
  canComplete,
}: TaskBoardProps) {
  const signOffOnly = canComplete === false;
  // Enable real-time updates for tasks
  useTasksRealtime(projectId);

  // Within each column, in the page's order (lib/task-sort.ts — the one sort
  // both use); with no criteria, the hand-made order.
  const sortTasksInColumn = React.useCallback(
    (tasksToSort: Task[]): Task[] =>
      sortCriteria.length === 0
        ? [...tasksToSort].sort((a, b) => a.position - b.position)
        : sortTasks(tasksToSort, sortCriteria),
    [sortCriteria]
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
        {COLUMNS.map((columnId) => {
          const allColumnTasks = tasksByStatus[columnId];
          const expanded = expandedColumns[columnId] === true;
          const columnTasks =
            expanded || allColumnTasks.length <= COLUMN_RENDER_LIMIT
              ? allColumnTasks
              : allColumnTasks.slice(0, COLUMN_RENDER_LIMIT);
          const hiddenCount = allColumnTasks.length - columnTasks.length;
          const hasItems = allColumnTasks.length > 0;

          return (
            <div key={columnId} className="flex flex-col min-h-50">
              <BoardColumnHeader
                status={columnId}
                count={allColumnTasks.length}
                hint={
                  columnId === 'DONE' && signOffOnly && canEdit
                    ? 'Signed off by a manager'
                    : undefined
                }
              />

              {/* Droppable Column. Done takes no drop from somebody who cannot
                  sign work off: the card moved, the server refused, and it
                  snapped back with an error. */}
              <Droppable droppableId={columnId} isDropDisabled={columnId === 'DONE' && signOffOnly}>
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
                        isDragDisabled={!canEdit || (signOffOnly && task.status === 'DONE')}
                      >
                        {(provided, snapshot) => (
                          <Card
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={cn(
                              'relative cursor-pointer hover-lift border-l-4',
                              getPriorityConfig(task.priority).borderLeft,
                              snapshot.isDragging && 'shadow-xl ring-2 ring-primary'
                            )}
                            onClick={() => onTaskClick(task)}
                          >
                            {/* Outside the drag handle on purpose: a role="button"
                                handle must not contain focusable descendants, which is what
                                made every card an axe "nested-interactive" violation. */}
                            {/* Clicks in the menu stay in it: React carries a
                                portalled menu's events up through this tree, so a
                                click on its padding opened the task behind it. */}
                            <div className="absolute right-1 top-1 z-10" onClick={(e) => e.stopPropagation()}>
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
                              // With dragging off the library hands back no
                              // handle props, and the card lost its tab stop and
                              // role with them: nobody who may not drag could
                              // open a task from the keyboard.
                              {...(provided.dragHandleProps ?? { role: 'button', tabIndex: 0 })}
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
                                {/* min-w-0 + a wrapping row: a long hierarchy id
                                    (ECOM-CUS-CHE-CAR-04-…) used to push this row past
                                    the pr-7 kept clear for the ⋮ button, so the
                                    priority was crushed to "Critic / al" UNDER the
                                    button. The priority now drops to its own line
                                    instead, whole. */}
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    {/* The id commits name a task by ("Fixes ECOM-T04"),
                                        so it has to be readable off the card. */}
                                    <span
                                      className="max-w-full truncate font-mono text-[11px] text-muted-foreground"
                                      title={task.hierarchyId}
                                    >
                                      {task.hierarchyId}
                                    </span>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                      <span
                                        className={cn(
                                          'h-2 w-2 rounded-full',
                                          getPriorityConfig(task.priority).dot
                                        )}
                                      />
                                      <span className="whitespace-nowrap text-xs text-muted-foreground font-medium">
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
                                  {task.labels.slice(0, 3).map((label, i) => (
                                    <Badge
                                      key={i}
                                      variant="outline"
                                      className={cn(
                                        'text-xs border whitespace-normal',
                                        labelColorClass(label)
                                      )}
                                    >
                                      {labelText(label)}
                                    </Badge>
                                  ))}
                                  {task.labels.length > 3 && (
                                    // "+2" on its own withholds the very thing it is
                                    // counting. The remaining labels are already in
                                    // hand, so they go in the title and the
                                    // accessible name.
                                    <Badge
                                      variant="secondary"
                                      className="text-xs"
                                      title={task.labels.slice(3).map(labelText).join(', ')}
                                      aria-label={`${task.labels.length - 3} more: ${task.labels
                                        .slice(3)
                                        .map(labelText)
                                        .join(', ')}`}
                                    >
                                      +{task.labels.length - 3}
                                    </Badge>
                                  )}
                                </div>
                              )}

                              {/* Footer: due, then who — the order the sprint board
                                  draws a card in too. */}
                              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                {/* Wraps as whole items: when the due label is long the
                                    estimate moves under it rather than being folded
                                    into "4 / h" beside it. */}
                                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <TaskDueDate task={task} />
                                  {/* `task.estimatedHours && …` short-circuits to the
                                      NUMBER 0 when there is no estimate, and React
                                      renders 0 — a bare "0" under the clock icon.
                                      Compare rather than test truthiness. */}
                                  {(task.estimatedHours ?? 0) > 0 && (
                                    <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                                      <Clock className="h-3 w-3" />
                                      <span>{task.estimatedHours}h</span>
                                    </div>
                                  )}
                                </div>

                                <CardAssignees task={task} />
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
                          setExpandedColumns((prev) => ({ ...prev, [columnId]: true }))
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
