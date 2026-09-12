import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TrimmedText } from '@strata/common';

export class UpdateUserDto {
  // A 10,000-character display name was accepted here and then rendered in the
  // header, the sidebar and every avatar tooltip, blowing the page out to
  // 80,479px wide with a horizontal scrollbar on every route.
  @TrimmedText()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
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
  @TrimmedText()
  @IsString()
  @IsNotEmpty()
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
