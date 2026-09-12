import { Badge } from '@/components/ui/badge';
import { getLeaveStatusLabel, type LeaveStatus } from '@/lib/leave-utils';

/**
 * The one place a leave status turns into colour.
 *
 * `getLeaveStatusColor` hands back a raw palette tint (`bg-yellow-100
 * text-yellow-800`, hue ~55). The pending COUNT badge on the My Leaves tab is
 * the design system's `warning` token (amber, hue 38) — so the two signals for
 * the same fact, sitting about 40px apart on the same screen, were visibly
 * different colours. Going through the semantic variants makes them the same
 * token by construction, and keeps the fill/foreground pairing that was
 * measured for both themes:
 *
 *   warning     amber   8.39:1 light and dark  (`--warning-foreground` is near-black)
 *   success     green   4.63:1 light, 4.67:1 dark
 *   destructive red     4.62:1 light, 9.59:1 dark
 *   secondary   grey    16.5:1 light, 14.5:1 dark
 *
 * all against their own fill, all clearing AA for the badge's 12px semibold.
 */
const STATUS_VARIANT: Record<LeaveStatus, 'warning' | 'success' | 'destructive' | 'secondary'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'secondary',
};

export function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'secondary'}>{getLeaveStatusLabel(status)}</Badge>
  );
}
