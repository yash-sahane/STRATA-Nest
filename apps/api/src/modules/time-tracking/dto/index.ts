import { IsArray, IsBoolean, IsInt, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { IsStrictBoolean } from '@strata/common';

export class CreateTimeEntryDto {
  @IsString() workspaceId!: string;
  @IsString() startTime!: string;
  @IsString() endTime!: string;
  // Accepted for backwards compatibility and then IGNORED: the server derives
  // duration from startTime/endTime. Trusting it let a 90-minute window carry
  // 100000 minutes, and a PATCH of the times never recomputed it, so a row
  // could permanently claim 8h for a range of -99 minutes.
  @IsOptional() @IsInt() duration?: number;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() taskTitle?: string;
  @IsOptional() @IsString() taskHierarchyId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() projectName?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() isBillable?: boolean;
  @IsOptional() @IsNumber() @Min(0) billableRate?: number | null;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsArray() tags?: unknown[];
}
export class UpdateTimeEntryDto {
  // `status` is deliberately absent: approval is a state transition, owned by
  // POST :id/approve|reject (manager-only, self-approval blocked).
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
  @IsOptional() @IsInt() duration?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() isBillable?: boolean;
  // `null` is a MEANINGFUL value here and @IsOptional() lets it through (it
  // skips validation for null as well as undefined): an absent key leaves the
  // stored rate alone, `null` clears it. Without a way to say "no rate" a
  // cleared field could only be sent as undefined, which JSON.stringify drops,
  // so the entry kept a rate the owner had deleted.
  @IsOptional() @IsNumber() @Min(0) billableRate?: number | null;
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
  @IsOptional() @IsStrictBoolean() @IsBoolean() isPaused?: boolean;
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
  @IsOptional() @IsStrictBoolean() @IsBoolean() isBillable?: boolean;
  @IsOptional() @IsNumber() @Min(0) billableRate?: number;
}
