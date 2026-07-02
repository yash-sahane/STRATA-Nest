import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateProjectDto {
  @IsString() workspaceId!: string;
  @IsString() @MaxLength(255) name!: string;
  @IsString() @MaxLength(10) shortCode!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsString() logo?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() methodology?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsBoolean() archived?: boolean;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsArray() memberIds?: string[];
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MaxLength(10) shortCode?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsString() logo?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() methodology?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsBoolean() archived?: boolean;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsArray() memberIds?: string[];
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
}
