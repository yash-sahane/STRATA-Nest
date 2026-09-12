import { redirect } from 'next/navigation';

/**
 * Legacy standalone route. The workspace overview now lives in the `workspace`
 * tab of /analytics — the only analytics entry point in the navigation — so this
 * stub keeps old bookmarks and deep links working instead of maintaining a
 * second, divergent copy of the same dashboard.
 */
export default function WorkspaceAnalyticsRedirect() {
  redirect('/analytics?view=workspace');
}
