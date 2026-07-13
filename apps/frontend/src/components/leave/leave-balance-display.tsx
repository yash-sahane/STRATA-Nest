'use client';

import { Calendar, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useLeaveBalance } from '@/hooks/use-leave';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { getBalanceFieldDisplayName, type LeaveBalanceField } from '@/lib/leave-balance-mapper';

interface LeaveBalanceDisplayProps {
  userId: string;
}

// Default leave allocations
const DEFAULT_ALLOCATIONS: Record<LeaveBalanceField, number> = {
  paidLeave: 21,
  unpaidLeave: 999,
  halfDay: 12,
  compOff: 0,
};

export function LeaveBalanceDisplay({ userId }: LeaveBalanceDisplayProps) {
  const { currentWorkspaceId } = useCurrentWorkspace();
  const { data: leaveBalance, isLoading } = useLeaveBalance(userId, currentWorkspaceId || undefined);

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 w-24 bg-muted rounded"></div>
              <div className="h-4 w-4 bg-muted rounded"></div>
            </CardHeader>
            <CardContent>
              <div className="h-8 w-16 bg-muted rounded mb-2"></div>
              <div className="h-2 w-full bg-muted rounded"></div>
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
          const remainingUnits = leaveBalance[field] || 0;
          const totalUnits = DEFAULT_ALLOCATIONS[field];
          
          const remaining = remainingUnits;
          const total = totalUnits;
          
          const used = field === 'compOff' ? 0 : Math.max(0, total - remaining); // compOff is earned
          const utilization = field === 'unpaidLeave' || total === 0 ? 0 : Math.round((used / total) * 100);
          
          // Status calculation
          let status: 'low' | 'medium' | 'high' = 'high';
          if (field !== 'unpaidLeave' && field !== 'compOff') {
            const percentRemaining = total === 0 ? 100 : (remaining / total) * 100;
            if (percentRemaining < 20) status = 'low';
            else if (percentRemaining < 50) status = 'medium';
          }

          return (
            <Card key={field} className="hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {getBalanceFieldDisplayName(field)}
                </CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <div className="text-2xl font-bold">{remaining}</div>
                  <div className="text-sm text-muted-foreground">
                    / {field === 'unpaidLeave' ? '∞' : total} days
                  </div>
                </div>
                {field !== 'unpaidLeave' && field !== 'compOff' && (
                  <>
                    <Progress value={utilization} className="mt-3 h-2" />
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {used} used • {utilization}%
                      </span>
                      {status === 'low' && (
                        <Badge
                          variant="outline"
                          className="bg-red-50 text-red-700 border-red-200"
                        >
                          <TrendingDown className="h-3 w-3 mr-1" />
                          Low
                        </Badge>
                      )}
                      {status === 'medium' && (
                        <Badge
                          variant="outline"
                          className="bg-yellow-50 text-yellow-700 border-yellow-200"
                        >
                          Medium
                        </Badge>
                      )}
                      {status === 'high' && remaining > 0 && (
                        <Badge
                          variant="outline"
                          className="bg-green-50 text-green-700 border-green-200"
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
                {field === 'unpaidLeave' && (
                  <p className="mt-2 text-xs text-muted-foreground">No limit on unpaid leave</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
