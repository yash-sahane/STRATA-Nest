import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { generateId } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { Prisma, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { BulkSaveDto, GeneratedNode, GeneratedTree } from './dto';
import {
  HierarchyIdService,
  MAX_HIERARCHY_ID_ATTEMPTS,
  bumpHierarchyId,
  isHierarchyIdConflict,
} from './hierarchy-id.service';

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

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A generated node's human label — CRs/FRs/tasks carry `title`, epics `name`. */
const nodeLabel = (node: GeneratedNode): string => str(node.title) || str(node.name);

/** Comparison form for every title match: lower-cased, whitespace collapsed. */
const labelKey = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Strips the packaging the model puts around a title it is quoting back at us
 * — "Epic 2: Beta Epic", "Beta Epic (auth)", "**Beta Epic**" — so the bare
 * title underneath can be matched exactly. Only ever applied AFTER an exact
 * match failed, so a title that genuinely contains a colon is unharmed.
 */
const undecorate = (value: string): string =>
  value
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^[^:]{0,24}:\s*/, '')
    .replace(/[*_"'`]/g, ' ');

/** A ref shorter than this is too weak to match a title by containment. */
const MIN_PARTIAL_REF = 3;

/**
 * Resolves one section's cross-references to an index into that section.
 *
 * The prompt tells the model to link by array index, and it mostly complies —
 * but it answers with a bare number as readily as a string, sometimes decorates
 * it ("epic-2", "#2"), and for `functionalRequirementIds` it usually writes the
 * referenced FR's TITLE instead. Titles are matched BEFORE the numeric form so
 * a name that merely ends in a digit ("OAuth2") is not mistaken for an index.
 *
 * The model also quotes a title back only APPROXIMATELY — "Beta" for "Beta
 * Epic", "Epic 2: Beta Epic" for the same thing — and every such near-miss used
 * to resolve to null, which the task loop could not tell apart from "named no
 * epic at all" and therefore handed to the global round-robin: the task was
 * filed under a DIFFERENT epic and given that epic's FR. So an undecorated
 * exact match and, last of all, an UNAMBIGUOUS partial match are tried too. A
 * partial that fits two nodes stays null: a guess is worse than no link.
 */
function refResolver(nodes: GeneratedNode[]): (ref: unknown) => number | null {
  const byLabel = new Map<string, number>();
  const labels: { key: string; index: number }[] = [];
  nodes.forEach((node, index) => {
    const key = labelKey(nodeLabel(node));
    if (!key) return;
    labels.push({ key, index });
    // First writer wins: two nodes sharing a label are indistinguishable, and
    // the model listed the intended one first.
    if (!byLabel.has(key)) byLabel.set(key, index);
  });
  const inRange = (index: number): number | null =>
    Number.isInteger(index) && index >= 0 && index < nodes.length ? index : null;
  /** The one node a partial ref fits — null when nothing or several fit. */
  const onlyPartial = (probe: string): number | null => {
    if (probe.length < MIN_PARTIAL_REF) return null;
    let found: number | null = null;
    for (const { key, index } of labels) {
      const fits =
        key.includes(probe) || (key.length >= MIN_PARTIAL_REF && probe.includes(key));
      if (!fits) continue;
      if (found !== null && found !== index) return null; // ambiguous
      found = index;
    }
    return found;
  };
  return (ref: unknown): number | null => {
    if (typeof ref === 'number') return inRange(ref);
    if (typeof ref !== 'string') return null;
    const trimmed = ref.trim();
    if (!trimmed) return null;
    const key = labelKey(trimmed);
    const byName = byLabel.get(key);
    if (byName !== undefined) return byName;
    const bare = labelKey(undecorate(trimmed));
    if (bare && bare !== key) {
      const byBareName = byLabel.get(bare);
      if (byBareName !== undefined) return byBareName;
    }
    const digits = /^[A-Za-z_#\s-]*?(\d+)$/.exec(trimmed);
    if (digits) {
      const byIndex = inRange(Number(digits[1]));
      if (byIndex !== null) return byIndex;
    }
    return onlyPartial(bare || key);
  };
}

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

  /**
   * First hierarchy id at or after `candidate` that is free in this project.
   *
   * Generated ids are sequence-based (`count + 1`), so a number freed by a
   * delete — or taken by a peer between two batches — collides. The previous
   * code SKIPPED the colliding node, which silently dropped it, orphaned every
   * child that addressed it as a parent, and shifted the round-robin link of
   * every task after it. Taking the next free id keeps the tree whole.
   */
  private async freeHierarchyId(
    isTaken: (hierarchyId: string) => Promise<unknown>,
    candidate: string,
  ): Promise<string> {
    let hierarchyId = candidate;
    for (let attempt = 0; attempt < MAX_HIERARCHY_ID_ATTEMPTS; attempt += 1) {
      if (!(await isTaken(hierarchyId))) return hierarchyId;
      hierarchyId = bumpHierarchyId(hierarchyId);
    }
    throw new ConflictException(
      `Could not allocate a free hierarchy id for this project (tried ${MAX_HIERARCHY_ID_ATTEMPTS} ids from "${candidate}").`,
    );
  }

  async bulkSave(user: User, dto: BulkSaveDto, idempotencyKey?: string): Promise<unknown> {
    if (!dto.projectId || !dto.workspaceId) {
      throw new BadRequestException('projectId and workspaceId are required');
    }
    // Authorization FIRST — the idempotency replay below returns created row ids,
    // so it must never run for a caller who could not have made the request.
    // Same permission as the individual create routes, not bare membership.
    await this.access.assertPermission(user, dto.workspaceId, Permission.RequirementWrite);

    // Retry-safe: return the prior response for a known key. The stored key is
    // namespaced by caller + workspace so one tenant's key can never replay
    // another tenant's response (the column is a free-form string @id).
    const storedKey = idempotencyKey && `${user.id}:${dto.workspaceId}:${idempotencyKey}`;
    if (storedKey) {
      const prior = await this.prisma.idempotencyKey.findUnique({ where: { key: storedKey } });
      if (prior) return prior.response;
    }

    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.workspaceId !== dto.workspaceId) {
      throw new BadRequestException('Project does not belong to this workspace');
    }
    const workspace = await this.prisma.workspace.findUnique({ where: { id: dto.workspaceId } });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const projectCode = dto.projectCode || project.shortCode || 'PROJ';
    const workspaceId = dto.workspaceId;
    const projectId = dto.projectId;
    const clientName = project.clientName || 'Client';
    const userName = user.name || '';
    const userId = String(user.id); // authorship is never client-supplied
    const g: GeneratedTree = dto.generated ?? {};
    const H = this.hierarchy;

    // The links the model actually drew, resolved once (they survive the retry
    // rebuild below). bulk-save used to DISCARD both and re-parent everything
    // round-robin by array position, so the saved tree bore no relation to the
    // preview the user confirmed: FRs landed under unrelated epics — and, since
    // the FR hierarchy id embeds its epic's code, the wrong parent was baked
    // into the human-facing id too — and tasks under epics they never named.
    const genEpics = g.epics ?? [];
    const genFrs = g.functionalRequirements ?? [];
    const resolveEpicRef = refResolver(genEpics);
    const resolveFrRef = refResolver(genFrs);
    // Epic→FR is declared from the epic side; invert it to fr index → epic index.
    const epicOfFr = new Map<number, number>();
    genEpics.forEach((epic, epicIdx) => {
      const refs: unknown[] = Array.isArray(epic.functionalRequirementIds)
        ? epic.functionalRequirementIds
        : [];
      for (const ref of refs) {
        const frIdx = resolveFrRef(ref);
        // An FR sits under exactly one epic; the first epic to claim it keeps it.
        if (frIdx !== null && !epicOfFr.has(frIdx)) epicOfFr.set(frIdx, epicIdx);
      }
    });

    const buildTree = async (tx: Prisma.TransactionClient): Promise<BulkResult> => {
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
      for (let i = 0; i < genEpics.length; i += 1) {
        const epic = genEpics[i];
        const linkedCr = r.clientRequirements.length
          ? r.clientRequirements[i % r.clientRequirements.length]
          : null;
        const crCode = linkedCr ? linkedCr.hierarchyId.split('-')[1] : 'CR';
        const epicCode = H.extractChars(str(epic.name), 3) || 'EP';
        const hierarchyId = await this.freeHierarchyId(
          (h) => tx.epic.findFirst({ where: { projectId, hierarchyId: h }, select: { id: true } }),
          `${projectCode}-${crCode}-${epicCode}-${H.pad2(epicSeqStart + i)}`,
        );
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
      // Keep each node's ORIGINAL index: children address their parent as
      // `fr-<index into g.functionalRequirements>`, and two byte-identical
      // generated nodes must not collapse onto the same map key.
      const topLevel = genFrs
        .map((fr, index) => ({ fr, index }))
        .filter((entry) => !entry.fr.parentId);
      const frIdMap = new Map<string, string>();

      // An FR no epic claimed still needs one — its hierarchy id embeds the epic
      // code — but round-robin by array position dropped it on whichever epic
      // the rotation reached, which is no longer disjoint from the epics that
      // DID claim FRs: the original failure mode ("an FR under an epic it has
      // nothing to do with") survived in that narrower form. Fill the emptiest
      // epic instead, so epics the model left empty absorb the strays first and
      // an already-claimed epic only receives one once every epic is populated.
      const epicLoad = new Array<number>(r.epics.length).fill(0);
      for (const [frIdx, epicIdx] of epicOfFr) {
        // Children inherit their parent's epic, so only top-level FRs count.
        if (!genFrs[frIdx]?.parentId && epicIdx < epicLoad.length) epicLoad[epicIdx] += 1;
      }
      const emptiestEpic = (): number => {
        let best = 0;
        for (let e = 1; e < epicLoad.length; e += 1) if (epicLoad[e] < epicLoad[best]) best = e;
        return best;
      };

      for (let i = 0; i < topLevel.length; i += 1) {
        const { fr, index: originalIdx } = topLevel[i];
        let ownerEpic = epicOfFr.get(originalIdx) ?? null;
        if (ownerEpic === null && r.epics.length) {
          ownerEpic = emptiestEpic();
          epicLoad[ownerEpic] += 1; // declared owners are already counted above
        }
        const linked = ownerEpic === null ? null : (r.epics[ownerEpic] ?? null);
        const crCode = linked ? linked.hierarchyId.split('-')[1] : 'CR';
        const epicCode = linked ? linked.hierarchyId.split('-')[2] : 'EP';
        const frCode = H.extractChars(str(fr.title), 3) || 'FR';
        const hierarchyId = await this.freeHierarchyId(
          (h) =>
            tx.functionalRequirement.findFirst({
              where: { projectId, hierarchyId: h },
              select: { id: true },
            }),
          `${projectCode}-${crCode}-${epicCode}-${frCode}-${H.pad2(frSeqStart + i)}`,
        );
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
        frIdMap.set(`fr-${originalIdx}`, doc.id);
        r.functionalRequirements.push({ id: doc.id, hierarchyId, epicId: linked?.id ?? '' });
      }

      // Children (parentId → parent's db id via fr-<originalIndex> key)
      for (const fr of genFrs) {
        if (!fr.parentId) continue;
        const parentDbId = frIdMap.get(fr.parentId);
        if (!parentDbId) continue;
        const parent = await tx.functionalRequirement.findUnique({ where: { id: parentDbId } });
        if (!parent) continue;
        const siblingCount = await tx.functionalRequirement.count({
          where: { projectId, hierarchyId: { startsWith: parent.hierarchyId + '.' } },
        });
        const childHierarchy = await this.freeHierarchyId(
          (h) =>
            tx.functionalRequirement.findFirst({
              where: { projectId, hierarchyId: h },
              select: { id: true },
            }),
          `${parent.hierarchyId}.${H.pad2(siblingCount + 1)}`,
        );
        const doc = await tx.functionalRequirement.create({
          data: {
            id: generateId(),
            workspaceId,
            projectId,
            hierarchyId: childHierarchy,
            epicId: parent.epicId,
            clientRequirementId: parent.clientRequirementId,
            parentRequirementId: parentDbId, // explicit link, not just the dotted hierarchyId
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

      // ---- 4. Tasks (under the epic the model named; round-robin only as fallback) ----
      const taskSeqStart = (await tx.task.count({ where: { projectId } })) + 1;
      const tasks = g.tasks ?? [];
      // Which FRs actually landed in each epic, so a task attaches to one of its
      // OWN epic's FRs instead of whatever the global rotation happens to point at.
      const frsByEpic = new Map<string, FrResult[]>();
      for (const fr of r.functionalRequirements) {
        if (!fr.epicId) continue;
        const list = frsByEpic.get(fr.epicId);
        if (list) list.push(fr);
        else frsByEpic.set(fr.epicId, [fr]);
      }
      // Per-epic cursor, so several tasks on one epic spread over its FRs.
      const frCursor = new Map<string, number>();
      for (let i = 0; i < tasks.length; i += 1) {
        const task = tasks[i];
        // Whether the model POINTED at an epic, which is not the same question
        // as whether we could resolve the pointer — and `epicId: 0` is a real
        // reference to the first epic, so truthiness is the wrong test.
        const namedAnEpic =
          typeof task.epicId === 'number' ||
          (typeof task.epicId === 'string' && task.epicId.trim() !== '');
        const epicIdx = resolveEpicRef(task.epicId);
        const linkedEpic = epicIdx === null ? null : (r.epics[epicIdx] ?? null);
        let linkedFr: FrResult | null = null;
        if (linkedEpic) {
          const ownFrs = frsByEpic.get(linkedEpic.id) ?? [];
          if (ownFrs.length) {
            const cursor = frCursor.get(linkedEpic.id) ?? 0;
            linkedFr = ownFrs[cursor % ownFrs.length];
            frCursor.set(linkedEpic.id, cursor + 1);
          }
        }
        // The global rotation is only for a task that named NO epic. When the
        // model DID name one that happens to own no FRs, borrowing an FR from
        // another epic would make Task.epicId and the epic of
        // Task.functionalRequirementId disagree — two different epics on one
        // row, which every breadcrumb next to an epic badge would show. The
        // honest answer is the epic the user saw in the preview and no FR;
        // `functionalRequirementId` is a soft FK that defaults to '' and the
        // task still lists under its project and epic.
        //
        // `namedAnEpic` is what closes the residual case: a ref we could not
        // resolve ("Beta" for "Beta Epic") looked identical to no ref at all,
        // so the rotation filed the task under whichever epic index `i` landed
        // on AND gave it that epic's FR — the cross-epic borrow, one step
        // removed. An unresolvable pointer means we do not know the parent;
        // leaving both links empty says so, where the rotation asserts a
        // parent the preview never showed.
        if (!linkedEpic && !namedAnEpic && r.functionalRequirements.length) {
          linkedFr = r.functionalRequirements[i % r.functionalRequirements.length];
        }
        const frId = linkedFr?.id ?? '';
        const epicId = linkedEpic?.id ?? linkedFr?.epicId ?? '';
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
    };

    // FunctionalRequirement now carries @@unique([projectId, hierarchyId]), so a
    // batch that probed for a free id before a CONCURRENT bulk-save committed
    // the same one is rejected on insert. The whole tree is transactional, so
    // that rollback is clean — rebuild it once against the now-committed rows
    // rather than handing the caller a 400 for someone else's race.
    let result: BulkResult;
    try {
      result = await this.prisma.$transaction(buildTree);
    } catch (error) {
      if (!isHierarchyIdConflict(error)) throw error;
      result = await this.prisma.$transaction(buildTree);
    }

    const response = { success: true, ...result };
    if (storedKey) {
      await this.prisma.idempotencyKey.create({
        data: { key: storedKey, response: response as unknown as Prisma.InputJsonValue },
      });
    }
    return response;
  }
}
