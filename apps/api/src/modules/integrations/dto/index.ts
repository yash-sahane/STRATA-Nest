import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsStrictBoolean, TrimmedText } from '@strata/common';

/*
 * No `webhookSecret` on any of these. The secret a provider signs its webhooks
 * with is minted by the server (POST :id/webhook-secret) and shown once: a
 * caller-chosen one could be 'secret', and nothing in the product ever sent one
 * at all — so the column stayed empty and every webhook was refused.
 */
export class CreateGitHubIntegrationDto {
  @IsString() projectId!: string;
  @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(100) repoOwner!: string;
  @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(100) repoName!: string;
  @IsString() @IsNotEmpty() accessToken!: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() autoUpdateStatus?: boolean;
  @IsOptional() @IsArray() enabledEvents?: unknown[];
}
export class UpdateGitHubIntegrationDto {
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) repoOwner?: string;
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) repoName?: string;
  @IsOptional() @IsString() @IsNotEmpty() accessToken?: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() autoUpdateStatus?: boolean;
  @IsOptional() @IsArray() enabledEvents?: unknown[];
}

export class CreateGitLabIntegrationDto {
  @IsString() projectId!: string;
  @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(255) projectPath!: string;
  @IsString() @IsNotEmpty() accessToken!: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() autoUpdateStatus?: boolean;
  @IsOptional() @IsArray() enabledEvents?: unknown[];
}
export class UpdateGitLabIntegrationDto {
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) projectPath?: string;
  @IsOptional() @IsString() @IsNotEmpty() accessToken?: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() autoUpdateStatus?: boolean;
  @IsOptional() @IsArray() enabledEvents?: unknown[];
}

export class CreateDiscordIntegrationDto {
  @IsString() projectId!: string;
  @IsString() webhookUrl!: string;
  @IsOptional() @IsArray() enabledEvents?: unknown[];
}
export class UpdateDiscordIntegrationDto {
  @IsOptional() @IsString() webhookUrl?: string;
  @IsOptional() @IsArray() enabledEvents?: unknown[];
}

