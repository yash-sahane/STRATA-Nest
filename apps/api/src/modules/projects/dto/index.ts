import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { BasedOn, StrictString, TrimmedText } from '@strata/common';
import { IsStrictBoolean } from '@strata/common';

export class CreateProjectDto {
  @IsString() workspaceId!: string;
  // @IsNotEmpty on both DTOs: an empty name renders as a blank card title and
  // there is no UI that can repair it except this same field.
  @StrictString() @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(255) name!: string;
  @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(10) shortCode!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsString() logo?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() methodology?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() archived?: boolean;
  // `| null` is part of the contract, not an accident: `null` is how a client
  // CLEARS a date column, and @IsOptional() already waves null through. Typing
  // it out keeps the service's "cleared vs. untouched" distinction honest.
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @IsDateString() endDate?: string | null;
  @IsOptional() @IsArray() memberIds?: string[];
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
}

export class UpdateProjectDto {
  /** What the editor believed the fields they are changing held; see BasedOn. */
  @BasedOn() basedOn?: Record<string, unknown>;
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(10) shortCode?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsString() logo?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() methodology?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() archived?: boolean;
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @IsDateString() endDate?: string | null;
  @IsOptional() @IsArray() memberIds?: string[];
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
}
