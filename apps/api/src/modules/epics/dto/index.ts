import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { BasedOn, StrictString, TrimmedText } from '@strata/common';

/**
 * An epic's `status` and `progress` are not in these DTOs: they are its roll-up,
 * written only by rollups.ts in @strata/prisma from the work under it. Every
 * screen labels them "(Auto-calculated from tasks)" and none offers them.
 */
export class CreateEpicDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  /** Left out, the server mints one (generation/hierarchy-ids.ts). */
  @IsOptional() @IsString() @MaxLength(100) hierarchyId?: string;
  @StrictString() @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(500) name!: string;
  @IsOptional() @IsString() requirementId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
}

export class UpdateEpicDto {
  /** What the editor believed the fields they are changing held; see BasedOn. */
  @BasedOn() basedOn?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(100) hierarchyId?: string;
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) name?: string;
  @IsOptional() @IsString() requirementId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
}
