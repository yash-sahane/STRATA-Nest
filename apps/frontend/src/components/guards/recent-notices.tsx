'use client';

import * as React from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useNotifications } from '@/hooks/use-notification';
import { formatDate } from '@/lib/utils';

/**
 * The person's latest notices, for a screen with no notification bell.
 *
 * Somebody removed from their only workspace, switched off, or declined lands
 * on the no-workspace card — which sits outside the dashboard shell, so the
 * notice that says what happened (it exists; the server wrote it) could not be
 * reached from it. Notifications are the recipient's whatever their membership,
 * so they can be read here.
 */
export function RecentNotices() {
  const { user } = useAuth();
  const { data: notices = [] } = useNotifications(user?.id);
  // Not the invitation notices: a waiting invitation is on this same card with
  // its Accept and Decline (PendingInvitations), and its notice repeated it below,
  // telling the reader to answer it "on your Workspaces page" — a page this
  // screen exists because they cannot reach. A withdrawn one keeps its own notice.
  const latest = notices
    .filter((notice) => String(notice.type ?? '').toUpperCase() !== 'WORKSPACE_INVITATION')
    .slice(0, 3);
  if (latest.length === 0) return null;
  return (
    <section aria-label="Recent notices" className="space-y-2 rounded-md border bg-muted/40 p-3">
      <h2 className="text-sm font-medium">What happened</h2>
      <ul className="space-y-2">
        {latest.map((notice) => (
          <li key={notice.id} className="text-sm">
            <p className="font-medium">{notice.title}</p>
            <p className="text-muted-foreground">{notice.message}</p>
            {notice.createdAt && (
              <p className="text-xs text-muted-foreground">{formatDate(notice.createdAt)}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
