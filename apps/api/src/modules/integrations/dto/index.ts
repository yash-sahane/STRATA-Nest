import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateGitHubIntegrationDto {
  @IsString() projectId!: string;
  @IsString() repoOwner!: string;
  @IsString() repoName!: string;
  @IsString() accessToken!: string;
  @IsOptional() @IsString() webhookSecret?: string;
  @IsOptional() @IsBoolean() autoUpdateStatus?: boolean;
  @IsOptional() @IsArray() enabledEvents?: unknown[];
}
export class UpdateGitHubIntegrationDto {
  @IsOptional() @IsString() repoOwner?: string;
  @IsOptional() @IsString() repoName?: string;
  @IsOptional() @IsString() accessToken?: string;
  @IsOptional() @IsString() webhookSecret?: string;
  @IsOptional() @IsBoolean() autoUpdateStatus?: boolean;
  @IsOptional() @IsArray() enabledEvents?: unknown[];
}

export class CreateGitLabIntegrationDto {
  @IsString() projectId!: string;
  @IsString() projectPath!: string;
  @IsString() accessToken!: string;
  @IsOptional() @IsString() webhookSecret?: string;
  @IsOptional() @IsBoolean() autoUpdateStatus?: boolean;
  @IsOptional() @IsArray() enabledEvents?: unknown[];
}
export class UpdateGitLabIntegrationDto {
  @IsOptional() @IsString() projectPath?: string;
  @IsOptional() @IsString() accessToken?: string;
  @IsOptional() @IsString() webhookSecret?: string;
  @IsOptional() @IsBoolean() autoUpdateStatus?: boolean;
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

export class CreateGitCommitDto {
  @IsString() projectId!: string;
  @IsString() provider!: string;
  @IsString() commitSha!: string;
  @IsString() message!: string;
  @IsString() author!: string;
  @IsString() authorEmail!: string;
  @IsString() timestamp!: string;
  @IsString() url!: string;
  @IsOptional() @IsArray() linkedTaskIds?: unknown[];
}
export class UpdateGitCommitDto {
  @IsOptional() @IsString() message?: string;
  @IsOptional() @IsArray() linkedTaskIds?: unknown[];
}
