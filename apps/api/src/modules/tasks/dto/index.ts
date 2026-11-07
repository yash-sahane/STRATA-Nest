import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BasedOn, StrictString, TrimmedText } from '@strata/common';

/**
 * The kanban columns. A free-string `status` let a task hold a value that
 * matches no column — invisible on every board while still counted in totals.
 */
export const TASK_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] as const;
export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

/**
 * One label: "colour:text". Checked item by item because `@IsArray()` alone let
 * `labels: [42]` or `[{}]` be stored, and every board then called `.split` on it
 * and crashed — for everybody who opened the project, not only the sender.
 * 100 characters, the same cap as an id: a label is a word or two on a card.
 */
export const LABEL_MAX_LENGTH = 100;

// --- Task ---
export class CreateTaskDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  /** Left out, the server mints one (generation/hierarchy-ids.ts). */
  @IsOptional() @IsString() @MaxLength(100) hierarchyId?: string;
  @StrictString() @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(500) title!: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() epicId?: string;
  @IsOptional() @IsString() functionalRequirementId?: string;
  @IsOptional() @IsString() parentTaskId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(TASK_STATUSES) status?: string;
  @IsOptional() @IsIn(TASK_PRIORITIES) priority?: string;
  /** Who does it. Their names, and who assigned them, are the server's to write. */
  @IsOptional() @IsArray() assigneeIds?: string[];
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(10_000) estimatedHours?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(LABEL_MAX_LENGTH, { each: true })
  labels?: string[];
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
  /** What the editor believed the fields they are changing held; see BasedOn. */
  @BasedOn() basedOn?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(100) hierarchyId?: string;
  @StrictString() @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) title?: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() epicId?: string;
  @IsOptional() @IsString() functionalRequirementId?: string;
  @IsOptional() @IsString() parentTaskId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(TASK_STATUSES) status?: string;
  @IsOptional() @IsIn(TASK_PRIORITIES) priority?: string;
  @IsOptional() @IsArray() assigneeIds?: string[];
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(10_000) estimatedHours?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(LABEL_MAX_LENGTH, { each: true })
  labels?: string[];
  @IsOptional() @IsNumber() position?: number;
  /**
   * Where a dragged card lands, named by the card it now sits in front of — or
   * '' for the end of its column. The server works out `position` from the
   * neighbours as they are stored (see TasksService.placedPosition), so a drop
   * is ONE write. Boards used to send a rank instead: a rank within whatever
   * the board happened to show, written over positions that are project-wide,
   * which then took a PATCH of every other card in the column to make true.
   * Wins over `position` when both are sent.
   */
  @IsOptional() @IsString() placeBefore?: string;
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
  @StrictString() @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(10_000) content!: string;
  @IsOptional() @IsArray() mentions?: unknown[];
}
export class UpdateTaskCommentDto {
  // The same rules as posting one. An edit skipped all three, so a comment
  // could be emptied to a blank bubble, padded with spaces, or rewritten past
  // the cap that a new comment is held to.
  @StrictString() @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(10_000)
  content?: string;
  @IsOptional() @IsArray() mentions?: unknown[];
}
