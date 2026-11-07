import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';
import { IsStrictBoolean } from '@strata/common';

export class CreateTimeEntryDto {
  @IsString() workspaceId!: string;
  @IsString() startTime!: string;
  @IsString() endTime!: string;
  // No `duration`: the server derives it from startTime/endTime. Trusting one
  // let a 90-minute window carry 100000 minutes.
  /** The task and project are named by id; their titles are read from the records. */
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() isBillable?: boolean;
  @IsOptional() @IsArray() tags?: unknown[];
}
export class UpdateTimeEntryDto {
  // `status` is deliberately absent: approval is a state transition, owned by
  // POST :id/approve|reject (manager-only, self-approval blocked).
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() isBillable?: boolean;
  @IsOptional() @IsArray() tags?: unknown[];
}

export class RejectTimeEntryDto {
  @IsOptional() @IsString() reason?: string;
}

// Active timer
// Timer lifecycle
export class StartTimerDto {
  /** The workspace a timer on no task or project is for. */
  @IsOptional() @IsString() workspaceId?: string;
  /**
   * Stop the running timer — logging its time — and start this one in its
   * place. A running timer whose workspace the caller can no longer log time
   * in is discarded instead; the response's `replaced` says which happened.
   */
  @IsOptional() @IsStrictBoolean() @IsBoolean() replace?: boolean;
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() description?: string;
}
export class StopTimerDto {
  @IsString() workspaceId!: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() isBillable?: boolean;
  /**
   * When the work actually stopped, for a timer left running past it. Absent,
   * the server's clock ends the run — the ordinary Stop.
   */
  @IsOptional() @IsString() endTime?: string;
}
