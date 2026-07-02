import {
  IsArray,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// --- Task ---
export class CreateTaskDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  @IsString() @MaxLength(100) hierarchyId!: string;
  @IsString() @MaxLength(500) title!: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() epicId?: string;
  @IsOptional() @IsString() functionalRequirementId?: string;
  @IsOptional() @IsString() parentTaskId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() priority?: string;
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
// PATCH: every task field optional (kanban move = PATCH status + position).
export class UpdateTaskDto {
  @IsOptional() @IsString() @MaxLength(100) hierarchyId?: string;
  @IsOptional() @IsString() @MaxLength(500) title?: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() epicId?: string;
  @IsOptional() @IsString() functionalRequirementId?: string;
  @IsOptional() @IsString() parentTaskId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() priority?: string;
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

// --- Task comment (unscoped; user = caller) ---
export class CreateTaskCommentDto {
  @IsString() taskId!: string;
  @IsString() content!: string;
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
