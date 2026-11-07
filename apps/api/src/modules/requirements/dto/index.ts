import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { BasedOn, StrictString, TrimmedText } from '@strata/common';

// The value sets the UI actually renders. An API that accepts a status no screen
// can paint stores rows nobody can read: an unknown priority was silently drawn
// as "Medium" and an unknown status as a blank badge.
export const REQUIREMENT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
// A client requirement's: drafted, submitted, approved, then — once it has
// functional requirements — In Progress and Completed as they go (rollups.ts),
// or archived. PROPOSED (a second word for SUBMITTED), ON_HOLD and REJECTED were
// accepted here and offered by no screen.
export const REQUIREMENT_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'IN_PROGRESS',
  'COMPLETED',
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
}
export class UpdateClientRequirementDto {
  /** What the editor believed the fields they are changing held; see BasedOn. */
  @BasedOn() basedOn?: Record<string, unknown>;
  @StrictString() @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsIn(REQUIREMENT_PRIORITIES) priority?: string;
  @IsOptional() @IsIn(REQUIREMENT_STATUSES) status?: string;
}

// --- Functional requirement ---
export class CreateFunctionalRequirementDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  /** Left out, the server mints one (generation/hierarchy-ids.ts). */
  @IsOptional() @IsString() @MaxLength(100) hierarchyId?: string;
  @StrictString() @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(500) title!: string;
  @IsOptional() @IsString() epicId?: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() clientRequirementId?: string;
  @IsOptional() @IsString() parentRequirementId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(FR_TYPES) type?: string;
  @IsOptional() @IsIn(FR_COMPLEXITIES) complexity?: string;
  @IsOptional() @IsIn(REQUIREMENT_PRIORITIES) priority?: string;
  // FR_STATUSES, not the client requirement's list this used to name.
  @IsOptional() @IsIn(FR_STATUSES) status?: string;
  /** Who works on it. Their names are the server's to write. */
  @IsOptional() @IsArray() assigneeIds?: string[];
}

/**
 * `progress` is not here: it is the requirement's TASK ROLLUP, written only by
 * rollups.ts in @strata/prisma. `status` is a person's to set while the
 * requirement has no tasks (and DEPLOYED is the sign-off); once it has tasks,
 * the save is followed by a refresh that puts it where its tasks are.
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
  @IsOptional() @IsIn(REQUIREMENT_PRIORITIES) priority?: string;
  /** See the note on this class. */
  @IsOptional() @IsIn(FR_STATUSES) status?: string;
  @IsOptional() @IsArray() assigneeIds?: string[];
}
