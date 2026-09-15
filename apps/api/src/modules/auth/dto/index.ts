import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { StrongPassword, TrimmedText } from '@strata/common';

/**
 * Trim before validating an address.
 *
 * A pasted e-mail routinely carries a leading or trailing space, and @IsEmail
 * rejects it — so the user was told their own address was "not an email"
 * rather than being signed in. Whitespace around an identifier carries no
 * meaning; strip it at the edge.
 */
const TrimmedEmail = (): PropertyDecorator =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class LoginDto {
  @TrimmedEmail()
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class RegisterDto {
  @TrimmedEmail()
  @IsEmail()
  email!: string;

  @IsString()
  @StrongPassword()
  password!: string;

  @TrimmedText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  /*
   * `workspaceId` used to be accepted here and stored verbatim on the new user,
   * where user.mapper exposes it as BOTH workspaceId and defaultWorkspaceId. So an
   * unauthenticated caller could point a brand-new account's default workspace at
   * somebody else's — mass assignment of a scope field from a public endpoint.
   *
   * Measured, it granted no access (GET /workspaces returned []), but it did set
   * the client's idea of which workspace to open to one the user cannot see. No
   * client ever sent it: registration is not exposed in the UI at all, since users
   * are invited. Removed rather than validated, so ValidationPipe({ whitelist })
   * strips it; joining a workspace goes through the invite flow, which is
   * authorised.
   */
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @StrongPassword()
  newPassword!: string;
}

export class UpdateProfileDto {
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

  // The avatar is stored as a data URI. 2 MB of image is what the picker
  // advertises; base64 inflates it by 4/3, so this is that same 2 MB expressed
  // in the units the column actually receives — and an over-sized one now gets
  // a message naming the avatar rather than a generic body-size error.
  @IsOptional()
  @IsString()
  @MaxLength(2_800_000, { message: 'Avatar image must be 2 MB or smaller.' })
  avatar?: string;
}

export class PasswordResetRequestDto {
  @TrimmedEmail()
  @IsEmail()
  email!: string;
}

export class PasswordResetConfirmDto {
  @IsString()
  uid!: string;

  @IsString()
  token!: string;

  @IsString()
  @StrongPassword()
  newPassword!: string;
}
