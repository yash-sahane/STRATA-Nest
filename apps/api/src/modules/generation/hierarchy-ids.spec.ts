import type { PrismaService } from '@strata/prisma';
import {
  codeOf,
  mintEpicHierarchyId,
  mintRequirementHierarchyId,
  mintTaskHierarchyId,
} from './hierarchy-ids';

type Rows = {
  project?: { shortCode: string; name: string };
  epics?: { hierarchyId: string }[];
  epic?: { name: string; requirementId: string } | null;
  clientRequirement?: { title: string } | null;
  requirementCount?: number;
  requirement?: { hierarchyId: string } | null;
  requirementSiblings?: { hierarchyId: string }[];
  task?: { hierarchyId: string } | null;
  tasks?: { hierarchyId: string }[];
};

function client(rows: Rows) {
  return {
    project: { findUnique: jest.fn().mockResolvedValue(rows.project ?? { shortCode: 'ECOM', name: 'Shop' }) },
    epic: {
      findMany: jest.fn().mockResolvedValue(rows.epics ?? []),
      findUnique: jest.fn().mockResolvedValue(rows.epic ?? null),
    },
    clientRequirement: { findUnique: jest.fn().mockResolvedValue(rows.clientRequirement ?? null) },
    functionalRequirement: {
      count: jest.fn().mockResolvedValue(rows.requirementCount ?? 0),
      findUnique: jest.fn().mockResolvedValue(rows.requirement ?? null),
      findMany: jest.fn().mockResolvedValue(rows.requirementSiblings ?? []),
    },
    task: {
      findUnique: jest.fn().mockResolvedValue(rows.task ?? null),
      findMany: jest.fn().mockResolvedValue(rows.tasks ?? []),
    },
  } as unknown as PrismaService;
}

describe('hierarchy ids minted by the server', () => {
  it('names a level by the first letters of its name', () => {
    expect(codeOf('Checkout & payments')).toBe('CHE');
    expect(codeOf('🚀 2fa')).toBe('FA');
    expect(codeOf('')).toBe('');
  });

  it('gives an epic the number after the highest, not after the count', async () => {
    const id = await mintEpicHierarchyId(
      client({ epics: [{ hierarchyId: 'ECOM-EPIC-01' }, { hierarchyId: 'ECOM-EPIC-07' }] }),
      'p1',
    );
    expect(id).toBe('ECOM-EPIC-08');
  });

  it('names a requirement by its project, client requirement, epic and itself', async () => {
    const full = await mintRequirementHierarchyId(
      client({
        epic: { name: 'Checkout', requirementId: 'cr1' },
        clientRequirement: { title: 'Shoppers can pay' },
        requirementCount: 3,
      }),
      { projectId: 'p1', title: 'Card form', epicId: 'e1' },
    );
    expect(full).toBe('ECOM-SHO-CHE-CAR-04');
    const standalone = await mintRequirementHierarchyId(client({}), { projectId: 'p1', title: 'Search' });
    expect(standalone).toBe('ECOM-SEA-01');
  });

  it("numbers a child requirement after its parent's other children", async () => {
    const id = await mintRequirementHierarchyId(
      client({
        requirement: { hierarchyId: 'ECOM-SEA-01' },
        requirementSiblings: [{ hierarchyId: 'ECOM-SEA-01.01' }, { hierarchyId: 'ECOM-SEA-01.03' }],
      }),
      { projectId: 'p1', title: 'Filters', parentRequirementId: 'f1' },
    );
    expect(id).toBe('ECOM-SEA-01.04');
  });

  it('puts a task under its requirement, or on the project, numbered past the highest', async () => {
    const tasks = [{ hierarchyId: 'ECOM-T02' }, { hierarchyId: 'ECOM-T09' }];
    const underRequirement = await mintTaskHierarchyId(
      client({ requirement: { hierarchyId: 'ECOM-SEA-01' }, tasks }),
      { projectId: 'p1', title: 'Build the index', functionalRequirementId: 'f1' },
    );
    expect(underRequirement).toBe('ECOM-SEA-01-BUI-10');
    const onProject = await mintTaskHierarchyId(client({ tasks }), { projectId: 'p1', title: 'Readme' });
    expect(onProject).toBe('ECOM-T10');
  });

  it("numbers a sub-task after its parent's", async () => {
    const id = await mintTaskHierarchyId(
      client({ task: { hierarchyId: 'ECOM-T10' }, tasks: [{ hierarchyId: 'ECOM-T10.01' }] }),
      { projectId: 'p1', title: 'Intro', parentTaskId: 't10' },
    );
    expect(id).toBe('ECOM-T10.02');
  });
});
