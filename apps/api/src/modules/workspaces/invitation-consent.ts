import type { Prisma } from '@prisma/client';

/**
 * Whether somebody may be put straight into a workspace by somebody else, or
 * has to be asked first.
 *
 * Adding a person by e-mail, or by id, used to make them a member on the spot:
 * a manager of any workspace could put any account on the platform into theirs
 * — its notices in that person's inbox, the workspace in their switcher, a role
 * in it they had never agreed to — and they found out afterwards. Now an add
 * makes an INVITED membership, which grants nothing, and the person accepts or
 * declines it.
 *
 * Two adds are answers rather than questions, and still take effect at once:
 *  - the person had asked to join this workspace (a PENDING request): they
 *    have said yes already;
 *  - a platform administrator is acting: they run the installation and can
 *    already make any membership what they like.
 *
 * New accounts are invited like existing ones. Treating them differently would
 * tell whoever adds people which addresses already have an account here — the
 * roster would show one ACTIVE and the other INVITED — and the add form's
 * answer is deliberately the same for both.
 */
export async function joinsWithoutBeingAsked(
  db: Pick<Prisma.TransactionClient, 'joinRequest'>,
  callerIsPlatformAdmin: boolean,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  if (callerIsPlatformAdmin) return true;
  const asked = await db.joinRequest.count({ where: { workspaceId, userId, status: 'PENDING' } });
  return asked > 0;
}
