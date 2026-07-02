import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

// --- Sprint --- (startDate/endDate required in Django)
export class CreateSprintDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  @IsString() @MaxLength(255) name!: string;
  @IsString() startDate!: string;
  @IsString() endDate!: string;
  @IsOptional() @IsString() goal?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() retrospectiveNotes?: string;
}
export class UpdateSprintDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() goal?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() retrospectiveNotes?: string;
}

// --- Retrospective ---
export class CreateRetrospectiveDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  @IsString() sprintId!: string;
  @IsOptional() @IsArray() wentWell?: unknown[];
  @IsOptional() @IsArray() needsImprovement?: unknown[];
  @IsOptional() @IsArray() actionItems?: unknown[];
}
export class UpdateRetrospectiveDto {
  @IsOptional() @IsArray() wentWell?: unknown[];
  @IsOptional() @IsArray() needsImprovement?: unknown[];
  @IsOptional() @IsArray() actionItems?: unknown[];
}
