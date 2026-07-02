import {
  IsArray,
  IsDateString,
  IsEmail,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

// --- Workspace ---
export class CreateWorkspaceDto {
  @IsString() @MaxLength(255) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() logo?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
}
export class UpdateWorkspaceDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
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
  @IsOptional() @IsString() status?: string;
}
export class UpdateMemberDto {
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsString() status?: string;
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
export class CreateInviteCodeDto {
  @IsString() workspaceId!: string;
  @IsOptional() @IsString() code?: string;
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
export class CreateEmailInvitationDto {
  @IsString() workspaceId!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsString() token?: string;
  @IsOptional() @IsString() status?: string;
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
