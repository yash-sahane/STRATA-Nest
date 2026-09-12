import { redirect } from 'next/navigation';

/**
 * Legacy standalone route. Team performance now lives in the `team` tab of
 * /analytics — the only analytics entry point in the navigation — so this stub
 * keeps old bookmarks and deep links working instead of maintaining a second,
 * divergent copy of the same dashboard.
 */
export default function TeamAnalyticsRedirect() {
  redirect('/analytics?view=team');
}
