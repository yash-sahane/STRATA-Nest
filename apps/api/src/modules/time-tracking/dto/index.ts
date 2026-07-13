import { IsArray, IsBoolean, IsInt, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateTimeEntryDto {
  @IsString() workspaceId!: string;
  @IsString() startTime!: string;
  @IsString() endTime!: string;
  @IsOptional() @IsInt() duration?: number;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() taskTitle?: string;
  @IsOptional() @IsString() taskHierarchyId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() projectName?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isBillable?: boolean;
  @IsOptional() @IsNumber() billableRate?: number;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsArray() tags?: unknown[];
}
export class UpdateTimeEntryDto {
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
  @IsOptional() @IsInt() duration?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isBillable?: boolean;
  @IsOptional() @IsNumber() billableRate?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsArray() tags?: unknown[];
}

export class RejectTimeEntryDto {
  @IsOptional() @IsString() reason?: string;
}

// Active timer
export class CreateActiveTimerDto {
  @IsString() startTime!: string;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() taskTitle?: string;
  @IsOptional() @IsString() taskHierarchyId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsObject() pomodoroSettings?: Record<string, unknown>;
}
export class UpdateActiveTimerDto {
  @IsOptional() @IsBoolean() isPaused?: boolean;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() pomodoroSettings?: Record<string, unknown>;
}

// Timer lifecycle
export class StartTimerDto {
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() taskTitle?: string;
  @IsOptional() @IsString() taskHierarchyId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsObject() pomodoroSettings?: Record<string, unknown>;
}
export class StopTimerDto {
  @IsString() workspaceId!: string;
  @IsOptional() @IsBoolean() isBillable?: boolean;
  @IsOptional() @IsNumber() billableRate?: number;
}
