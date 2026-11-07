import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { BasedOn, StrictString, TrimmedText } from '@strata/common';
import { IsStrictBoolean } from '@strata/common';

/** What a project's status can be. Archived is how a project is archived. */
export const PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const;

export class CreateProjectDto {
  @IsString() workspaceId!: string;
  // @IsNotEmpty on both DTOs: an empty name renders as a blank card title and
  // there is no UI that can repair it except this same field.
  @StrictString() @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(255) name!: string;
  /** Left out, the server mints one from the name that no other project here uses. */
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(10) shortCode?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsIn(PROJECT_STATUSES) status?: string;
  // `| null` is part of the contract, not an accident: `null` is how a client
  // CLEARS a date column, and @IsOptional() already waves null through. Typing
  // it out keeps the service's "cleared vs. untouched" distinction honest.
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @IsDateString() endDate?: string | null;
}

export class UpdateProjectDto {
  /** What the editor believed the fields they are changing held; see BasedOn. */
  @BasedOn() basedOn?: Record<string, unknown>;
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(10) shortCode?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsIn(PROJECT_STATUSES) status?: string;
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @IsDateString() endDate?: string | null;
}

/** POST /projects/:id/clone — what the copy is called and which parts it takes. */
export class CloneProjectDto {
  @StrictString() @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(255) name!: string;
  /** Client requirements, epics, functional requirements and tasks. */
  @IsOptional() @IsStrictBoolean() @IsBoolean() includeTasks?: boolean;
  @IsOptional() @IsStrictBoolean() @IsBoolean() includeSprints?: boolean;
}
