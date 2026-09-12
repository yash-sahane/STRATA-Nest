'use client';

import { Calendar, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useLeaveAvailability } from '@/hooks/use-leave';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { getBalanceFieldDisplayName, type LeaveBalanceField } from '@/lib/leave-balance-mapper';
import { DEFAULT_LEAVE_ALLOCATION } from '@/lib/leave-utils';

/** Annual allocation each field is seeded with. `unpaidLeave` has none — it is
 *  a counter of unpaid days taken, so it shows a total instead of a remainder. */
const DEFAULT_ALLOCATIONS: Record<Exclude<LeaveBalanceField, 'unpaidLeave'>, number> = {
  paidLeave: DEFAULT_LEAVE_ALLOCATION.paidLeave,
  halfDay: DEFAULT_LEAVE_ALLOCATION.halfDay,
  compOff: DEFAULT_LEAVE_ALLOCATION.compOff,
};

/**
 * The signed-in member's own allowance. No `userId` prop: `/leave_balances/me`
 * is the only balance endpoint the browser can call, so a prop naming a subject
 * would have been a promise this component cannot keep.
 */
export function LeaveBalanceDisplay() {
  const { currentWorkspaceId } = useCurrentWorkspace();
  // Availability, not the raw row: a PENDING request is not debited until it is
  // approved, so this tab reported "Paid Leave 21 / 21 days — 0 used • Good"
  // for a member with 19 days already committed and 2 actually bookable.
  const {
    balance: leaveBalance,
    committed,
    isLoading,
  } = useLeaveAvailability(currentWorkspaceId || undefined);

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-2 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!leaveBalance) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">No leave balance data available</p>
        </CardContent>
      </Card>
    );
  }

  // Balance fields from DB
  const balanceFields: LeaveBalanceField[] = ['paidLeave', 'unpaidLeave', 'halfDay', 'compOff'];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {balanceFields.map((field) => {
          const isCounter = field === 'unpaidLeave'; // days taken, not days left
          const value = leaveBalance[field] || 0;
          const total = isCounter ? 0 : DEFAULT_ALLOCATIONS[field];

          // What is left to BOOK, which is what a member actually wants to know:
          // the row still holds the days their pending requests have spoken for.
          const pending = isCounter ? 0 : committed[field];
          const remaining = Math.max(0, value - pending);
          const used = isCounter || field === 'compOff' ? value : Math.max(0, total - value); // compOff is earned
          // Clamped: a manager-raised or overdrawn balance must not push the
          // Progress bar outside its track. Pending days fill the bar too —
          // they are no longer available, they are just not spent yet.
          const utilization =
            isCounter || total === 0
              ? 0
              : Math.min(100, Math.max(0, Math.round(((used + pending) / total) * 100)));

          // Status calculation
          let status: 'low' | 'medium' | 'high' = 'high';
          if (!isCounter && field !== 'compOff') {
            const percentRemaining = total === 0 ? 100 : (remaining / total) * 100;
            if (percentRemaining < 20) status = 'low';
            else if (percentRemaining < 50) status = 'medium';
          }

          return (
            <Card key={field} className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {getBalanceFieldDisplayName(field)}
                </CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <div className="text-2xl font-bold">{isCounter ? used : remaining}</div>
                  <div className="text-sm text-muted-foreground">
                    {isCounter
                      ? 'days taken'
                      : `/ ${total} ${field === 'halfDay' ? 'sessions' : 'days'}`}
                  </div>
                </div>
                {!isCounter && field !== 'compOff' && (
                  <>
                    <Progress value={utilization} className="mt-3 h-2" />
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {used} used{pending > 0 ? ` • ${pending} pending` : ''} • {utilization}%
                      </span>
                      {status === 'low' && (
                        <Badge
                          variant="outline"
                          className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900"
                        >
                          <TrendingDown className="h-3 w-3 mr-1" />
                          Low
                        </Badge>
                      )}
                      {status === 'medium' && (
                        <Badge
                          variant="outline"
                          className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-900"
                        >
                          Medium
                        </Badge>
                      )}
                      {status === 'high' && remaining > 0 && (
                        <Badge
                          variant="outline"
                          className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-900"
                        >
                          <TrendingUp className="h-3 w-3 mr-1" />
                          Good
                        </Badge>
                      )}
                    </div>
                  </>
                )}
                {field === 'compOff' && (
                  <p className="mt-2 text-xs text-muted-foreground">Earned comp off days</p>
                )}
                {isCounter && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No limit on unpaid leave — this counts days already taken
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
