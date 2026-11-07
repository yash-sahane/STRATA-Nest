import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { generateId } from '@strata/common';
import { PrismaService, refreshDeliveryRollups } from '@strata/prisma';
import type { Prisma, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { BulkSaveDto, GeneratedNode, GeneratedTree } from './dto';
import { FR_COMPLEXITIES, FR_TYPES, REQUIREMENT_PRIORITIES } from '../requirements/dto';
import { TASK_PRIORITIES } from '../tasks/dto';
import { assertNotArchived } from '../projects/project-archive';
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
/** The rows a save wrote, as written — what the audit trail is made from. */
interface BulkRows {
  clientRequirements: Prisma.ClientRequirementCreateManyInput[];
  epics: Prisma.EpicCreateManyInput[];
  functionalRequirements: Prisma.FunctionalRequirementCreateManyInput[];
  tasks: Prisma.TaskCreateManyInput[];
}

/** What a generated row's audit entry says it came from (see GenerationService.recordTree). */
export const AI_GENERATION_SOURCE = 'ai_generation';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** How long the bulk-save transaction may run — see bulkSave. */
const BULK_SAVE_TIMEOUT_MS = 60_000;


/**
 * A value the model wrote, as one of the values this application has — or the
 * fallback when it is none of them.
 *
 * The model answers "Very High", "non-functional", "high priority". Stored as
 * written (the old `.toUpperCase()` and nothing else) those became values no
 * filter, badge or select knows — a requirement whose complexity matched no
 * option in its own edit form.
 */
function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T | ''): T | '' {
  const wanted = str(value).trim().toUpperCase().replace(/[\s-]+/g, '_');
  return (allowed as readonly string[]).includes(wanted) ? (wanted as T) : fallback;
}

/**
 * An epic's dates, as dates. The model writes them as text: one it could not
 * make a date of reached Postgres as Invalid Date and failed the whole save, and
 * an end before the start was stored although the epic form refuses it. A date
 * that is not one is left out; an end before the start is dropped.
 */
function epicDates(start: unknown, end: unknown): { startDate: Date | null; endDate: Date | null } {
  const asDate = (value: unknown): Date | null => {
    if (!value) return null;
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const startDate = asDate(start);
  const endDate = asDate(end);
  return { startDate, endDate: startDate && endDate && endDate < startDate ? null : endDate };
}

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
  private readonly logger = new Logger('Generation');

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
    // The permissions of the individual create routes, for each kind of row
    // the tree holds: requirements, and — when there are any — epics
    // (planning:write) and tasks (task:create). requirement:write alone let a
    // role that may create neither make both.
    await this.access.assertPermission(user, dto.workspaceId, Permission.RequirementWrite);
    if ((dto.generated?.epics ?? []).length) {
      await this.access.assertPermission(user, dto.workspaceId, Permission.PlanningWrite);
    }
    if ((dto.generated?.tasks ?? []).length) {
      await this.access.assertPermission(user, dto.workspaceId, Permission.TaskCreate);
    }

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
    // Nothing is filed into an archived project (see project-archive). A replay
    // of a save made before it was archived is answered above, and writes nothing.
    assertNotArchived(project);
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
    const resolveCrRef = refResolver(g.clientRequirements ?? []);
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

    // The parents the new tasks hang from. Their status and progress are sums
    // over their tasks, so they are summed again once the tree is committed.
    const parents = { functionalRequirementIds: new Set<string>(), epicIds: new Set<string>() };
    // The rows of the last tree built — the committed one, once the save returns.
    const written: { rows: BulkRows | null } = { rows: null };

    /**
     * The idempotency key is claimed INSIDE the transaction, first. Read before
     * and written after, two saves with one key at once (a retry while the first
     * is still running) both found nothing, both built a tree, and the second
     * then failed on the key — a 400 for a save whose duplicate was committed.
     * Claimed first, the second waits on the first's row and, when that commits,
     * fails the claim and is answered with the first one's response.
     */
    const claimKey = async (tx: Prisma.TransactionClient): Promise<void> => {
      if (!storedKey) return;
      await tx.idempotencyKey.create({
        data: { key: storedKey, response: {} as Prisma.InputJsonValue },
      });
    };

    const buildTree = async (tx: Prisma.TransactionClient): Promise<BulkResult> => {
      await claimKey(tx);
      const r: BulkResult = { clientRequirements: [], functionalRequirements: [], epics: [], tasks: [] };
      // A rebuilt tree (see the retry below) has new ids.
      parents.functionalRequirementIds.clear();
      parents.epicIds.clear();

      /*
       * Every row is built first and inserted at the end, one createMany per
       * table — the way a project clone is saved. Created one at a time, each
       * insert was announced by the realtime write hook as it happened, which
       * inside this transaction is BEFORE the commit: open screens refetched a
       * tree that was not there yet, or that a rollback meant never would be.
       * createMany is invisible to the hook, and the tree is announced once it
       * has committed (see announceTree).
       *
       * Until then this batch's rows are not in the table, so the free-id probes
       * consult the batch as well.
       */
      const rows: BulkRows = {
        clientRequirements: [],
        epics: [],
        functionalRequirements: [],
        tasks: [],
      };
      const minted = { epic: new Set<string>(), fr: new Set<string>(), task: new Set<string>() };
      const takenIn =
        (batch: Set<string>, probe: (hierarchyId: string) => Promise<unknown>) =>
        (hierarchyId: string): Promise<unknown> =>
          batch.has(hierarchyId) ? Promise.resolve(true) : probe(hierarchyId);

      // ---- 1. Client Requirements ----
      const crs = g.clientRequirements ?? [];
      for (let i = 0; i < crs.length; i += 1) {
        const cr = crs[i];
        const crCode = H.extractChars(str(cr.title), 3) || 'CR';
        const hierarchyId = `${projectCode}-${crCode}-${H.pad2(i + 1)}`;
        const id = generateId();
        rows.clientRequirements.push({
          id,
          workspaceId,
          projectId,
          title: str(cr.title).slice(0, 500),
          description: str(cr.description),
          clientName,
          priority: oneOf(REQUIREMENT_PRIORITIES, cr.priority, 'MEDIUM'),
          status: 'DRAFT',
          createdById: userId,
          createdByName: userName,
        });
        r.clientRequirements.push({ id, hierarchyId });
      }

      // ---- 2. Epics, under the client requirement each says it delivers ----
      const epicSeqStart = (await tx.epic.count({ where: { projectId } })) + 1;
      for (let i = 0; i < genEpics.length; i += 1) {
        const epic = genEpics[i];
        // The model's own link first; by position only when it gave none.
        const crIdx = resolveCrRef(epic.clientRequirementId);
        const linkedCr =
          crIdx !== null && r.clientRequirements[crIdx]
            ? r.clientRequirements[crIdx]
            : r.clientRequirements.length
              ? r.clientRequirements[i % r.clientRequirements.length]
              : null;
        const crCode = linkedCr ? linkedCr.hierarchyId.split('-')[1] : 'CR';
        const epicCode = H.extractChars(str(epic.name), 3) || 'EP';
        const hierarchyId = await this.freeHierarchyId(
          takenIn(minted.epic, (h) =>
            tx.epic.findFirst({ where: { projectId, hierarchyId: h }, select: { id: true } }),
          ),
          `${projectCode}-${crCode}-${epicCode}-${H.pad2(epicSeqStart + i)}`,
        );
        minted.epic.add(hierarchyId);
        const id = generateId();
        rows.epics.push({
          id,
          workspaceId,
          projectId,
          requirementId: linkedCr?.id ?? '',
          hierarchyId,
          name: str(epic.name).slice(0, 500),
          description: str(epic.description),
          color: str(epic.color) || '#3b82f6',
          ...epicDates(epic.startDate, epic.endDate),
          status: 'TODO',
          progress: 0,
          createdById: userId,
          createdByName: userName,
        });
        r.epics.push({ id, hierarchyId, crCode, requirementId: linkedCr?.id ?? '' });
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
      // What a child reads off its parent — the parent is in the batch, not the table.
      const frById = new Map<string, { hierarchyId: string; epicId: string; clientRequirementId: string }>();
      const probeFr = (h: string) =>
        tx.functionalRequirement.findFirst({ where: { projectId, hierarchyId: h }, select: { id: true } });

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
          takenIn(minted.fr, probeFr),
          `${projectCode}-${crCode}-${epicCode}-${frCode}-${H.pad2(frSeqStart + i)}`,
        );
        minted.fr.add(hierarchyId);
        const clientRequirementId =
          linked?.requirementId ||
          (r.clientRequirements.length ? r.clientRequirements[0].id : '');
        const id = generateId();
        rows.functionalRequirements.push({
          id,
          workspaceId,
          projectId,
          hierarchyId,
          epicId: linked?.id ?? '',
          clientRequirementId,
          title: str(fr.title).slice(0, 500),
          description: str(fr.description),
          // The preview shows a type, a priority and a complexity for every
          // generated requirement. Only the complexity used to be saved, so
          // "Confirm & Save All" turned a HIGH, TECHNICAL requirement into an
          // unprioritised functional one without a word.
          type: oneOf(FR_TYPES, fr.type, 'FUNCTIONAL'),
          priority: oneOf(REQUIREMENT_PRIORITIES, fr.priority, 'MEDIUM'),
          complexity: oneOf(FR_COMPLEXITIES, fr.complexity, 'MEDIUM'),
          status: 'DRAFT',
          createdById: userId,
          createdByName: userName,
        });
        frIdMap.set(`fr-${originalIdx}`, id);
        frById.set(id, { hierarchyId, epicId: linked?.id ?? '', clientRequirementId });
        r.functionalRequirements.push({ id, hierarchyId, epicId: linked?.id ?? '' });
      }

      // Children (parentId → parent's db id via fr-<originalIndex> key)
      for (const fr of genFrs) {
        if (!fr.parentId) continue;
        const parentDbId = frIdMap.get(fr.parentId);
        if (!parentDbId) continue;
        const parent = frById.get(parentDbId);
        if (!parent) continue;
        // Siblings already in the table, and those this batch has numbered.
        const prefix = `${parent.hierarchyId}.`;
        const siblingCount =
          (await tx.functionalRequirement.count({
            where: { projectId, hierarchyId: { startsWith: prefix } },
          })) + [...minted.fr].filter((h) => h.startsWith(prefix)).length;
        const childHierarchy = await this.freeHierarchyId(
          takenIn(minted.fr, probeFr),
          `${prefix}${H.pad2(siblingCount + 1)}`,
        );
        minted.fr.add(childHierarchy);
        const id = generateId();
        rows.functionalRequirements.push({
          id,
          workspaceId,
          projectId,
          hierarchyId: childHierarchy,
          epicId: parent.epicId,
          clientRequirementId: parent.clientRequirementId,
          parentRequirementId: parentDbId, // explicit link, not just the dotted hierarchyId
          title: str(fr.title).slice(0, 500),
          description: str(fr.description),
          // The preview shows a type, a priority and a complexity for every
          // generated requirement. Only the complexity used to be saved, so
          // "Confirm & Save All" turned a HIGH, TECHNICAL requirement into an
          // unprioritised functional one without a word.
          type: oneOf(FR_TYPES, fr.type, 'FUNCTIONAL'),
          priority: oneOf(REQUIREMENT_PRIORITIES, fr.priority, 'MEDIUM'),
          complexity: oneOf(FR_COMPLEXITIES, fr.complexity, 'MEDIUM'),
          status: 'DRAFT',
          createdById: userId,
          createdByName: userName,
        });
        r.functionalRequirements.push({ id, hierarchyId: childHierarchy, epicId: parent.epicId });
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
        let linkedEpic = epicIdx === null ? null : (r.epics[epicIdx] ?? null);
        let linkedFr: FrResult | null = null;
        // The requirement the model said the task implements, when it said one:
        // the epic then follows from it, so the two can never disagree.
        const frIdx = resolveFrRef(task.functionalRequirementId);
        const namedFrId = frIdx === null ? undefined : frIdMap.get(`fr-${frIdx}`);
        const namedFr = namedFrId ? r.functionalRequirements.find((fr) => fr.id === namedFrId) : undefined;
        if (namedFr) {
          linkedFr = namedFr;
          linkedEpic = r.epics.find((epic) => epic.id === namedFr.epicId) ?? linkedEpic;
        } else if (linkedEpic) {
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
        // `count + 1` repeats a number as soon as a task has been deleted, and
        // tasks carry the same unique index the requirements do: a taken id
        // failed the insert and, with it, the whole save.
        const hierarchyId = await this.freeHierarchyId(
          takenIn(minted.task, (h) =>
            tx.task.findFirst({ where: { projectId, hierarchyId: h }, select: { id: true } }),
          ),
          `${projectCode}-${taskCode}-${H.pad2(taskSeqStart + i)}`,
        );
        minted.task.add(hierarchyId);
        if (frId) parents.functionalRequirementIds.add(frId);
        if (epicId) parents.epicIds.add(epicId);
        const id = generateId();
        rows.tasks.push({
          id,
          workspaceId,
          projectId,
          hierarchyId,
          functionalRequirementId: frId,
          epicId,
          title: str(task.title).slice(0, 500),
          description: str(task.description),
          status: 'BACKLOG',
          priority: oneOf(TASK_PRIORITIES, task.priority, 'MEDIUM'),
          createdById: userId,
          createdByName: userName,
          estimatedHours: task.estimatedHours ?? null,
        });
        r.tasks.push({ id, hierarchyId });
      }

      // ---- 5. The whole tree, at once ----
      if (rows.clientRequirements.length) {
        await tx.clientRequirement.createMany({ data: rows.clientRequirements });
      }
      if (rows.epics.length) await tx.epic.createMany({ data: rows.epics });
      if (rows.functionalRequirements.length) {
        await tx.functionalRequirement.createMany({ data: rows.functionalRequirements });
      }
      if (rows.tasks.length) await tx.task.createMany({ data: rows.tasks });

      written.rows = rows;
      return r;
    };

    // FunctionalRequirement now carries @@unique([projectId, hierarchyId]), so a
    // batch that probed for a free id before a CONCURRENT bulk-save committed
    // the same one is rejected on insert. The whole tree is transactional, so
    // that rollback is clean — rebuild it once against the now-committed rows
    // rather than handing the caller a 400 for someone else's race.
    let result: BulkResult;
    const save = async (tx: Prisma.TransactionClient): Promise<BulkResult> => {
      const built = await buildTree(tx);
      if (storedKey) {
        await tx.idempotencyKey.update({
          where: { key: storedKey },
          data: { response: { success: true, ...built } as unknown as Prisma.InputJsonValue },
        });
      }
      return built;
    };
    // Prisma's interactive transaction gives up after 5 seconds by default. A
    // large generated plan probes a free hierarchy id for every node before it
    // writes, and on a busy database that ran past the limit and rolled back a
    // save whose work was done. Clone and the cascade deletes allow 60–120 s
    // for the same reason.
    const options = { timeout: BULK_SAVE_TIMEOUT_MS };
    try {
      result = await this.prisma.$transaction(save, options);
    } catch (error) {
      // The same key, saved by a request that got there first.
      if (storedKey) {
        const prior = await this.prisma.idempotencyKey.findUnique({ where: { key: storedKey } });
        if (prior) return prior.response;
      }
      if (!isHierarchyIdConflict(error)) throw error;
      result = await this.prisma.$transaction(save, options);
    }

    // The tree is saved; a failure to re-sum a parent is logged, not reported
    // as a failed save.
    await refreshDeliveryRollups(this.prisma, parents, (error, kind, id) =>
      this.logger.warn(`roll-up of ${kind} ${id} failed: ${(error as Error).message}`),
    );
    await this.announceTree(result);
    if (written.rows) await this.recordTree(user, workspaceId, written.rows);

    return { success: true, ...result };
  }

  /**
   * The audit trail of a saved tree, kept the way the create routes keep it: a
   * `created` entry for every requirement, epic and task, under the same action
   * and entity names, so the Activity screen lists a generated plan the way it
   * lists one typed in. A bulk save used to leave no trace at all — dozens of
   * rows appeared in a project and the trail said nothing had happened.
   *
   * Each entry is marked as generated (`metadata.source`). They are written
   * after the commit, as a clone's is, and best-effort, as every trail write is
   * (writeAuditRow): the plan is saved whether or not its trail is. One insert
   * for the lot, and one frame — every open trail refetches on any frame, so a
   * frame per entry would only have them refetch dozens of times.
   */
  private async recordTree(user: User, workspaceId: string, rows: BulkRows): Promise<void> {
    const entry = (entity: string, row: { id?: string; title?: string; name?: string }) => {
      const label = row.title || row.name || '';
      return {
        id: generateId(),
        workspaceId,
        userId: user.id,
        action: `${entity}.created`,
        entityType: entity,
        entityId: row.id ?? '',
        changes: {},
        metadata: { ...(label ? { label } : {}), source: AI_GENERATION_SOURCE },
      };
    };
    const entries = [
      ...rows.clientRequirements.map((row) => entry('client_requirement', row)),
      ...rows.epics.map((row) => entry('epic', row)),
      ...rows.functionalRequirements.map((row) => entry('functional_requirement', row)),
      ...rows.tasks.map((row) => entry('task', row)),
    ].filter((e) => e.entityId);
    if (entries.length === 0) return;
    try {
      const saved = await this.prisma.activityLog.createManyAndReturn({ data: entries });
      // createMany is invisible to the realtime write hook (PrismaService.announceWrite).
      const last = saved[saved.length - 1];
      if (last) this.prisma.announceWrite?.('ActivityLog', 'create', last);
    } catch (error) {
      this.logger.warn(`audit of the saved tree failed: ${(error as Error).message}`);
    }
  }

  /**
   * Tell the open screens about the committed tree. Re-read so the frames carry
   * what a later read returns, roll-ups included. The save has already
   * happened, so a failure here is logged rather than reported as a failed save.
   */
  private async announceTree(result: BulkResult): Promise<void> {
    const ids = (rows: Array<{ id: string }>) => ({ id: { in: rows.map((row) => row.id) } });
    const announce = async (model: string, count: number, read: () => Promise<unknown[]>) => {
      if (count === 0) return;
      for (const row of await read()) this.prisma.announceWrite?.(model, 'create', row);
    };
    try {
      await announce('ClientRequirement', result.clientRequirements.length, () =>
        this.prisma.clientRequirement.findMany({ where: ids(result.clientRequirements) }),
      );
      await announce('Epic', result.epics.length, () =>
        this.prisma.epic.findMany({ where: ids(result.epics) }),
      );
      await announce('FunctionalRequirement', result.functionalRequirements.length, () =>
        this.prisma.functionalRequirement.findMany({ where: ids(result.functionalRequirements) }),
      );
      await announce('Task', result.tasks.length, () =>
        this.prisma.task.findMany({ where: ids(result.tasks) }),
      );
    } catch (error) {
      this.logger.warn(`announcing the saved tree failed: ${(error as Error).message}`);
    }
  }
}
