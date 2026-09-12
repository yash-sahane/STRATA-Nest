import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { IsStrictBoolean, TrimmedText } from '@strata/common';

// --- Client requirement ---
export class CreateClientRequirementDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(500) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsArray() attachments?: unknown[];
}
export class UpdateClientRequirementDto {
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsArray() attachments?: unknown[];
}

// --- Functional requirement ---
export class CreateFunctionalRequirementDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  @IsString() @MaxLength(100) hierarchyId!: string;
  @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(500) title!: string;
  @IsOptional() @IsString() epicId?: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() clientRequirementId?: string;
  @IsOptional() @IsString() parentRequirementId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() complexity?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsInt() @Min(0) progress?: number;
  @IsOptional() @IsStrictBoolean() @IsBoolean() reusable?: boolean;
  @IsOptional() @IsArray() assignedTo?: string[];
  @IsOptional() @IsArray() assignedToNames?: string[];
  @IsOptional() @IsString() tags?: string;
  @IsOptional() @IsString() linkedProjectIds?: string;
}

/**
 * `progress` and `status` are the FR's TASK ROLLUP: the detail dialog labels
 * both "(Auto-calculated from tasks)" and offers neither as an input, and the
 * client re-derives them after every task create, status change and delete. A
 * body that carries a `progress` and nothing but rollup columns is therefore
 * treated as a rollup rather than an edit (FunctionalRequirementsService.patchRollup):
 *
 *  - it is also accepted from a caller holding `task:update` instead of
 *    `requirement:write`, because that is the permission behind the task change
 *    that triggered it. For that caller BOTH columns are recomputed from the
 *    FR's tasks and the submitted numbers are ignored, so `task:update` cannot
 *    be used to declare a requirement tested or shipped.
 *  - a `requirement:write` caller keeps the `progress` it sent, but its
 *    `status` is recomputed from the task counts so the pair cannot contradict
 *    itself.
 *
 * A `status` sent ALONE is NOT a rollup — that is the sprint board moving an FR
 * card between columns, a human decision, and it still requires
 * `requirement:write`. So does any body touching a human-authored field.
 */
export class UpdateFunctionalRequirementDto {
  @IsOptional() @IsString() @MaxLength(100) hierarchyId?: string;
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) title?: string;
  @IsOptional() @IsString() epicId?: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() clientRequirementId?: string;
  @IsOptional() @IsString() parentRequirementId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() complexity?: string;
  @IsOptional() @IsString() priority?: string;
  /** Rollup column — see the note on this class before writing it alone. */
  @IsOptional() @IsString() status?: string;
  /** Rollup column — see the note on this class before writing it alone. */
  @IsOptional() @IsInt() @Min(0) progress?: number;
  @IsOptional() @IsStrictBoolean() @IsBoolean() reusable?: boolean;
  @IsOptional() @IsArray() assignedTo?: string[];
  @IsOptional() @IsArray() assignedToNames?: string[];
  @IsOptional() @IsString() tags?: string;
  @IsOptional() @IsString() linkedProjectIds?: string;
}
