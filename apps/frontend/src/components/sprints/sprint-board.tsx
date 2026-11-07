'use client';

import { getPriorityConfig } from '@/lib/semantic/priority';

import * as React from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useUpdateTask } from '@/hooks/use-task';
import {
  useFunctionalRequirement,
  useUpdateFunctionalRequirement,
} from '@/hooks/use-functional-requirement';
import { useHasPermission, useHasPermissionResolved } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import type { Task, TaskStatus, FunctionalRequirement, FunctionalRequirementStatus } from '@/types';
import { cn } from '@/lib/utils';
import { Link2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { TASK_STATUSES } from '@/lib/semantic/status';
import { compareTasks, positionBefore } from '@/lib/task-sort';
import {
  BoardColumnHeader,
  CardAssignees,
  TaskDueDate,
  labelColorClass,
  labelText,
} from '@/components/tasks/task-display';

interface SprintBoardProps {
  tasks: Task[];
  /** The sprint is running or closed: planned work has left Backlog. */
  started?: boolean;
  frs?: FunctionalRequirement[];
  /** Open a task. Without it the cards could be dragged and nothing else: there
   *  was no way from the sprint board to read a task, comment on it or log time. */
  onTaskClick?: (task: Task) => void;
  /** Nothing can be moved — the board of a sprint that has been completed. */
  readOnly?: boolean;
}

type BoardItem = { type: 'TASK'; data: Task } | { type: 'FR'; data: FunctionalRequirement };

const getBoardStatusForFR = (status: FunctionalRequirementStatus): TaskStatus => {
  switch (status) {
    case 'IMPLEMENTED':
      return 'IN_PROGRESS';
    case 'TESTED':
      return 'REVIEW';
    case 'DEPLOYED':
      return 'DONE';
    default:
      return 'TODO';
  }
};

/**
 * Map a board column back to an FR status. DRAFT, REVIEW and APPROVED all render
 * in the same TODO column, so keep the FR's current status whenever the column
 * is unchanged — otherwise reordering a DRAFT FR inside TODO silently promotes
 * it to APPROVED with no undo.
 */
const getFRStatusForBoard = (
  status: TaskStatus,
  current: FunctionalRequirementStatus
): FunctionalRequirementStatus => {
  if (getBoardStatusForFR(current) === status) return current;
  switch (status) {
    case 'TODO':
      return 'APPROVED';
    case 'IN_PROGRESS':
      return 'IMPLEMENTED';
    case 'REVIEW':
      return 'TESTED';
    case 'DONE':
      return 'DEPLOYED';
    default:
      return 'APPROVED';
  }
};

// BACKLOG must be here: tasks auto-created when an FR joins a sprint start in
// BACKLOG and are only promoted to TODO when the sprint starts. Without this
// column they match no bucket and a PLANNING sprint's board renders empty.
// Names and colours are the status's own (lib/semantic/status.ts), the same as
// on the tasks board — the two used to disagree about both.
const COLUMNS = TASK_STATUSES as TaskStatus[];

// ✅ Component to display FR badge for tasks linked to FRs
function TaskFRBadge({ functionalRequirementId }: { functionalRequirementId?: string }) {
  const { data: fr } = useFunctionalRequirement(functionalRequirementId);

  if (!functionalRequirementId || !fr) return null;

  return (
    <Badge
      variant="secondary"
      className="text-2xs px-1.5 py-0 gap-1 bg-blue-100 dark:bg-blue-950 text-info-text"
    >
      <FileText className="h-2.5 w-2.5" />
      {fr.hierarchyId}
    </Badge>
  );
}

export function SprintBoard({
  tasks,
  frs = [],
  onTaskClick,
  readOnly = false,
  started = false,
}: SprintBoardProps) {
  // The API moves a task for `task:update` and a requirement card for
  // `requirement:write`. Every card used to be draggable by everybody: a
  // read-only member's drop moved, was refused, and snapped back.
  const canMoveTasks = useHasPermission(Permission.EDIT_ANY_TASK);
  const canMoveRequirements = useHasPermission(Permission.EDIT_FUNCTIONAL_REQUIREMENT);
  const updateTask = useUpdateTask();
  const updateFR = useUpdateFunctionalRequirement();
  // Tri-state: `undefined` while the membership request is in flight, so a
  // drop onto Done on first paint is not refused for an unresolved answer.
  const doneGate = useHasPermissionResolved(Permission.COMPLETE_TASK);
  const canMarkDone = doneGate.isLoading ? undefined : doneGate.allowed;
  // What is being dragged right now, so Done can refuse a task card from
  // somebody who does not sign work off while still taking a requirement card.
  const [dragging, setDragging] = React.useState<'TASK' | 'FR' | null>(null);
  const nobodyDrops = readOnly || (!canMoveTasks && !canMoveRequirements);

  const [localItems, setLocalItems] = React.useState<BoardItem[]>([]);

  React.useEffect(() => {
    const taskItems: BoardItem[] = tasks.map((t) => ({ type: 'TASK', data: t }));
    const frItems: BoardItem[] = frs.map((f) => ({ type: 'FR', data: f }));
    setLocalItems([...taskItems, ...frItems]);
  }, [tasks, frs]);

  // Tasks in their stored order (ties as the tasks board breaks them), then the
  // requirement cards. The comparator used to call a task and a requirement
  // equal while ordering tasks among themselves, which is no order at all —
  // where a requirement card landed was up to the sort's internals.
  const getItemsByColumn = (columnId: TaskStatus): BoardItem[] => {
    const tasksHere = localItems
      .filter((item): item is Extract<BoardItem, { type: 'TASK' }> =>
        item.type === 'TASK' && item.data.status === columnId
      )
      .sort((a, b) => compareTasks(a.data, b.data, 'position'));
    const requirementsHere = localItems.filter(
      (item) => item.type === 'FR' && getBoardStatusForFR(item.data.status) === columnId
    );
    return [...tasksHere, ...requirementsHere];
  };

  const handleDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result;

    if (!destination) return;

    if (source.droppableId === destination.droppableId && source.index === destination.index) {
      return;
    }

    const item = localItems.find((i) => i.data.id === draggableId);
    if (!item) return;

    const newStatus = destination.droppableId as TaskStatus;
    // The Backlog column exists for TASKS (an FR joining a PLANNING sprint
    // auto-creates one there). FRs have no backlog state: `getBoardStatusForFR`
    // never returns BACKLOG, so the "column unchanged" short-circuit below
    // cannot fire and the `default` arm would silently mark a DRAFT FR APPROVED
    // — then re-bucket the card back into To Do and toast "moved to approved"
    // for a drop the user made on Backlog. Refuse the drop instead.
    if (item.type === 'FR' && newStatus === 'BACKLOG') {
      toast.info('Functional requirements have no backlog state.');
      return;
    }

    const nextFRStatus =
      item.type === 'FR' ? getFRStatusForBoard(newStatus, item.data.status) : null;

    // Where a task card lands: in front of the first task card below the drop
    // (requirement cards hold no position), or at the bottom. The index dnd
    // reports is into the column with the dragged card already taken out.
    //
    // Named by that card, not by number. This used to save the card's RANK among
    // this sprint's cards as its `position` — but positions count across the
    // whole project (a new task is numbered past every other), so "3rd here"
    // was written over numbers in the hundreds and the card jumped to wherever
    // 3 fell project-wide. The API places it between its new neighbours as they
    // are stored; `position` below only shows the drop until it answers.
    const rest = getItemsByColumn(newStatus).filter((i) => i.data.id !== draggableId);
    const below = rest.slice(destination.index).find((i) => i.type === 'TASK');
    const placeBefore = below ? below.data.id : '';
    const position = positionBefore(
      rest.filter((i) => i.type === 'TASK').map((i) => i.data as Task),
      placeBefore
    );
    const sameColumn = source.droppableId === destination.droppableId;

    // Optimistic update
    const updatedItems = localItems.map((i) => {
      if (i.data.id === draggableId) {
        if (i.type === 'TASK') {
          return { ...i, data: { ...i.data, status: newStatus, position } };
        } else {
          return { ...i, data: { ...i.data, status: nextFRStatus! } };
        }
      }
      return i;
    });
    setLocalItems(updatedItems);

    // Update in database
    try {
      if (item.type === 'TASK') {
        await updateTask.mutateAsync({
          taskId: item.data.id,
          projectId: item.data.projectId,
          // No status for a reorder within a column: nothing about the task
          // changed but where it sits, so the server neither re-checks the
          // move nor records it in the activity trail.
          updates: sameColumn
            ? { position, placeBefore }
            : { status: newStatus, position, placeBefore },
          canMarkDone,
        });
      } else {
        await updateFR.mutateAsync({
          requirementId: item.data.id,
          projectId: item.data.projectId,
          updates: { status: nextFRStatus! },
        });
        // useUpdateFunctionalRequirement deliberately emits no generic success
        // toast (it stacked one per caller), and the TASK branch above still
        // gets one from useUpdateTask — so confirm the FR move here or the two
        // halves of the same drag behave differently.
        toast.success(`${item.data.hierarchyId} moved to ${nextFRStatus!.toLowerCase()}`);
      }
    } catch (error) {
      setLocalItems(localItems); // Revert
    }
  };

  return (
    <DragDropContext
      onDragStart={(start) =>
        setDragging(localItems.find((i) => i.data.id === start.draggableId)?.type ?? null)
      }
      onDragEnd={(result) => {
        setDragging(null);
        return handleDragEnd(result);
      }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {COLUMNS.filter(
          // Planned work waits in Backlog until the sprint starts, when the API
          // moves it to To Do. Once it has started the column is empty for good —
          // shown only if somebody has parked something there.
          (columnId) => columnId !== 'BACKLOG' || !started || getItemsByColumn('BACKLOG').length > 0
        ).map((columnId) => {
          const columnItems = getItemsByColumn(columnId);

          return (
            <div key={columnId} className="flex flex-col">
              <BoardColumnHeader
                status={columnId}
                count={columnItems.length}
                // Done takes no task card from somebody who does not sign work
                // off, so a drag there just snapped back with nothing said. The
                // tasks board has always said why; the same words, the same rule.
                hint={
                  columnId === 'DONE' && canMarkDone === false && canMoveTasks && !readOnly
                    ? 'Signed off by a manager'
                    : undefined
                }
              />

              <Droppable
                droppableId={columnId}
                isDropDisabled={columnId === 'DONE' && dragging === 'TASK' && canMarkDone === false}
              >
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={cn(
                      // Tall columns are for a desk: stacked on a phone, five of
                      // them at 500px each made the board two and a half screens.
                      'flex-1 p-2 space-y-2 rounded-b-lg border border-t-0 min-h-32 md:min-h-[500px] transition-colors',
                      snapshot.isDraggingOver ? 'bg-accent/50 border-primary' : 'bg-background'
                    )}
                  >
                    {columnItems.map((item, index) => {
                      const isTask = item.type === 'TASK';
                      const data = item.data;
                      // Only task cards open: a requirement card is a placeholder
                      // for work that has no task yet.
                      const open =
                        isTask && onTaskClick ? () => onTaskClick(data as Task) : undefined;

                      return (
                        <Draggable
                          key={data.id}
                          draggableId={data.id}
                          index={index}
                          isDragDisabled={
                            readOnly ||
                            (isTask
                              ? !canMoveTasks ||
                                (canMarkDone === false && (data as Task).status === 'DONE')
                              : !canMoveRequirements)
                          }
                        >
                          {(provided, snapshot) => (
                            <Card
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              // No handle props when dragging is off — and with
                              // them went the card's tab stop: a read-only board
                              // could not be opened from the keyboard.
                              {...(provided.dragHandleProps ??
                                (open ? { role: 'button', tabIndex: 0 } : {}))}
                              // The library swallows the click that ends a drag, so
                              // this only fires for a real click. Enter is the
                              // keyboard path; Space stays the drag handle's.
                              onClick={open}
                              onKeyDown={(event) => {
                                if (!open || snapshot.isDragging || event.key !== 'Enter') return;
                                event.preventDefault();
                                open();
                              }}
                              aria-label={open ? `Open task: ${data.title}` : undefined}
                              className={cn(
                                'active:cursor-grabbing transition-all',
                                open ? 'cursor-pointer' : 'cursor-grab',
                                'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                                snapshot.isDragging && 'shadow-lg ring-2 ring-primary rotate-2',
                                // A task wears its priority down its left edge, as
                                // on the tasks board; a requirement card is told
                                // apart by its own border instead.
                                isTask
                                  ? cn('border-l-4', getPriorityConfig(data.priority).borderLeft)
                                  : 'border-info/30'
                              )}
                            >
                              {/* The order the tasks board draws a card in: id and
                                  priority, title, description, labels, then due and
                                  who. It led with the requirement badge, showed no id
                                  at all, and priority as a bare dot. */}
                              <CardContent className="p-3 space-y-2">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span
                                    className="max-w-full truncate font-mono text-[11px] text-muted-foreground"
                                    title={data.hierarchyId}
                                  >
                                    {data.hierarchyId}
                                  </span>
                                  {data.priority && (
                                    <span className="flex shrink-0 items-center gap-1.5">
                                      <span
                                        className={cn(
                                          'h-2 w-2 rounded-full',
                                          getPriorityConfig(data.priority).dot
                                        )}
                                      />
                                      <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
                                        {getPriorityConfig(data.priority).label}
                                      </span>
                                    </span>
                                  )}
                                  {isTask ? (
                                    <TaskFRBadge
                                      functionalRequirementId={(data as Task).functionalRequirementId}
                                    />
                                  ) : (
                                    <Badge
                                      variant="secondary"
                                      className="text-2xs bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200"
                                    >
                                      FR
                                    </Badge>
                                  )}
                                </div>
                                <h4 className="text-sm font-medium line-clamp-2 leading-tight">
                                  {data.title}
                                </h4>
                                {data.description && (
                                  <p className="text-xs text-muted-foreground line-clamp-2">
                                    {data.description}
                                  </p>
                                )}
                                {isTask && (data as Task).labels?.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {(data as Task).labels.slice(0, 2).map((label, idx) => (
                                      <Badge
                                        key={idx}
                                        variant="outline"
                                        className={cn(
                                          'text-2xs px-1 py-0 border whitespace-normal',
                                          labelColorClass(label)
                                        )}
                                      >
                                        {labelText(label)}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                  <div className="flex min-w-0 flex-wrap items-center gap-3">
                                    {isTask && <TaskDueDate task={data as Task} />}

                                    {/* -700/-400 below rather than a bare -500: the row
                                        colours the dependency COUNT as well as the icon, and
                                        orange-500 measured 2.89:1 on the light card, under
                                        the 4.5:1 floor for small text. */}
                                    {isTask &&
                                      ((data as Task).blockedBy?.length > 0 ||
                                        (data as Task).blocks?.length > 0) && (
                                        <div className="flex items-center gap-1 text-warning-text">
                                          <Link2 className="h-3 w-3" />
                                          <span>
                                            {((data as Task).blockedBy?.length || 0) +
                                              ((data as Task).blocks?.length || 0)}
                                          </span>
                                        </div>
                                      )}
                                  </div>
                                  <CardAssignees task={data} />
                                </div>
                              </CardContent>
                            </Card>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}

                    {columnItems.length === 0 && (
                      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                        {nobodyDrops ? 'Nothing here' : 'Drop items here'}
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
