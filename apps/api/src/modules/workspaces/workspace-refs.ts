import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '@strata/prisma';

/**
 * Cross-workspace reference guards.
 *
 * `projectId`, `epicId`, `sprintId` and friends are SOFT foreign keys — the
 * schema places no constraint on them — so a create that names a parent in
 * somebody else's workspace produced a cross-tenant row that no permission
 * check ever saw: the row was scoped to the workspace it declared, while every
 * list filtered by the parent (which is exactly what the frontend sends)
 * surfaced it to the wrong audience. Worse, the dangling reference made the
 * other workspace undeletable — its cascade hit a row it was not allowed to
 * touch and failed with "Invalid reference to a related record", permanently.
 *
 * Requirements already validated the pair; nothing else did. These live here so
 * every collection that carries a parent reference can use the same check.
 */
export async function assertProjectInWorkspace(
  prisma: PrismaService,
  projectId: string | undefined | null,
  workspaceId: string,
): Promise<void> {
  if (!projectId) return;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { workspaceId: true },
  });
  if (!project) throw new BadRequestException('Project not found.');
  if (project.workspaceId !== workspaceId) {
    throw new BadRequestException('Project does not belong to this workspace.');
  }
}

/** The models whose rows can be named as a parent from another collection. */
type LinkModel = 'epic' | 'sprint' | 'task' | 'clientRequirement' | 'functionalRequirement';

/**
 * A sibling link (an epic on a task, a sprint on a retrospective) must point at
 * a row in the SAME project — which, combined with `assertProjectInWorkspace`,
 * transitively pins it to the same workspace.
 */
export async function assertLinkInProject(
  prisma: PrismaService,
  model: LinkModel,
  label: string,
  linkId: string | undefined | null,
  projectId: string,
): Promise<void> {
  if (!linkId) return;
  const where = { id: linkId };
  const select = { projectId: true };
  const row =
    model === 'epic'
      ? await prisma.epic.findUnique({ where, select })
      : model === 'sprint'
        ? await prisma.sprint.findUnique({ where, select })
        : model === 'task'
          ? await prisma.task.findUnique({ where, select })
          : model === 'clientRequirement'
            ? await prisma.clientRequirement.findUnique({ where, select })
            : await prisma.functionalRequirement.findUnique({ where, select });
  if (!row) throw new BadRequestException(`${label} not found.`);
  if (row.projectId !== projectId) {
    throw new BadRequestException(`${label} belongs to a different project.`);
  }
}
