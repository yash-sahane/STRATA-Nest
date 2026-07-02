import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateEpicDto {
  @IsString() workspaceId!: string;
  @IsString() projectId!: string;
  @IsString() @MaxLength(100) hierarchyId!: string;
  @IsString() @MaxLength(500) name!: string;
  @IsOptional() @IsString() requirementId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsInt() @Min(0) progress?: number;
  @IsOptional() @IsString() assignedTeam?: string;
}

export class UpdateEpicDto {
  @IsOptional() @IsString() @MaxLength(100) hierarchyId?: string;
  @IsOptional() @IsString() @MaxLength(500) name?: string;
  @IsOptional() @IsString() requirementId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsInt() @Min(0) progress?: number;
  @IsOptional() @IsString() assignedTeam?: string;
}
