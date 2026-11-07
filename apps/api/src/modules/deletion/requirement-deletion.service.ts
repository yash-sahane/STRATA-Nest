import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, refreshDeliveryRollups } from '@strata/prisma';
import { writeAuditRow } from '../activity/audit-writer';
import type { Prisma, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { DeletionSideEffectsService, type DeletedEntity } from './deletion-side-effects.service';
import { collectDelete, collectUpdate, type TxLike } from './deletion.util';
import { assertDeletable } from './assert-deletable';

/** The roll-up after a delete is bookkeeping: a failure is logged, never the delete's. */
const rollupLog = new Logger('RequirementRollups');

interface FrNode {
  id: string;
  workspaceId: string;
  projectId: string;
  hierarchyId: string;
  /** Carried through the walk so every parent the cascade changes is refreshed. */
  epicId: string;
  clientRequirementId: string;
}

/** What the walk reads for each requirement it finds. */
const NODE_SELECT = {
  id: true,
  workspaceId: true,
  projectId: true,
  hierarchyId: true,
  epicId: true,
  clientRequirementId: true,
} as const;

/** Budget for the descendant walk: a delete must never turn into an unbounded
 *  traversal held open across a request. Both surface as a 409, so the caller
 *  gets the same "narrow the operation" affordance as the cascade block. */
const MAX_DESCENDANTS = 2000;
/** Matches `MAX_PARENT_DEPTH` in requirements.services.ts on purpose: at 20 the
 *  delete path refused shapes the create path happily builds, so a 25-level
 *  non-dotted `parentRequirementId` chain was undeletable in one call. */
const MAX_DEPTH = 50;

/** Names the blocking rows in the 409 so the UI can tell the user WHICH children to look at. */
function blockerList(nodes: FrNode[], max = 5): string {
  const shown = nodes.slice(0, max).map((n) => n.hierarchyId || n.id);
  return nodes.length > max ? `${shown.join(', ')}, …` : shown.join(', ');
}

/**
 * RequirementDeletionService — ClientRequirement / FunctionalRequirement
 * deletes with explicit cascade semantics:
 *
 * - Without `cascade`, a requirement that still has dependent FRs is NOT
 *   deleted — the caller gets a 409 with a clear message.
 * - With `cascade`, dependent FRs (recursive: `parentRequirementId` links and
 *   dotted `hierarchyId` children) are deleted in the same transaction.
 * - Tasks are never deleted here: tasks referencing a deleted FR are detached
 *   (`functionalRequirementId` -> ''), and epics referencing a deleted CR are
 *   detached (`requirementId` -> '').
 */
@Injectable()
export class RequirementDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly sideEffects: DeletionSideEffectsService,
  ) {}

  async deleteClientRequirement(user: User, id: string, cascade: boolean): Promise<void> {
    const cr = await this.prisma.clientRequirement.findUnique({ where: { id } });
    if (!cr) throw new NotFoundException('Not found.');
    // assertDeletable, not assertPermission: the pair (403 exists / 404 does
    // not) answered "does this id exist?" for somebody with no membership at
    // all. A stranger now gets 404; a member without the right still gets 403.
    await assertDeletable(this.access, user, cr.workspaceId, Permission.RequirementWrite);

    const workspaceId = cr.workspaceId;
    // Every cascade query is scoped to the workspace the permission was checked
    // against — a stray cross-workspace link must never widen the blast radius.
    const roots = await this.prisma.functionalRequirement.findMany({
      where: { clientRequirementId: id, workspaceId },
      select: NODE_SELECT,
      take: MAX_DESCENDANTS + 1, // bounded like the descendant walk below
    });
    if (roots.length > MAX_DESCENDANTS) {
      throw new ConflictException(
        `This client requirement has more than ${MAX_DESCENDANTS} linked functional requirements; delete them in smaller batches.`,
      );
    }
    if (roots.length && !cascade) {
      throw new ConflictException(
        `Cannot delete this client requirement: ${roots.length} linked functional requirement(s) exist (${blockerList(roots)}). Delete them first or retry with cascade=true.`,
      );
    }
    const removing = [...roots, ...(await this.collectDescendants(roots))];
    const frIds = removing.map((n) => n.id);
    const deleted: DeletedEntity[] = [];
    const detached: DeletedEntity[] = [];

    await this.prisma.$transaction(async (txc) => {
      const tx = txc as unknown as TxLike;
      if (frIds.length) {
        // collectUpdate, not a bare updateMany: `tasks` is a subscribed realtime
        // collection, and detaching silently left every other open board showing
        // a link to a requirement that no longer exists.
        await collectUpdate(
          tx, 'task', 'tasks',
          { functionalRequirementId: { in: frIds }, workspaceId },
          { functionalRequirementId: '' },
          detached, workspaceId,
        );
        await collectDelete(
          tx, 'functionalRequirement', 'functional_requirements', { id: { in: frIds } }, deleted, workspaceId,
        );
      }
      await collectUpdate(
        tx, 'epic', 'epics', { requirementId: id, workspaceId }, { requirementId: '' }, detached, workspaceId,
      );
      // The client's documents stay with the project.
      await collectUpdate(
        tx, 'uploadedFile', 'files', { clientRequirementId: id, workspaceId }, { clientRequirementId: '' },
        detached, workspaceId,
      );
      await tx.clientRequirement.deleteMany({ where: { id } }); // deleteMany → single explicit frame
      deleted.push({ collection: 'client_requirements', id, workspaceId });
    });

    this.sideEffects.emitUpdates(detached);
    this.sideEffects.emitDeletes(deleted);
    // The client requirement itself is gone; what it held still counted elsewhere.
    await this.refreshParentsOf(removing, id);
    // See EpicDeletionService: aggregate deletes bypass the CRUD base, and only
    // the root is recorded so a cascade cannot bury it.
    await writeAuditRow(this.prisma, {
      workspaceId,
      userId: user.id,
      entity: 'client_requirement',
      action: 'deleted',
      entityId: id,
      row: cr as unknown as Record<string, unknown>,
      extraMetadata: { cascadeRows: deleted.length },
    });
  }

  async deleteFunctionalRequirement(user: User, id: string, cascade: boolean): Promise<void> {
    const fr = await this.prisma.functionalRequirement.findUnique({ where: { id } });
    if (!fr) throw new NotFoundException('Not found.');
    // assertDeletable, not assertPermission: the pair (403 exists / 404 does
    // not) answered "does this id exist?" for somebody with no membership at
    // all. A stranger now gets 404; a member without the right still gets 403.
    await assertDeletable(this.access, user, fr.workspaceId, Permission.RequirementWrite);

    const workspaceId = fr.workspaceId;
    const descendants = await this.collectDescendants([fr]);
    if (descendants.length && !cascade) {
      throw new ConflictException(
        `Cannot delete this requirement: ${descendants.length} child requirement(s) depend on it (${blockerList(descendants)}). Delete them first or retry with cascade=true.`,
      );
    }
    const frIds = [id, ...descendants.map((n) => n.id)];
    const deleted: DeletedEntity[] = [];
    const detached: DeletedEntity[] = [];

    await this.prisma.$transaction(async (txc) => {
      const tx = txc as unknown as TxLike;
      await collectUpdate(
        tx, 'task', 'tasks',
        { functionalRequirementId: { in: frIds }, workspaceId },
        { functionalRequirementId: '' },
        detached, workspaceId,
      );
      await collectDelete(
        tx, 'functionalRequirement', 'functional_requirements', { id: { in: frIds } }, deleted, workspaceId,
      );
    });

    this.sideEffects.emitUpdates(detached);
    this.sideEffects.emitDeletes(deleted);
    await this.refreshParentsOf([fr, ...descendants]);
    // See EpicDeletionService: aggregate deletes bypass the CRUD base, and only
    // the root is recorded so a cascade cannot bury it.
    await writeAuditRow(this.prisma, {
      workspaceId,
      userId: user.id,
      entity: 'functional_requirement',
      action: 'deleted',
      entityId: id,
      row: fr as unknown as Record<string, unknown>,
      extraMetadata: { cascadeRows: deleted.length },
    });
  }

  /**
   * Every parent the deleted requirements leave behind: each one's epic loses
   * the work it counted for it, and each one's client requirement one of the
   * requirements it was waiting on. Each requirement's, not only the root's: a
   * descendant can sit under another epic or client requirement than the one
   * it hangs from, and a client requirement's cascade used to refresh nothing,
   * leaving its epics counting work that no longer existed.
   *
   * `gone` is a client requirement deleted in the same cascade — nothing to
   * refresh there. Bookkeeping after the commit: a failure is logged, never the
   * delete's.
   */
  private async refreshParentsOf(
    removed: ReadonlyArray<Pick<FrNode, 'epicId' | 'clientRequirementId'>>,
    gone?: string,
  ): Promise<void> {
    const epicIds = removed.map((node) => node.epicId).filter(Boolean);
    const clientRequirementIds = removed
      .map((node) => node.clientRequirementId)
      .filter((clientId) => clientId && clientId !== gone);
    if (epicIds.length === 0 && clientRequirementIds.length === 0) return;
    await refreshDeliveryRollups(
      this.prisma,
      { epicIds, clientRequirementIds },
      (error, kind, id) =>
        rollupLog.warn(`roll-up of ${kind} ${id} failed: ${(error as Error).message}`),
    );
  }

  /**
   * BFS over both child conventions: `parentRequirementId` (explicit link) and
   * dotted `hierarchyId` prefixes (legacy/generated trees), scoped to the
   * parent's workspace AND project.
   *
   * One query PER LEVEL, not per node: the old per-node loop issued a
   * `findMany` round trip for every requirement in the tree (400 sequential
   * queries for a CR with 400 FRs) before the transaction even opened, and it
   * ran on the non-cascade path too because the 409 needs the same list.
   * MAX_DESCENDANTS caps the total; MAX_DEPTH caps the levels and is held equal
   * to `FunctionalRequirementsService.MAX_PARENT_DEPTH` so that no tree the
   * create path admits is refused here.
   */
  private async collectDescendants(roots: FrNode[]): Promise<FrNode[]> {
    const seen = new Set(roots.map((r) => r.id));
    const found: FrNode[] = [];
    let frontier = roots;
    for (let depth = 0; frontier.length > 0; depth += 1) {
      if (depth >= MAX_DEPTH) {
        throw new ConflictException(
          `This requirement tree is deeper than ${MAX_DEPTH} levels; delete the lower levels first.`,
        );
      }
      // The frontier always shares one workspace+project (children are looked up
      // under the parent's), so a single scoped query covers the whole level.
      const byScope = new Map<string, FrNode[]>();
      for (const node of frontier) {
        const key = `${node.workspaceId}::${node.projectId}`;
        const bucket = byScope.get(key);
        if (bucket) bucket.push(node);
        else byScope.set(key, [node]);
      }
      const next: FrNode[] = [];
      for (const bucket of byScope.values()) {
        const or: Prisma.FunctionalRequirementWhereInput[] = [
          { parentRequirementId: { in: bucket.map((n) => n.id) } },
          ...bucket
            .filter((n) => n.hierarchyId)
            .map((n) => ({ hierarchyId: { startsWith: `${n.hierarchyId}.` } })),
        ];
        const children = await this.prisma.functionalRequirement.findMany({
          where: { workspaceId: bucket[0].workspaceId, projectId: bucket[0].projectId, OR: or },
          select: NODE_SELECT,
          take: MAX_DESCENDANTS + 1,
        });
        for (const child of children) {
          if (seen.has(child.id)) continue;
          seen.add(child.id);
          found.push(child);
          next.push(child);
        }
      }
      if (found.length > MAX_DESCENDANTS) {
        throw new ConflictException(
          `This requirement has more than ${MAX_DESCENDANTS} descendants; delete them in smaller batches.`,
        );
      }
      frontier = next;
    }
    return found;
  }
}
