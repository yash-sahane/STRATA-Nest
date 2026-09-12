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
import { useHasPermissionResolved } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import type { Task, TaskStatus, FunctionalRequirement, FunctionalRequirementStatus } from '@/types';
import { cn } from '@/lib/utils';
import { User, Calendar, Link2, FileText } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

interface SprintBoardProps {
  tasks: Task[];
  frs?: FunctionalRequirement[];
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
const COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'BACKLOG', label: 'Backlog', color: 'bg-gray-100 dark:bg-gray-800' },
  { id: 'TODO', label: 'To Do', color: 'bg-slate-100 dark:bg-slate-900' },
  { id: 'IN_PROGRESS', label: 'In Progress', color: 'bg-blue-50 dark:bg-blue-950' },
  { id: 'REVIEW', label: 'Review', color: 'bg-purple-50 dark:bg-purple-950' },
  { id: 'DONE', label: 'Done', color: 'bg-green-50 dark:bg-green-950' },
];

// ✅ Component to display FR badge for tasks linked to FRs
function TaskFRBadge({ functionalRequirementId }: { functionalRequirementId?: string }) {
  const { data: fr } = useFunctionalRequirement(functionalRequirementId);

  if (!functionalRequirementId || !fr) return null;

  return (
    <Badge
      variant="secondary"
      className="text-[10px] px-1.5 py-0 gap-1 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
    >
      <FileText className="h-2.5 w-2.5" />
      {fr.hierarchyId}
    </Badge>
  );
}

export function SprintBoard({ tasks, frs = [] }: SprintBoardProps) {
  const updateTask = useUpdateTask();
  const updateFR = useUpdateFunctionalRequirement();
  // Tri-state: `undefined` while the membership request is in flight, so a
  // drop onto Done on first paint is not refused for an unresolved answer.
  const doneGate = useHasPermissionResolved(Permission.EDIT_ANY_TASK);
  const canMarkDone = doneGate.isLoading ? undefined : doneGate.allowed;

  const [localItems, setLocalItems] = React.useState<BoardItem[]>([]);

  React.useEffect(() => {
    const taskItems: BoardItem[] = tasks.map((t) => ({ type: 'TASK', data: t }));
    const frItems: BoardItem[] = frs.map((f) => ({ type: 'FR', data: f }));
    setLocalItems([...taskItems, ...frItems]);
  }, [tasks, frs]);

  const getItemsByColumn = (columnId: TaskStatus) => {
    return localItems
      .filter((item) => {
        if (item.type === 'TASK') return item.data.status === columnId;
        if (item.type === 'FR') return getBoardStatusForFR(item.data.status) === columnId;
        return false;
      })
      .sort((a, b) => {
        if (a.type === 'TASK' && b.type === 'TASK') {
          return (a.data.position || 0) - (b.data.position || 0);
        }
        return 0;
      });
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

    // Optimistic update
    const updatedItems = localItems.map((i) => {
      if (i.data.id === draggableId) {
        if (i.type === 'TASK') {
          return { ...i, data: { ...i.data, status: newStatus } };
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
        // `destination.index` counts FR cards too. `position` orders TASKS, so
        // convert to the rank among tasks only before persisting it.
        //
        // The index dnd reports is into the list AFTER the dragged card is
        // removed, so the slice has to be taken from a list with it already
        // removed. Slicing the pre-drag list and subtracting the dragged card
        // afterwards was one short for every downward move within a column
        // (drag T1 past T2: index 2, slice [T1,T2], minus T1 => position 1,
        // tying with T2 instead of landing after it).
        const rest = getItemsByColumn(newStatus).filter((i) => i.data.id !== draggableId);
        const taskPosition = rest
          .slice(0, destination.index)
          .filter((i) => i.type === 'TASK').length;

        await updateTask.mutateAsync({
          taskId: item.data.id,
          projectId: item.data.projectId,
          updates: { status: newStatus, position: taskPosition },
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
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {COLUMNS.map((column) => {
          const columnItems = getItemsByColumn(column.id);

          return (
            <div key={column.id} className="flex flex-col">
              <div className={cn('p-4 rounded-t-lg border-t-4', column.color)}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm">{column.label}</h3>
                  <Badge variant="secondary" className="text-xs">
                    {columnItems.length}
                  </Badge>
                </div>
              </div>

              <Droppable droppableId={column.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={cn(
                      'flex-1 p-2 space-y-2 rounded-b-lg border border-t-0 min-h-[500px] transition-colors',
                      snapshot.isDraggingOver ? 'bg-accent/50 border-primary' : 'bg-background'
                    )}
                  >
                    {columnItems.map((item, index) => {
                      const isTask = item.type === 'TASK';
                      const data = item.data;

                      return (
                        <Draggable key={data.id} draggableId={data.id} index={index}>
                          {(provided, snapshot) => (
                            <Card
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={cn(
                                'cursor-grab active:cursor-grabbing transition-all',
                                snapshot.isDragging && 'shadow-lg ring-2 ring-primary rotate-2',
                                !isTask && 'border-blue-200 dark:border-blue-800' // Highlight FRs
                              )}
                            >
                              <CardContent className="p-3 space-y-2">
                                {/* Type Badge and Priority */}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5">
                                    {isTask && (
                                      <TaskFRBadge
                                        functionalRequirementId={
                                          (data as Task).functionalRequirementId
                                        }
                                      />
                                    )}
                                    {!isTask && (
                                      <Badge
                                        variant="secondary"
                                        className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200"
                                      >
                                        FR
                                      </Badge>
                                    )}
                                  </div>
                                  {data.priority && (
                                    <div
                                      className={cn(
                                        'w-2 h-2 rounded-full',
                                        getPriorityConfig(data.priority).dot
                                      )}
                                    />
                                  )}
                                </div>
                                {/* Title */}
                                <h4 className="text-sm font-medium line-clamp-2 leading-tight">
                                  {data.title}
                                </h4>
                                {/* Description */}
                                {data.description && (
                                  <p className="text-xs text-muted-foreground line-clamp-2">
                                    {data.description}
                                  </p>
                                )}
                                {/* Due Date */}
                                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                  {isTask && (data as Task).dueDate && (
                                    <div className="flex items-center gap-1">
                                      <Calendar className="h-3 w-3" />
                                      <span>
                                        Due{' '}
                                        {formatDistanceToNow(new Date((data as Task).dueDate!), {
                                          addSuffix: true,
                                        })}
                                      </span>
                                    </div>
                                  )}

                                  {isTask &&
                                    ((data as Task).blockedBy?.length > 0 ||
                                      (data as Task).blocks?.length > 0) && (
                                      <div className="flex items-center gap-1 text-orange-500">
                                        <Link2 className="h-3 w-3" />
                                        <span>
                                          {((data as Task).blockedBy?.length || 0) +
                                            ((data as Task).blocks?.length || 0)}
                                        </span>
                                      </div>
                                    )}
                                </div>
                                {data.assignedTo && data.assignedTo.length > 0 && (
                                  <div className="flex items-center gap-1">
                                    <User className="h-3 w-3 text-muted-foreground" />
                                    <div className="flex -space-x-1">
                                      {data.assignedToNames
                                        ?.slice(0, 3)
                                        .map((assignedToName, idx) => (
                                          <p className="text-xs" key={idx}>
                                            {assignedToName}
                                          </p>
                                        ))}
                                    </div>
                                  </div>
                                )}
                                {/* Task Labels */}
                                {isTask &&
                                  (data as Task).labels &&
                                  (data as Task).labels.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {(data as Task).labels.slice(0, 2).map((label, idx) => (
                                        <Badge
                                          key={idx}
                                          variant="outline"
                                          className="text-[10px] px-1 py-0"
                                        >
                                          {label.split(':')[1] || label}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                              </CardContent>
                            </Card>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}

                    {columnItems.length === 0 && (
                      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                        Drop items here
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
