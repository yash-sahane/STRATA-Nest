import {
  IsArray,
  IsNotEmpty,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { TrimmedText } from '@strata/common';

/** The only membership states the app renders and authorizes against — mirrors
 *  `WorkspaceMembersService.assertValidStatus`, which is the enforcing copy. */
const MEMBER_STATUSES = ['ACTIVE', 'INACTIVE', 'INVITED'] as const;

// --- Workspace ---
export class CreateWorkspaceDto {
  @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(255) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() logo?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
}
export class UpdateWorkspaceDto {
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() logo?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
}

// --- Member ---
export class CreateMemberDto {
  @IsString() workspaceId!: string;
  @IsString() userId!: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsIn(MEMBER_STATUSES) status?: string;
}
export class UpdateMemberDto {
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsIn(MEMBER_STATUSES) status?: string;
}

// --- Role ---
export class CreateRoleDto {
  @IsString() workspaceId!: string;
  @IsString() @MaxLength(64) name!: string;
  @IsOptional() @IsArray() permissions?: string[];
}
export class UpdateRoleDto {
  @IsOptional() @IsString() @MaxLength(64) name?: string;
  @IsOptional() @IsArray() permissions?: string[];
}

// --- Invite code ---
/** No `code`: InviteCodesService always mints its own CSPRNG value, so accepting
 *  one here only advertised a knob that silently did nothing. */
export class CreateInviteCodeDto {
  @IsString() workspaceId!: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsInt() @Min(1) maxUses?: number;
  @IsOptional() @IsDateString() expiresAt?: string;
}
export class UpdateInviteCodeDto {
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsInt() @Min(1) maxUses?: number;
  @IsOptional() @IsDateString() expiresAt?: string;
}

// --- Email invitation ---
/** No `token`/`status`: the service mints the token and forces PENDING, and
 *  status transitions belong to patch() and the accept workflow. */
export class CreateEmailInvitationDto {
  @IsString() workspaceId!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() role?: string;
  @IsDateString() expiresAt!: string;
}
export class UpdateEmailInvitationDto {
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
}

// --- Join request ---
export class CreateJoinRequestDto {
  @IsString() workspaceId!: string;
  @IsOptional() @IsString() message?: string;
}
export class UpdateJoinRequestDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() handledBy?: string;
}

// --- Pending access ---
export class CreatePendingAccessDto {
  @IsString() workspaceId!: string;
  @IsOptional() @IsString() requestedRole?: string;
}
export class UpdatePendingAccessDto {
  @IsOptional() @IsString() requestedRole?: string;
}

// --- Workflows (application services) ---
export class AcceptInvitationDto {
  @IsOptional() @IsString() token?: string; // email invitation
  @IsOptional() @IsString() code?: string; // invite code
}
