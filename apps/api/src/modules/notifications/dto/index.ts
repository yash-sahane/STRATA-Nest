import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateNotificationDto {
  @IsString() workspaceId!: string;
  @IsString() userId!: string;
  @IsString() type!: string;
  @IsString() title!: string;
  @IsString() message!: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() relatedEntityId?: string;
  @IsOptional() @IsString() relatedEntityType?: string;
  @IsOptional() @IsBoolean() isRead?: boolean;
}

export class UpdateNotificationDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() message?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() relatedEntityId?: string;
  @IsOptional() @IsString() relatedEntityType?: string;
  @IsOptional() @IsBoolean() isRead?: boolean;
}
