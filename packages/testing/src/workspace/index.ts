// Workspace/membership test helpers (Phase 2). Shared so downstream modules
// reuse one implementation instead of reinventing scoped fixtures.
import { generateId } from '@lt/common';
import { defineFactory } from '../factories/factory';

export interface WorkspaceSeed {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
}

export const workspaceFactory = defineFactory<WorkspaceSeed>((seq) => ({
  id: generateId(),
  name: `Workspace ${seq}`,
  ownerId: generateId(),
  inviteCode: `CODE${seq}`,
}));

export interface MemberSeed {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  status: string;
}

export const memberFactory = defineFactory<MemberSeed>(() => ({
  id: generateId(),
  workspaceId: generateId(),
  userId: generateId(),
  role: 'MEMBER',
  status: 'ACTIVE',
}));
