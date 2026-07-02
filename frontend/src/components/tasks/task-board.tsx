'use client';

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
import { MoreVertical, Clock, AlertCircle, Circle, Calendar } from 'lucide-react';
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
  onTaskMove: (taskId: string, newStatus: TaskStatus, newPosition: number) => void;
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

const priorityConfig: Record<
  string,
  {
    label: string;
    color: string;
    icon: typeof AlertCircle;
    borderColor: string;
    dotColor: string;
  }
> = {
  CRITICAL: {
    label: 'Critical',
    color: 'destructive',
    icon: AlertCircle,
    borderColor: 'border-l-red-500',
    dotColor: 'bg-red-500',
  },
  HIGH: {
    label: 'High',
    color: 'orange',
    icon: AlertCircle,
    borderColor: 'border-l-orange-500',
    dotColor: 'bg-orange-500',
  },
  MEDIUM: {
    label: 'Medium',
    color: 'yellow',
    icon: Circle,
    borderColor: 'border-l-yellow-500',
    dotColor: 'bg-yellow-500',
  },
  LOW: {
    label: 'Low',
    color: 'gray',
    icon: Circle,
    borderColor: 'border-l-gray-400',
    dotColor: 'bg-gray-400',
  },
};

// Default priority config for unknown values
const defaultPriorityConfig = {
  label: 'Low',
  color: 'gray',
  icon: Circle,
  borderColor: 'border-l-gray-400',
  dotColor: 'bg-gray-400',
};

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
      if (
        sortCriteria.length === 0 ||
        (sortCriteria.length === 1 && sortCriteria[0].field === 'position')
      ) {
        return [...tasksToSort].sort((a, b) => a.position - b.position);
      }

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

  const handleDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result;

    // Dropped outside a droppable area
    if (!destination) return;

    // Dropped in same position
    if (source.droppableId === destination.droppableId && source.index === destination.index) {
      return;
    }

    const newStatus = destination.droppableId as TaskStatus;
    const newPosition = destination.index;

    onTaskMove(draggableId, newStatus, newPosition);
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {COLUMNS.map((column) => {
          const columnTasks = tasksByStatus[column.id];
          const hasItems = columnTasks.length > 0;

          return (
            <div key={column.id} className="flex flex-col min-h-50">
              {/* Column Header */}
              <div className={cn('rounded-t-lg p-3 border-b', column.color)}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">
                    {column.title}
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({columnTasks.length})
                    </span>
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
                      <Draggable key={task.id} draggableId={task.id} index={index}>
                        {(provided, snapshot) => (
                          <Card
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={cn(
                              'cursor-pointer hover:shadow-lg transition-shadow border-l-4',
                              (priorityConfig[task.priority] || defaultPriorityConfig).borderColor,
                              snapshot.isDragging && 'shadow-xl ring-2 ring-primary'
                            )}
                            onClick={() => onTaskClick(task)}
                          >
                            <CardHeader className="p-3 pb-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 space-y-1">
                                  <div className="flex items-center gap-2">
                                    {/* <Badge variant="outline" className="font-mono text-xs">
                                      {task.hierarchyId}
                                    </Badge> */}
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className={cn(
                                          'h-2 w-2 rounded-full',
                                          (priorityConfig[task.priority] || defaultPriorityConfig)
                                            .dotColor
                                        )}
                                      />
                                      <span className="text-xs text-muted-foreground font-medium">
                                        {
                                          (priorityConfig[task.priority] || defaultPriorityConfig)
                                            .label
                                        }
                                      </span>
                                    </div>
                                  </div>
                                  <h4 className="font-medium text-sm leading-tight line-clamp-2">
                                    {task.title}
                                  </h4>
                                </div>

                                {showMenu === true && (canEdit || canDelete) && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger
                                      asChild
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Button variant="ghost" size="icon" className="h-6 w-6">
                                        <MoreVertical className="h-4 w-4" />
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
                                          className="text-destructive"
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
                                  {task.estimatedHours && task.estimatedHours > 0 && (
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
                          </Card>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}

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
