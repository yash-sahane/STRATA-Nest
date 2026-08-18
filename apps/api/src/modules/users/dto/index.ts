import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class InviteUserDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  roleName?: string;

  @IsString()
  @MaxLength(36)
  workspaceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  workspaceName?: string;
}
