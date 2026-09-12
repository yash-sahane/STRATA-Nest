import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TrimmedText } from '@strata/common';

export class CreateActivityLogDto {
  @IsString() workspaceId!: string;
  @IsString() action!: string;
  @IsString() entityType!: string;
  @IsString() entityId!: string;
  @IsOptional() @IsObject() changes?: Record<string, unknown>;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class CreateSavedSearchDto {
  @IsString() workspaceId!: string;
  @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(255) name!: string;
  @IsString() query!: string;
  @IsOptional() @IsObject() filters?: Record<string, unknown>;
}

export class UpdateSavedSearchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() query?: string;
  @IsOptional() @IsObject() filters?: Record<string, unknown>;
}
