import { IsOptional, IsString } from 'class-validator';

/** Multipart create fields (the binary `file` part is handled by the interceptor). */
export class CreateFileDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() workspaceId?: string;
  @IsOptional() @IsString() projectId?: string;
  /** What the file is attached to inside its project: a task, or a client requirement. */
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() clientRequirementId?: string;
  @IsOptional() @IsString() bucketId?: string;
}
