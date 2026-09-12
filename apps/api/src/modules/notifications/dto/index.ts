import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsStrictBoolean, TrimmedText } from '@strata/common';

export class CreateNotificationDto {
  @IsString() workspaceId!: string;
  @IsString() userId!: string;
  @IsString() type!: string;
  @TrimmedText() @IsString() @IsNotEmpty() @MaxLength(255) title!: string;
  @IsString() message!: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() relatedEntityId?: string;
  @IsOptional() @IsString() relatedEntityType?: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() isRead?: boolean;
}

export class UpdateNotificationDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() message?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() relatedEntityId?: string;
  @IsOptional() @IsString() relatedEntityType?: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() isRead?: boolean;
}

/** POST notifications/deadline_scan/ — run the workspace's daily deadline +
 *  overdue reminder scan. There is deliberately no recipient or task list: the
 *  server picks both, so a caller cannot address a notification to anyone. */
export class DeadlineScanDto {
  @IsString() @IsNotEmpty() workspaceId!: string;
}

/** One row of the Settings → Notifications grid. */
export class NotificationPreferenceItemDto {
  @IsString() @IsNotEmpty() type!: string;
  @IsStrictBoolean() @IsBoolean() inApp!: boolean;
  @IsStrictBoolean() @IsBoolean() email!: boolean;
}

/** PUT notification_preferences/ — upsert the CALLER's toggles for a workspace.
 *  There is deliberately no `userId`: preferences are always the caller's own. */
export class ReplaceNotificationPreferencesDto {
  @IsString() @IsNotEmpty() workspaceId!: string;
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceItemDto)
  preferences!: NotificationPreferenceItemDto[];
}
