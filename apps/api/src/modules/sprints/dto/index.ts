import {
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { BasedOn, StrictString, TrimmedText } from '@strata/common';

/** Sprint lifecycle. A free string here let a sprint hold a status no screen renders. */
export const SPRINT_STATUSES = ['PLANNING', 'ACTIVE', 'COMPLETED'] as const;

// --- Sprint --- (startDate/endDate are required)
export class CreateSprintDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  @StrictString() @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(255) name!: string;
  // Date-only ("2026-08-11") or full ISO; both are accepted by IsDateString.
  // Without this, `new Date('garbage')` reached Prisma as an Invalid Date.
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsString() goal?: string;
  @IsOptional() @IsIn(SPRINT_STATUSES) status?: string;
  @IsOptional() @IsString() retrospectiveNotes?: string;
}
export class UpdateSprintDto {
  /** What the editor believed the fields they are changing held; see BasedOn. */
  @BasedOn() basedOn?: Record<string, unknown>;
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsString() goal?: string;
  @IsOptional() @IsIn(SPRINT_STATUSES) status?: string;
  @IsOptional() @IsString() retrospectiveNotes?: string;
}

// --- Retrospective ---
export class CreateRetrospectiveDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  @IsString() sprintId!: string;
  @IsOptional() @IsArray() wentWell?: unknown[];
  @IsOptional() @IsArray() needsImprovement?: unknown[];
  @IsOptional() @IsArray() actionItems?: unknown[];
}
export class UpdateRetrospectiveDto {
  @IsOptional() @IsArray() wentWell?: unknown[];
  @IsOptional() @IsArray() needsImprovement?: unknown[];
  @IsOptional() @IsArray() actionItems?: unknown[];
}
