import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TrimmedText } from '@strata/common';

/** The only membership states the app renders and authorizes against — mirrors
 *  `WorkspaceMembersService.assertValidStatus`, which is the enforcing copy. */
const MEMBER_STATUSES = ['ACTIVE', 'INACTIVE', 'INVITED'] as const;

// --- Workspace ---
/** The person a workspace is created FOR: its owner and first manager. */
export class WorkspaceManagerDto {
  @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(255) name!: string;
  @IsEmail() email!: string;
}
export class CreateWorkspaceDto {
  @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(255) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
  /** Somebody else runs it: they own it and manage it; the creator stays out. */
  @IsOptional() @ValidateNested() @Type(() => WorkspaceManagerDto) manager?: WorkspaceManagerDto;
}
export class TransferOwnershipDto {
  @IsString() @IsNotEmpty() userId!: string;
}
export class UpdateWorkspaceDto {
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(255) name?: string;
  @IsOptional() @IsString() description?: string;
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
// The name is what a membership stores and what every picker prints, so it is
// trimmed and may not be blank: ' Lead' and 'Lead' were two different roles, and
// '' was a role nobody could select.
export class CreateRoleDto {
  @IsString() workspaceId!: string;
  @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(64) name!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) permissions?: string[];
}
export class UpdateRoleDto {
  @TrimmedText() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64) name?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) permissions?: string[];
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

// --- Join request ---
export class CreateJoinRequestDto {
  @IsString() workspaceId!: string;
  // The request form stops at 500; the API did not, so anything talking to it
  // directly could park a message of any size in every manager's queue.
  @IsOptional() @IsString() @MaxLength(500) message?: string;
}
export class UpdateJoinRequestDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() handledBy?: string;
}
/** POST join_requests/:id/approve — the role the requester joins at. */
export class ApproveJoinRequestDto {
  @IsOptional() @IsString() role?: string;
}

// --- Workflows (application services) ---
/** POST workspaces/accept-invitation — redeem an invite code. */
export class AcceptInvitationDto {
  @IsString() @IsNotEmpty() code!: string;
}
