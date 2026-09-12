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
  /**
   * Cross-references the model draws between sections. The prompt asks for an
   * array index as a string, but the answer is whatever the model finds natural
   * — a number, "2", "epic-2", or the referenced node's own title — so these
   * stay `unknown` and the service resolves them.
   */
  functionalRequirementIds?: unknown;
  epicId?: unknown;
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
  @IsOptional() @IsObject() generated?: GeneratedTree;
}
