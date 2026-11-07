'use client';

import Link from 'next/link';
import { Archive } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useHasPermissionIn } from '@/hooks/use-permissions';
import { useIsProjectArchived } from '@/hooks/use-project';
import { Permission } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/**
 * Said at the top of every screen of an archived project: nothing in it can be
 * changed until it is un-archived, and where to do that.
 *
 * Archiving used to change one word on the project and nothing else, and the
 * screens went on offering every button they always had. The server now
 * refuses the change (see the API's project-archive), so the screens stop
 * offering it — and this says why the buttons are gone, rather than leaving
 * somebody to wonder what they lost permission to.
 */
export function ArchivedProjectBanner({
  projectId,
  archived: known,
  workspaceId,
  className,
}: {
  projectId?: string | null;
  /** For a page that holds the project itself, which may be in another workspace. */
  archived?: boolean;
  /** The project's workspace, when it is not necessarily the selected one. */
  workspaceId?: string;
  className?: string;
}) {
  const listed = useIsProjectArchived(projectId);
  const archived = known ?? listed;
  const { currentWorkspace } = useCurrentWorkspace();
  const { allowed: canUnarchive } = useHasPermissionIn(
    workspaceId ?? currentWorkspace?.id,
    Permission.MANAGE_PROJECT_SETTINGS,
  );
  if (!archived || !projectId) return null;
  return (
    <Alert role="status" className={cn('border-dashed', className)}>
      <Archive className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>Archived — read-only</AlertTitle>
      <AlertDescription className="text-muted-foreground">
        This project is archived, so nothing in it can be changed: no new work, no edits, no time
        logged against it.{' '}
        {canUnarchive ? (
          <Link href={`/projects/${projectId}/settings`} className="font-medium text-foreground underline underline-offset-4">
            Unarchive it in project settings
          </Link>
        ) : (
          'A manager can unarchive it.'
        )}
      </AlertDescription>
    </Alert>
  );
}
