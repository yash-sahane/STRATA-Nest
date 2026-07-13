import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { generateId } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User } from '@prisma/client';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { BulkSaveDto, GeneratedNode, GeneratedTree } from './dto';
import { HierarchyIdService } from './hierarchy-id.service';

interface CrResult { id: string; hierarchyId: string }
interface EpicResult { id: string; hierarchyId: string; crCode: string; requirementId: string }
interface FrResult { id: string; hierarchyId: string; epicId: string }
interface TaskResult { id: string; hierarchyId: string }
interface BulkResult {
  clientRequirements: CrResult[];
  functionalRequirements: FrResult[];
  epics: EpicResult[];
  tasks: TaskResult[];
}

/** First index whose value deep-equals `item` (handles duplicate/byte-identical nodes in the input array). */
function firstIndexEqual(arr: GeneratedNode[], item: GeneratedNode): number {
  const target = JSON.stringify(item);
  return arr.findIndex((x) => JSON.stringify(x) === target);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * [bulk-save] — atomic CR→Epic→FR→Task creation with the frozen hierarchy-id
 * rules. Wrapped in a Prisma interactive transaction (all-or-nothing) and, when
 * an Idempotency-Key is supplied, retry-safe: a repeat with the same key returns
 * the stored response without rebuilding.
 */
@Injectable()
export class GenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly hierarchy: HierarchyIdService,
  ) {}

  async bulkSave(user: User, dto: BulkSaveDto, idempotencyKey?: string): Promise<unknown> {
    if (!dto.projectId || !dto.workspaceId) {
      throw new BadRequestException('projectId and workspaceId are required');
    }
    // Retry-safe: return the prior response for a known key.
    if (idempotencyKey) {
      const prior = await this.prisma.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
      if (prior) return prior.response;
    }

    // Authorization: caller must be a member of the workspace (admin bypasses).
    await this.access.assertMember(user, dto.workspaceId);

    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
    if (!project) throw new NotFoundException('Project not found');
    const workspace = await this.prisma.workspace.findUnique({ where: { id: dto.workspaceId } });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const projectCode = dto.projectCode || 'PROJ';
    const workspaceId = dto.workspaceId;
    const projectId = dto.projectId;
    const clientName = project.clientName || 'Client';
    const userName = user.name || '';
    const userId = dto.userId || String(user.id);
    const g: GeneratedTree = dto.generated ?? {};
    const H = this.hierarchy;

    const result = await this.prisma.$transaction(async (tx) => {
      const r: BulkResult = { clientRequirements: [], functionalRequirements: [], epics: [], tasks: [] };

      // ---- 1. Client Requirements ----
      const crs = g.clientRequirements ?? [];
      for (let i = 0; i < crs.length; i += 1) {
        const cr = crs[i];
        const crCode = H.extractChars(str(cr.title), 3) || 'CR';
        const hierarchyId = `${projectCode}-${crCode}-${H.pad2(i + 1)}`;
        const doc = await tx.clientRequirement.create({
          data: {
            id: generateId(),
            workspaceId,
            projectId,
            title: str(cr.title).slice(0, 500),
            description: str(cr.description),
            clientName,
            priority: (str(cr.priority) || 'MEDIUM').toUpperCase(),
            status: 'DRAFT',
            attachments: [] as Prisma.InputJsonValue,
            createdById: userId,
            createdByName: userName,
          },
        });
        r.clientRequirements.push({ id: doc.id, hierarchyId });
      }

      // ---- 2. Epics (round-robin linked to CRs) ----
      const epicSeqStart = (await tx.epic.count({ where: { projectId } })) + 1;
      const epics = g.epics ?? [];
      for (let i = 0; i < epics.length; i += 1) {
        const epic = epics[i];
        const linkedCr = r.clientRequirements.length
          ? r.clientRequirements[i % r.clientRequirements.length]
          : null;
        const crCode = linkedCr ? linkedCr.hierarchyId.split('-')[1] : 'CR';
        const epicCode = H.extractChars(str(epic.name), 3) || 'EP';
        const hierarchyId = `${projectCode}-${crCode}-${epicCode}-${H.pad2(epicSeqStart + i)}`;
        if (await tx.epic.findFirst({ where: { projectId, hierarchyId } })) continue;
        const doc = await tx.epic.create({
          data: {
            id: generateId(),
            workspaceId,
            projectId,
            requirementId: linkedCr?.id ?? '',
            hierarchyId,
            name: str(epic.name).slice(0, 500),
            description: str(epic.description),
            color: str(epic.color) || '#3b82f6',
            startDate: epic.startDate ? new Date(epic.startDate) : null,
            endDate: epic.endDate ? new Date(epic.endDate) : null,
            status: 'TODO',
            progress: 0,
            createdById: userId,
            createdByName: userName,
          },
        });
        r.epics.push({ id: doc.id, hierarchyId, crCode, requirementId: linkedCr?.id ?? '' });
      }

      // ---- 3. Functional Requirements (top-level, then children) ----
      const frSeqStart = (await tx.functionalRequirement.count({ where: { projectId } })) + 1;
      const allFrs = g.functionalRequirements ?? [];
      const topLevel = allFrs.filter((fr) => !fr.parentId);
      const frIdMap = new Map<string, string>();

      for (let i = 0; i < topLevel.length; i += 1) {
        const fr = topLevel[i];
        const linked = r.epics.length ? r.epics[i % r.epics.length] : null;
        const crCode = linked ? linked.hierarchyId.split('-')[1] : 'CR';
        const epicCode = linked ? linked.hierarchyId.split('-')[2] : 'EP';
        const frCode = H.extractChars(str(fr.title), 3) || 'FR';
        const hierarchyId = `${projectCode}-${crCode}-${epicCode}-${frCode}-${H.pad2(frSeqStart + i)}`;
        if (await tx.functionalRequirement.findFirst({ where: { projectId, hierarchyId } })) continue;
        const clientRequirementId =
          linked?.requirementId ||
          (r.clientRequirements.length ? r.clientRequirements[0].id : '');
        const doc = await tx.functionalRequirement.create({
          data: {
            id: generateId(),
            workspaceId,
            projectId,
            hierarchyId,
            epicId: linked?.id ?? '',
            clientRequirementId,
            title: str(fr.title).slice(0, 500),
            description: str(fr.description),
            complexity: (str(fr.complexity) || 'MEDIUM').toUpperCase(),
            status: 'DRAFT',
            reusable: false,
            tags: '',
            linkedProjectIds: '',
            createdById: userId,
            createdByName: userName,
          },
        });
        const originalIdx = firstIndexEqual(allFrs, fr);
        frIdMap.set(`fr-${originalIdx}`, doc.id);
        r.functionalRequirements.push({ id: doc.id, hierarchyId, epicId: linked?.id ?? '' });
      }

      // Children (parentId → parent's db id via fr-<originalIndex> key)
      for (const fr of allFrs) {
        if (!fr.parentId) continue;
        const parentDbId = frIdMap.get(fr.parentId);
        if (!parentDbId) continue;
        const parent = await tx.functionalRequirement.findUnique({ where: { id: parentDbId } });
        if (!parent) continue;
        const siblingCount = await tx.functionalRequirement.count({
          where: { projectId, hierarchyId: { startsWith: parent.hierarchyId + '.' } },
        });
        const childHierarchy = `${parent.hierarchyId}.${H.pad2(siblingCount + 1)}`;
        if (await tx.functionalRequirement.findFirst({ where: { projectId, hierarchyId: childHierarchy } })) continue;
        const doc = await tx.functionalRequirement.create({
          data: {
            id: generateId(),
            workspaceId,
            projectId,
            hierarchyId: childHierarchy,
            epicId: parent.epicId,
            clientRequirementId: parent.clientRequirementId,
            title: str(fr.title).slice(0, 500),
            description: str(fr.description),
            complexity: (str(fr.complexity) || 'MEDIUM').toUpperCase(),
            status: 'DRAFT',
            reusable: false,
            createdById: userId,
            createdByName: userName,
          },
        });
        r.functionalRequirements.push({ id: doc.id, hierarchyId: childHierarchy, epicId: parent.epicId });
      }

      // ---- 4. Tasks (round-robin linked to FRs) ----
      const taskSeqStart = (await tx.task.count({ where: { projectId } })) + 1;
      const tasks = g.tasks ?? [];
      for (let i = 0; i < tasks.length; i += 1) {
        const task = tasks[i];
        const linkedFr = r.functionalRequirements.length
          ? r.functionalRequirements[i % r.functionalRequirements.length]
          : null;
        const frId = linkedFr?.id ?? '';
        const epicId = linkedFr?.epicId ?? '';
        const taskCode = H.extractChars(str(task.title), 3) || 'TSK';
        const hierarchyId = `${projectCode}-${taskCode}-${H.pad2(taskSeqStart + i)}`;
        const doc = await tx.task.create({
          data: {
            id: generateId(),
            workspaceId,
            projectId,
            hierarchyId,
            functionalRequirementId: frId,
            epicId,
            title: str(task.title).slice(0, 500),
            description: str(task.description),
            status: 'BACKLOG',
            priority: (str(task.priority) || 'MEDIUM').toUpperCase(),
            createdById: userId,
            createdByName: userName,
            estimatedHours: task.estimatedHours ?? null,
          },
        });
        r.tasks.push({ id: doc.id, hierarchyId });
      }

      return r;
    });

    const response = { success: true, ...result };
    if (idempotencyKey) {
      await this.prisma.idempotencyKey.create({
        data: { key: idempotencyKey, response: response as unknown as Prisma.InputJsonValue },
      });
    }
    return response;
  }
}
