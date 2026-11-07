import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { TrimmedText } from '@strata/common';
import { AVATAR_DATA_URI } from '../../auth/dto';

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

  // The same rule as the profile route (auth/dto): a data URI of an image, or ''
  // to clear it. Any string was accepted here, so a remote URL — a tracking
  // pixel every colleague's browser would fetch — could be set through this
  // route even after the profile route refused it.
  @IsOptional()
  @IsString()
  @MaxLength(2_800_000, { message: 'Avatar image must be 2 MB or smaller.' })
  @Matches(AVATAR_DATA_URI, { message: 'Avatar must be a PNG, JPEG, GIF or WebP image.' })
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

export class ReissueTempPasswordDto {
  /** The workspace the caller manages this person in. */
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;
}
