import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { DeletionSideEffectsService, type DeletedEntity, type FileRef } from './deletion-side-effects.service';
import { collectDelete, type TxLike } from './deletion.util';

/** Project-owned children, child-first (all keyed by projectId; comments by taskId). */
const PROJECT_CHILDREN: Array<{ model: string; collection: string }> = [
  { model: 'task', collection: 'tasks' },
  { model: 'retrospective', collection: 'retrospectives' },
  { model: 'sprint', collection: 'sprints' },
  { model: 'epic', collection: 'epics' },
  { model: 'kanbanColumn', collection: 'kanban_columns' },
  { model: 'label', collection: 'labels' },
  { model: 'functionalRequirement', collection: 'functional_requirements' },
  { model: 'clientRequirement', collection: 'client_requirements' },
  { model: 'gitCommit', collection: 'git_commits' },
  { model: 'gitHubIntegration', collection: 'github_integrations' },
  { model: 'gitLabIntegration', collection: 'gitlab_integrations' },
  { model: 'discordIntegration', collection: 'discord_integrations' },
];

/**
 * ProjectDeletionService — deletes a Project sub-aggregate. Two-zone. HR/audit
 * rows are workspace-scoped with only a soft (non-FK) `projectId`, so they are
 * NOT touched here — TimeEntry/Notification simply keep a dangling projectId
 * after the project is gone.
 */
@Injectable()
export class ProjectDeletionService {
  private readonly logger = new Logger('ProjectDeletion');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly sideEffects: DeletionSideEffectsService,
  ) {}

  async delete(user: User, projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Not found.');
    await this.access.assertPermission(user, project.workspaceId, Permission.ProjectDelete);
    const workspaceId = project.workspaceId;

    const fileRows = await this.prisma.uploadedFile.findMany({ where: { projectId }, select: { id: true, filePath: true } });
    const integrations = await this.gatherIntegrations(projectId);
    const deleted: DeletedEntity[] = [];

    await this.prisma.$transaction(
      async (txc) => {
        const tx = txc as unknown as TxLike;
        const taskIds = (await tx.task.findMany({ where: { projectId }, select: { id: true } })).map((t) => t.id);
        if (taskIds.length) {
          await collectDelete(tx, 'taskComment', 'task_comments', { taskId: { in: taskIds } }, deleted, workspaceId);
        }
        for (const { model, collection } of PROJECT_CHILDREN) {
          await collectDelete(tx, model, collection, { projectId }, deleted, workspaceId);
        }
        await collectDelete(tx, 'uploadedFile', 'files', { projectId }, deleted, workspaceId);
        // deleteMany (not delete): avoid a duplicate write-hook frame; emit once explicitly.
        await tx.project.deleteMany({ where: { id: projectId } });
        deleted.push({ collection: 'projects', id: projectId, workspaceId });
      },
      { timeout: 60_000 },
    );

    await this.sideEffects.deleteBlobs(fileRows as FileRef[]);
    this.sideEffects.revokeWebhooks(integrations);
    this.sideEffects.emitDeletes(deleted);
    await this.sideEffects.purgeGitJobs([projectId]);
    this.logger.log(`project ${projectId} deleted: ${deleted.length} rows removed`);
  }

  private async gatherIntegrations(projectId: string): Promise<Array<{ provider: string; projectId: string }>> {
    const where = { projectId, select: { projectId: true } } as never;
    const [gh, gl, dc] = await Promise.all([
      this.prisma.gitHubIntegration.findMany({ where: { projectId } }),
      this.prisma.gitLabIntegration.findMany({ where: { projectId } }),
      this.prisma.discordIntegration.findMany({ where: { projectId } }),
    ]);
    void where;
    return [
      ...gh.map(() => ({ provider: 'GITHUB', projectId })),
      ...gl.map(() => ({ provider: 'GITLAB', projectId })),
      ...dc.map(() => ({ provider: 'DISCORD', projectId })),
    ];
  }
}
