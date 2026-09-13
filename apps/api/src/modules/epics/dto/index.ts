import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { StrictString, TrimmedText } from '@strata/common';

/**
 * The epic's three statuses, as written by the task rollup and rendered by the
 * badge maps on every screen. `status` was a bare @IsString(), so
 * `{ status: 'NOT_A_STATUS' }` stored happily and then fell through every badge
 * lookup to an unstyled label.
 */
export const EPIC_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'] as const;

export class CreateEpicDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  @IsString() @MaxLength(100) hierarchyId!: string;
  @StrictString() @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(500) name!: string;
  @IsOptional() @IsString() requirementId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() @IsIn(EPIC_STATUSES) status?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) progress?: number;
  @IsOptional() @IsString() assignedTeam?: string;
}

/**
 * `progress` and `status` are the epic's TASK ROLLUP, not free-form fields —
 * every screen labels them "(Auto-calculated from tasks)" and none offers them
 * as inputs. A body that carries ONLY those two is therefore treated as a
 * rollup rather than an edit, which changes two things (EpicsService.patchRollup):
 *
 *  - it is also accepted from a caller holding `task:update` instead of
 *    `planning:write`, because that is the permission behind the task change
 *    that triggered it. For that caller BOTH columns are recomputed from the
 *    epic's tasks and the submitted numbers are ignored, so `task:update`
 *    cannot be used to declare an epic complete. The response carries the
 *    values actually stored.
 *  - a `planning:write` caller keeps the `progress` it sent, but any body that
 *    carries a `progress` has its `status` recomputed from the task counts —
 *    the pair must not contradict itself, in either direction ("Done, 0%,
 *    0 / 0 tasks", or "Done, 100%" over 240 of 241 tasks, which is what
 *    Math.round returns). A `status` sent ALONE is a human decision, not a
 *    rollup, and is still stored verbatim.
 *
 * Any body that also touches a human-authored field is an ordinary update and
 * requires `planning:write`.
 */
export class UpdateEpicDto {
  @IsOptional() @IsString() @MaxLength(100) hierarchyId?: string;
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) name?: string;
  @IsOptional() @IsString() requirementId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  /** Rollup column — see the note on this class before writing it alone. */
  @IsOptional() @IsString() @IsIn(EPIC_STATUSES) status?: string;
  /** Rollup column — see the note on this class before writing it alone. */
  @IsOptional() @IsInt() @Min(0) @Max(100) progress?: number;
  @IsOptional() @IsString() assignedTeam?: string;
}
