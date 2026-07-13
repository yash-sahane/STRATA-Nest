import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ArchiveService } from './archive.service';
import { DeletionSideEffectsService, type DeletedEntity, type FileRef } from './deletion-side-effects.service';

/** Workspace-scoped children deleted child-first (respecting NO ACTION FKs), with realtime slugs. */
const WS_SCOPED: Array<{ model: string; collection: string }> = [
  { model: 'task', collection: 'tasks' },
  { model: 'retrospective', collection: 'retrospectives' },
  { model: 'sprint', collection: 'sprints' },
  { model: 'epic', collection: 'epics' },
  { model: 'label', collection: 'labels' },
  { model: 'functionalRequirement', collection: 'functional_requirements' },
  { model: 'clientRequirement', collection: 'client_requirements' },
  { model: 'notification', collection: 'notifications' },
  { model: 'savedSearch', collection: 'saved_searches' },
  { model: 'holiday', collection: 'holidays' },
  { model: 'workspaceMember', collection: 'workspace_members' },
  { model: 'workspaceRole', collection: 'workspace_roles' },
  { model: 'inviteCode', collection: 'invite_codes' },
  { model: 'emailInvitation', collection: 'email_invitations' },
  { model: 'joinRequest', collection: 'join_requests' },
  { model: 'pendingWorkspaceAccess', collection: 'pending_workspace_access' },
];
/** Project-only children (no workspace_id column) — deleted by projectId. */
const PROJECT_SCOPED: Array<{ model: string; collection: string }> = [
  { model: 'kanbanColumn', collection: 'kanban_columns' },
  { model: 'gitCommit', collection: 'git_commits' },
  { model: 'gitHubIntegration', collection: 'github_integrations' },
  { model: 'gitLabIntegration', collection: 'gitlab_integrations' },
  { model: 'discordIntegration', collection: 'discord_integrations' },
];
/** HR + audit — ARCHIVED (snapshotted to retention_archive) before deletion. */
const ARCHIVED: Array<{ model: string; entityType: string; collection: string }> = [
  { model: 'attendance', entityType: 'attendance', collection: 'attendance' },
  { model: 'leaveRequest', entityType: 'leave_request', collection: 'leave_requests' },
  { model: 'leaveBalance', entityType: 'leave_balance', collection: 'leave_balances' },
  { model: 'timeEntry', entityType: 'time_entry', collection: 'time_entries' },
  { model: 'activityLog', entityType: 'activity_log', collection: 'activity_logs' },
];

/**
 * WorkspaceDeletionService — the ONLY correct way to delete a workspace
 * (workspace is the top aggregate root). A single-row `prisma.delete` would
 * either fail on FK constraints or orphan child rows, so deletion runs in two
 * zones instead.
 *
 * Zone 1 ($transaction, child-first): delete all aggregate rows + archive HR/audit.
 * Zone 2 (post-commit, idempotent): blobs, realtime frames, webhook, queue.
 */
@Injectable()
export class WorkspaceDeletionService {
  private readonly logger = new Logger('WorkspaceDeletion');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly archive: ArchiveService,
    private readonly sideEffects: DeletionSideEffectsService,
  ) {}

  async delete(user: User, workspaceId: string): Promise<void> {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Not found.');
    await this.access.assertPermission(user, workspaceId, Permission.WorkspaceDelete);

    // --- Zone 0: gather context needed by Zone 2 (before rows are gone) ---
    const projects = await this.prisma.project.findMany({ where: { workspaceId }, select: { id: true } });
    const projectIds = projects.map((p) => p.id);
    const fileRows = await this.prisma.uploadedFile.findMany({
      where: { workspaceId },
      select: { id: true, filePath: true },
    });
    const integrations = await this.gatherIntegrations(projectIds);

    const deleted: DeletedEntity[] = [];
    const P = this.prisma as unknown as Record<string, { findMany(a: unknown): Promise<Array<{ id: string }>>; deleteMany(a: unknown): Promise<{ count: number }> }>;

    // --- Zone 1: atomic delete, child-first ---
    await this.prisma.$transaction(
      async (tx) => {
        const T = tx as unknown as Record<string, { findMany(a: unknown): Promise<Array<{ id: string }>>; deleteMany(a: unknown): Promise<{ count: number }> }> & Record<string, unknown>;

        // 1. TaskComment (by task ids)
        const taskIds = (await T.task.findMany({ where: { workspaceId }, select: { id: true } })).map((t) => t.id);
        if (taskIds.length) {
          await this.collectDelete(T, 'taskComment', 'task_comments', { taskId: { in: taskIds } }, deleted, workspaceId);
        }
        // 2. Workspace-scoped children
        for (const { model, collection } of WS_SCOPED) {
          await this.collectDelete(T, model, collection, { workspaceId }, deleted, workspaceId);
        }
        // 3. Project-only children
        if (projectIds.length) {
          for (const { model, collection } of PROJECT_SCOPED) {
            await this.collectDelete(T, model, collection, { projectId: { in: projectIds } }, deleted, workspaceId);
          }
        }
        // 4. Archive HR/audit, then delete
        for (const { model, entityType, collection } of ARCHIVED) {
          const ids = await this.archive.archiveAndDelete(tx as never, {
            model,
            entityType,
            where: { workspaceId },
            workspaceId,
            reason: `workspace_deleted:${workspaceId}`,
          });
          for (const id of ids) deleted.push({ collection, id, workspaceId });
        }
        // 5. Files (rows now; blobs in Zone 2)
        await this.collectDelete(T, 'uploadedFile', 'files', { workspaceId }, deleted, workspaceId);
        // 6. Projects
        await this.collectDelete(T, 'project', 'projects', { workspaceId }, deleted, workspaceId);
        // 7. The workspace itself. deleteMany (not delete) so the write-hook does
        //    NOT also fire — exactly one frame is emitted explicitly instead.
        await T.workspace.deleteMany({ where: { id: workspaceId } });
        deleted.push({ collection: 'workspaces', id: workspaceId, workspaceId });
        void P;
      },
      { timeout: 60_000 },
    );

    // --- Zone 2: post-commit side effects (idempotent, failure-isolated) ---
    await this.sideEffects.deleteBlobs(fileRows as FileRef[]);
    this.sideEffects.revokeWebhooks(integrations);
    this.sideEffects.emitDeletes(deleted);
    await this.sideEffects.purgeGitJobs(projectIds);
    this.logger.log(`workspace ${workspaceId} deleted: ${deleted.length} rows removed`);
  }

  private async collectDelete(
    tx: Record<string, { findMany(a: unknown): Promise<Array<{ id: string }>>; deleteMany(a: unknown): Promise<{ count: number }> }>,
    model: string,
    collection: string,
    where: Record<string, unknown>,
    deleted: DeletedEntity[],
    workspaceId: string,
  ): Promise<void> {
    const rows = await tx[model].findMany({ where, select: { id: true } });
    if (!rows.length) return;
    await tx[model].deleteMany({ where });
    for (const r of rows) deleted.push({ collection, id: String(r.id), workspaceId });
  }

  private async gatherIntegrations(projectIds: string[]): Promise<Array<{ provider: string; projectId: string }>> {
    if (!projectIds.length) return [];
    const where = { projectId: { in: projectIds } };
    const [gh, gl, dc] = await Promise.all([
      this.prisma.gitHubIntegration.findMany({ where, select: { projectId: true } }),
      this.prisma.gitLabIntegration.findMany({ where, select: { projectId: true } }),
      this.prisma.discordIntegration.findMany({ where, select: { projectId: true } }),
    ]);
    return [
      ...gh.map((i) => ({ provider: 'GITHUB', projectId: i.projectId })),
      ...gl.map((i) => ({ provider: 'GITLAB', projectId: i.projectId })),
      ...dc.map((i) => ({ provider: 'DISCORD', projectId: i.projectId })),
    ];
  }
}
