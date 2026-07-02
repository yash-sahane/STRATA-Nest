import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

// --- Client requirement ---
export class CreateClientRequirementDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  @IsString() @MaxLength(500) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsArray() attachments?: unknown[];
}
export class UpdateClientRequirementDto {
  @IsOptional() @IsString() @MaxLength(500) title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsArray() attachments?: unknown[];
}

// --- Functional requirement ---
export class CreateFunctionalRequirementDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  @IsString() @MaxLength(100) hierarchyId!: string;
  @IsString() @MaxLength(500) title!: string;
  @IsOptional() @IsString() epicId?: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() clientRequirementId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() complexity?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsInt() @Min(0) progress?: number;
  @IsOptional() @IsBoolean() reusable?: boolean;
  @IsOptional() @IsArray() assignedTo?: string[];
  @IsOptional() @IsArray() assignedToNames?: string[];
  @IsOptional() @IsString() tags?: string;
  @IsOptional() @IsString() linkedProjectIds?: string;
}
export class UpdateFunctionalRequirementDto {
  @IsOptional() @IsString() @MaxLength(100) hierarchyId?: string;
  @IsOptional() @IsString() @MaxLength(500) title?: string;
  @IsOptional() @IsString() epicId?: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() clientRequirementId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() complexity?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsInt() @Min(0) progress?: number;
  @IsOptional() @IsBoolean() reusable?: boolean;
  @IsOptional() @IsArray() assignedTo?: string[];
  @IsOptional() @IsArray() assignedToNames?: string[];
  @IsOptional() @IsString() tags?: string;
  @IsOptional() @IsString() linkedProjectIds?: string;
}
