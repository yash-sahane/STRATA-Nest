import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BasedOn, IsStrictBoolean, StrictString, TrimmedText } from '@strata/common';

// The value sets the UI actually renders. An API that accepts a status no screen
// can paint stores rows nobody can read: an unknown priority was silently drawn
// as "Medium" and an unknown status as a blank badge.
export const REQUIREMENT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const REQUIREMENT_STATUSES = [
  'DRAFT',
  'PROPOSED',
  'SUBMITTED',
  'APPROVED',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'REJECTED',
  'ARCHIVED',
] as const;
export const FR_STATUSES = ['DRAFT', 'REVIEW', 'APPROVED', 'IMPLEMENTED', 'TESTED', 'DEPLOYED'] as const;
export const FR_COMPLEXITIES = ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'] as const;
export const FR_TYPES = ['FUNCTIONAL', 'NON_FUNCTIONAL', 'TECHNICAL', 'BUSINESS'] as const;

// --- Client requirement ---
export class CreateClientRequirementDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  @StrictString() @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(500) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsIn(REQUIREMENT_PRIORITIES) priority?: string;
  @IsOptional() @IsIn(REQUIREMENT_STATUSES) status?: string;
  @IsOptional() @IsArray() attachments?: unknown[];
}
export class UpdateClientRequirementDto {
  /** What the editor believed the fields they are changing held; see BasedOn. */
  @BasedOn() basedOn?: Record<string, unknown>;
  @StrictString() @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsIn(REQUIREMENT_PRIORITIES) priority?: string;
  @IsOptional() @IsIn(REQUIREMENT_STATUSES) status?: string;
  @IsOptional() @IsArray() attachments?: unknown[];
}

// --- Functional requirement ---
export class CreateFunctionalRequirementDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  @IsString() @MaxLength(100) hierarchyId!: string;
  @StrictString() @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(500) title!: string;
  @IsOptional() @IsString() epicId?: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() clientRequirementId?: string;
  @IsOptional() @IsString() parentRequirementId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(FR_TYPES) type?: string;
  @IsOptional() @IsIn(FR_COMPLEXITIES) complexity?: string;
  @IsOptional() @IsIn(REQUIREMENT_PRIORITIES) priority?: string;
  @IsOptional() @IsIn(REQUIREMENT_STATUSES) status?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) progress?: number;
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
  /** What the editor believed the fields they are changing held; see BasedOn. */
  @BasedOn() basedOn?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(100) hierarchyId?: string;
  @StrictString() @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) title?: string;
  @IsOptional() @IsString() epicId?: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() clientRequirementId?: string;
  @IsOptional() @IsString() parentRequirementId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(FR_TYPES) type?: string;
  @IsOptional() @IsIn(FR_COMPLEXITIES) complexity?: string;
  @IsOptional() @IsString() priority?: string;
  /** Rollup column — see the note on this class before writing it alone. */
  @IsOptional() @IsIn(FR_STATUSES) status?: string;
  /** Rollup column — see the note on this class before writing it alone. */
  @IsOptional() @IsInt() @Min(0) @Max(100) progress?: number;
  @IsOptional() @IsStrictBoolean() @IsBoolean() reusable?: boolean;
  @IsOptional() @IsArray() assignedTo?: string[];
  @IsOptional() @IsArray() assignedToNames?: string[];
  @IsOptional() @IsString() tags?: string;
  @IsOptional() @IsString() linkedProjectIds?: string;
}
