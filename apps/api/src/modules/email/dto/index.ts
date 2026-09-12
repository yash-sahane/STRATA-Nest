import { ArrayNotEmpty, IsArray, IsEmail, IsOptional, IsString } from 'class-validator';

/** POST email/send-invitation/ */
export class SendInvitationEmailDto {
  @IsEmail() to!: string;
  @IsString() workspaceName!: string;
  @IsString() inviterName!: string;
  @IsString() inviteCode!: string;
}

/** POST email/send-leave/ and email/send-notification/ (generic pre-rendered). */
export class SendGenericEmailDto {
  @IsArray() @ArrayNotEmpty() @IsEmail({}, { each: true }) to!: string[];
  @IsString() subject!: string;
  @IsString() html!: string;
  @IsOptional() @IsString() text?: string;
  /** Optional provenance so the recipient's email opt-out for this notification
   *  type can be honoured server-side. Omitted → nothing to check, send as before. */
  @IsOptional() @IsString() workspaceId?: string;
  @IsOptional() @IsString() notificationType?: string;
}
