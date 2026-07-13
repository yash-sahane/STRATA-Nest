import { IsObject, IsOptional, IsString } from 'class-validator';

/** A single generated node — arbitrary AI output; validated loosely. */
export interface GeneratedNode {
  title?: string;
  name?: string;
  description?: string;
  priority?: string;
  complexity?: string;
  color?: string;
  startDate?: string;
  endDate?: string;
  estimatedHours?: number;
  type?: string;
  parentId?: string;
}

export interface GeneratedTree {
  clientRequirements?: GeneratedNode[];
  epics?: GeneratedNode[];
  functionalRequirements?: GeneratedNode[];
  tasks?: GeneratedNode[];
}

export class BulkSaveDto {
  @IsString() projectId!: string;
  @IsString() workspaceId!: string;
  @IsOptional() @IsString() projectCode?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsObject() generated?: GeneratedTree;
}
