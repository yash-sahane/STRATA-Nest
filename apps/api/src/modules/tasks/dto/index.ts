import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TrimmedText } from '@strata/common';

/**
 * The kanban columns. A free-string `status` let a task hold a value that
 * matches no column — invisible on every board while still counted in totals.
 */
export const TASK_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] as const;
export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

// --- Task ---
export class CreateTaskDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  @IsString() @MaxLength(100) hierarchyId!: string;
  @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(500) title!: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() epicId?: string;
  @IsOptional() @IsString() functionalRequirementId?: string;
  @IsOptional() @IsString() parentTaskId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(TASK_STATUSES) status?: string;
  @IsOptional() @IsIn(TASK_PRIORITIES) priority?: string;
  @IsOptional() @IsArray() assigneeIds?: string[];
  @IsOptional() @IsString() assignedBy?: string;
  @IsOptional() @IsString() assignedByName?: string;
  @IsOptional() @IsArray() assignedTo?: string[];
  @IsOptional() @IsArray() assignedToNames?: string[];
  @IsOptional() @IsArray() watcherIds?: string[];
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsNumber() estimatedHours?: number;
  @IsOptional() @IsNumber() actualHours?: number;
  @IsOptional() @IsArray() labels?: unknown[];
  @IsOptional() @IsArray() attachments?: unknown[];
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
  @IsOptional() @IsNumber() position?: number;
  // blockedBy/blocks are NOT accepted on create, for the same reason PATCH
  // rejects them: each is only half of an edge. Writing one side alone leaves
  // the reverse index empty, so the cycle check (which walks `blockedBy`) sees
  // an edge the other card does not render and DELETE .../dependencies/:target
  // computes its next list from an array that never held the id. A new task has
  // no dependencies; clients add them through POST /tasks/{id}/dependencies,
  // which writes both halves in one transaction.
}
// PATCH: every task field optional (kanban move = PATCH status + position).
export class UpdateTaskDto {
  @IsOptional() @IsString() @MaxLength(100) hierarchyId?: string;
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) title?: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() epicId?: string;
  @IsOptional() @IsString() functionalRequirementId?: string;
  @IsOptional() @IsString() parentTaskId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(TASK_STATUSES) status?: string;
  @IsOptional() @IsIn(TASK_PRIORITIES) priority?: string;
  @IsOptional() @IsArray() assigneeIds?: string[];
  @IsOptional() @IsString() assignedBy?: string;
  @IsOptional() @IsString() assignedByName?: string;
  @IsOptional() @IsArray() assignedTo?: string[];
  @IsOptional() @IsArray() assignedToNames?: string[];
  @IsOptional() @IsArray() watcherIds?: string[];
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsNumber() estimatedHours?: number;
  @IsOptional() @IsNumber() actualHours?: number;
  @IsOptional() @IsArray() labels?: unknown[];
  @IsOptional() @IsArray() attachments?: unknown[];
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
  @IsOptional() @IsNumber() position?: number;
  @IsOptional() @IsArray() blockedBy?: string[];
  @IsOptional() @IsArray() blocks?: string[];
}

/**
 * A dependency edge, addressed from one task to another. `blockedBy` means the
 * addressed task waits on the target; `blocks` is the same edge seen from the
 * other end. Both sides of the edge are written together (see
 * TasksService.addDependency) — the client used to PATCH each side separately,
 * so a failure between the two calls left a half-recorded dependency.
 */
export const TASK_DEPENDENCY_TYPES = ['blocks', 'blockedBy'] as const;
export type TaskDependencyType = (typeof TASK_DEPENDENCY_TYPES)[number];

export class TaskDependencyDto {
  @IsString() targetTaskId!: string;
  @IsIn(TASK_DEPENDENCY_TYPES) type!: TaskDependencyType;
}
export class TaskDependencyQueryDto {
  @IsIn(TASK_DEPENDENCY_TYPES) type!: TaskDependencyType;
}

// --- Task comment (unscoped; user = caller) ---
export class CreateTaskCommentDto {
  @IsString() taskId!: string;
  // Capped and trimmed: an uncapped body meant a ~102 KB comment came back as a
  // bare HTTP 500, and a whitespace-only one posted an empty bubble.
  @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(10_000) content!: string;
  @IsOptional() @IsArray() mentions?: unknown[];
  @IsOptional() @IsArray() attachments?: unknown[];
}
export class UpdateTaskCommentDto {
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsArray() mentions?: unknown[];
  @IsOptional() @IsArray() attachments?: unknown[];
}

// --- Kanban column (unscoped) ---
export class CreateKanbanColumnDto {
  @IsString() projectId!: string;
  @IsString() @MaxLength(100) name!: string;
  @IsString() status!: string;
  @IsOptional() @IsInt() wipLimit?: number;
  @IsOptional() @IsNumber() position?: number;
  @IsOptional() @IsString() color?: string;
}
export class UpdateKanbanColumnDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsInt() wipLimit?: number;
  @IsOptional() @IsNumber() position?: number;
  @IsOptional() @IsString() color?: string;
}

// --- Label (workspace-scoped) ---
export class CreateLabelDto {
  @IsString() workspaceId!: string;
  @IsString() @MaxLength(100) name!: string;
  @IsString() color!: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() description?: string;
}
export class UpdateLabelDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() description?: string;
}
