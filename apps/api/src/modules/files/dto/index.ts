import { IsOptional, IsString } from 'class-validator';

/** Multipart create fields (the binary `file` part is handled by the interceptor). */
export class CreateFileDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() workspaceId?: string;
  @IsOptional() @IsString() workspace_id?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() project_id?: string;
  @IsOptional() @IsString() bucketId?: string;
}
