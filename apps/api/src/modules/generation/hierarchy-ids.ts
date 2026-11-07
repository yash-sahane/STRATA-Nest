import type { PrismaService } from '@strata/prisma';

/**
 * The ids a task, an epic and a functional requirement are known by — minted
 * here, when a create does not bring one.
 *
 * Each screen used to mint its own before it created anything: it listed every
 * task (or requirement, or epic) in the project, fetched the parents it named,
 * worked out the next number and sent the result — three to five requests per
 * create, a second copy of the rules in the browser, and a number that two
 * people adding at once both proposed. The server takes the next free one when
 * it collides (createWithFreeHierarchyId), so all a create has to do now is
 * leave the id out.
 *
 * The shapes are the ones the app has always shown:
 *  - epic:         ECOM-EPIC-03
 *  - requirement:  ECOM-SHO-CHE-CRD-04  (project, client requirement, epic, own name, number),
 *                  shorter when it has no client requirement or epic; a child is its parent's id + `.01`
 *  - task:         <requirement id>-BLD-02 under a requirement, ECOM-T07 otherwise; a sub-task is its
 *                  parent's id + `.01`
 */

type Client = Pick<PrismaService, 'project' | 'task' | 'epic' | 'functionalRequirement' | 'clientRequirement'>;

/** The first `count` letters of a name, upper-cased: what a level of the chain is called in an id. */
export function codeOf(text: string | null | undefined, count = 3): string {
  return String(text ?? '')
    .replace(/[^a-zA-Z]/g, '')
    .slice(0, count)
    .toUpperCase();
}

const two = (n: number) => String(n).padStart(2, '0');

/** The highest number `pattern` captures among `ids` — so a sequence never goes back past one issued. */
function highest(ids: readonly (string | null | undefined)[], pattern: RegExp): number {
  return ids.reduce<number>((max, id) => {
    const n = Number.parseInt(pattern.exec(String(id ?? ''))?.[1] ?? '', 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
}

async function projectCode(prisma: Client, projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { shortCode: true, name: true } });
  return project?.shortCode || codeOf(project?.name, 4) || 'PRJ';
}

/** A child's id: its parent's, and the next number after its siblings'. */
function childOf(parentId: string, siblings: readonly (string | null | undefined)[]): string {
  const prefix = `${parentId}.`;
  const numbers = siblings.filter((id) => String(id ?? '').startsWith(prefix));
  return `${prefix}${two(highest(numbers, /\.(\d+)$/) + 1)}`;
}

export async function mintEpicHierarchyId(prisma: Client, projectId: string): Promise<string> {
  const code = await projectCode(prisma, projectId);
  const epics = await prisma.epic.findMany({ where: { projectId }, select: { hierarchyId: true } });
  return `${code}-EPIC-${two(highest(epics.map((e) => e.hierarchyId), /-EPIC-(\d+)$/) + 1)}`;
}

export async function mintRequirementHierarchyId(
  prisma: Client,
  input: { projectId: string; title: string; epicId?: string; parentRequirementId?: string },
): Promise<string> {
  if (input.parentRequirementId) {
    const parent = await prisma.functionalRequirement.findUnique({
      where: { id: input.parentRequirementId },
      select: { hierarchyId: true },
    });
    if (parent?.hierarchyId) {
      const siblings = await prisma.functionalRequirement.findMany({
        where: { projectId: input.projectId, parentRequirementId: input.parentRequirementId },
        select: { hierarchyId: true },
      });
      return childOf(parent.hierarchyId, siblings.map((s) => s.hierarchyId));
    }
  }
  const code = await projectCode(prisma, input.projectId);
  const sequence = (await prisma.functionalRequirement.count({ where: { projectId: input.projectId } })) + 1;
  const epic = input.epicId
    ? await prisma.epic.findUnique({ where: { id: input.epicId }, select: { name: true, requirementId: true } })
    : null;
  const requirement = epic?.requirementId
    ? await prisma.clientRequirement.findUnique({ where: { id: epic.requirementId }, select: { title: true } })
    : null;
  const parts = [
    code,
    requirement ? codeOf(requirement.title) : '',
    epic ? codeOf(epic.name) : '',
    codeOf(input.title),
    two(sequence),
  ];
  return parts.filter(Boolean).join('-');
}

export async function mintTaskHierarchyId(
  prisma: Client,
  input: { projectId: string; title: string; functionalRequirementId?: string; parentTaskId?: string },
): Promise<string> {
  if (input.parentTaskId) {
    const parent = await prisma.task.findUnique({ where: { id: input.parentTaskId }, select: { hierarchyId: true } });
    if (parent?.hierarchyId) {
      const siblings = await prisma.task.findMany({
        where: { projectId: input.projectId, parentTaskId: input.parentTaskId },
        select: { hierarchyId: true },
      });
      return childOf(parent.hierarchyId, siblings.map((s) => s.hierarchyId));
    }
  }
  const topLevel = await prisma.task.findMany({
    where: { projectId: input.projectId, parentTaskId: '' },
    select: { hierarchyId: true },
  });
  const sequence = Math.max(topLevel.length, highest(topLevel.map((t) => t.hierarchyId), /-T?(\d+)$/)) + 1;
  const requirement = input.functionalRequirementId
    ? await prisma.functionalRequirement.findUnique({
        where: { id: input.functionalRequirementId },
        select: { hierarchyId: true },
      })
    : null;
  if (requirement?.hierarchyId) {
    return `${requirement.hierarchyId}-${codeOf(input.title) || two(sequence)}-${two(sequence)}`;
  }
  return `${await projectCode(prisma, input.projectId)}-T${two(sequence)}`;
}
