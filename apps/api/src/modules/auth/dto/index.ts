import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { StrongPassword, TrimmedText } from '@strata/common';

/**
 * An avatar as the picker produces it — `FileReader.readAsDataURL` of an image:
 * a base64 data URI of a raster type a browser renders inertly — or '' for none.
 *
 * It was documented as a data URI and accepted as any string, so a member could
 * set it to `https://tracker.example/pixel?u=…`, and every colleague whose screen
 * showed their face (the header, the team list, each comment) fetched it — telling
 * a stranger who is online, when, and from which address. SVG is left out with
 * intent: it is a document, not a picture.
 */
export const AVATAR_DATA_URI = /^(data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/]+={0,2})?$/i;

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
  @Matches(AVATAR_DATA_URI, { message: 'Avatar must be a PNG, JPEG, GIF or WebP image.' })
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
