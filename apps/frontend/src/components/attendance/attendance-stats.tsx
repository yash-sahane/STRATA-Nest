'use client';

import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useAttendanceAnalytics } from '@/hooks/use-attendance';
import { countWorkingDaysInMonth, getWorkingSaturdaysInMonth } from '@/lib/attendance-utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Clock, AlertCircle, Calendar, CheckCircle } from 'lucide-react';
import { InlineLoader } from '@/components/ui/page-loader';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';

interface AttendanceStatsProps {
  year?: number;
  month?: number;
}

export function AttendanceStats({ year, month }: AttendanceStatsProps) {
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const currentYear = year ?? new Date().getFullYear();
  const currentMonth = month ?? new Date().getMonth();

  const workspaceId = currentWorkspace?.id || '';
  const { data: analytics, isLoading, isError, refetch } = useAttendanceAnalytics(
    user?.id || '',
    workspaceId,
    currentYear,
    currentMonth
  );

  const workingDays = countWorkingDaysInMonth(currentYear, currentMonth);
  const workingSaturdays = getWorkingSaturdaysInMonth(currentYear, currentMonth);
  const days = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`;

  // Every figure below is a ratio of two workspace-scoped quantities, so the
  // analytics query refuses to run without one. Say that, rather than render a
  // full set of confident zeros.
  if (!workspaceId) {
    return (
      <EmptyState
        icon={Calendar}
        title="No workspace selected"
        description="Attendance figures are per workspace — pick one to see this month's numbers."
      />
    );
  }

  if (isLoading) {
    return <InlineLoader />;
  }

  if (isError) {
    return (
      <ErrorState
        title="Couldn't load your attendance stats"
        description="These figures could not be fetched. Showing nothing is safer than showing zeros."
        onRetry={() => refetch()}
      />
    );
  }

  const attendanceRate = analytics?.attendanceRate ?? 0;
  // With no completed working days in the window — somebody who joined this
  // month, or the 1st falling on a weekend — the rate is not 0%, it is not yet
  // knowable. A red "0%" over "0 of 0 days" was a judgement on nothing.
  const totalWorkHours = analytics?.totalWorkHours ?? 0;
  const averageWorkHours = analytics?.averageWorkHours ?? 0;
  const lateDays = analytics?.lateDays ?? 0;
  const absentDays = analytics?.absentDays ?? 0;
  // Days attended (present + late + half) over the working days that have
  // already elapsed — the exact fraction the percentage above represents.
  const attendedDays = analytics?.attendedDays ?? 0;
  const expectedDays = analytics?.expectedDays ?? 0;
  // Days whose hours are in the card below but whose day is in no count above.
  // Without this line the two cards sit side by side describing different day
  // sets — "7.8h average" over eight days next to a rate out of six.
  const uncountedDays = analytics?.uncountedDays ?? 0;

  // Determine attendance rate color
  const getRateColor = (rate: number) => {
    if (rate >= 95) return 'text-green-600 dark:text-green-400';
    if (rate >= 85) return 'text-blue-600 dark:text-blue-400';
    if (rate >= 75) return 'text-orange-600 dark:text-orange-400';
    return 'text-red-600 dark:text-red-400';
  };

  // Determine late days severity
  const getLateSeverity = (days: number) => {
    if (days === 0) return 'success';
    if (days <= 2) return 'warning';
    return 'error';
  };

  return (
    <div className="space-y-4">
      {/* Working Days Info */}
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-blue-900 dark:text-blue-100">Working Days Schedule</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-blue-700 dark:text-blue-300">Total Working Days</span>
            <span className="font-semibold text-blue-900 dark:text-blue-100">
              {days(workingDays)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-blue-700 dark:text-blue-300">Working Saturdays</span>
            <span className="font-semibold text-blue-900 dark:text-blue-100">
              {days(workingSaturdays.length)}
            </span>
          </div>
          <div className="pt-2 border-t border-blue-200 dark:border-blue-800">
            <p className="text-xs text-blue-700 dark:text-blue-300">
              Week 1 & 3 Saturdays are working days
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Statistics Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Attendance Rate */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Attendance Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div
                className={`text-3xl font-bold ${
                  expectedDays === 0 ? 'text-muted-foreground' : getRateColor(attendanceRate)
                }`}
              >
                {expectedDays === 0 ? '—' : `${attendanceRate}%`}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {expectedDays === 0
                    ? 'No completed working days in this period yet'
                    : `${attendedDays} of ${days(expectedDays)} so far this month`}
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-green-500 to-green-600 h-2 rounded-full transition-all"
                  style={{ width: `${expectedDays === 0 ? 0 : Math.min(attendanceRate, 100)}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Total Work Hours */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Work Hours</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{totalWorkHours.toFixed(1)}h</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Average: {averageWorkHours.toFixed(1)}h/day worked</span>
              </div>
              {uncountedDays > 0 && (
                <p className="text-xs text-muted-foreground">
                  Includes {days(uncountedDays)} outside the working calendar — a public
                  holiday, a non-working Saturday, or a day on approved leave. Those hours
                  count here, but the days are not in the rate.
                </p>
              )}
              <div className="flex items-center gap-1 text-xs">
                {averageWorkHours >= 8 ? (
                  <>
                    <CheckCircle className="h-3 w-3 text-green-600 dark:text-green-400" />
                    <span className="text-green-600 dark:text-green-400">Meeting target</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3 w-3 text-orange-600 dark:text-orange-400" />
                    <span className="text-orange-600 dark:text-orange-400">Below 8h/day</span>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Late Arrivals */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Late Arrivals</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div
                className={`text-3xl font-bold ${
                  lateDays === 0
                    ? 'text-green-600 dark:text-green-400'
                    : lateDays <= 2
                      ? 'text-orange-600 dark:text-orange-400'
                      : 'text-red-600 dark:text-red-400'
                }`}
              >
                {lateDays}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Out of {days(attendedDays)} attended</span>
              </div>
              <div>
                {getLateSeverity(lateDays) === 'success' && (
                  <Badge
                    variant="outline"
                    className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800"
                  >
                    Excellent
                  </Badge>
                )}
                {getLateSeverity(lateDays) === 'warning' && (
                  <Badge
                    variant="outline"
                    className="bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800"
                  >
                    Needs Improvement
                  </Badge>
                )}
                {getLateSeverity(lateDays) === 'error' && (
                  <Badge
                    variant="outline"
                    className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800"
                  >
                    Action Required
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Absences */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Absences</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div
                className={`text-3xl font-bold ${
                  absentDays === 0
                    ? 'text-green-600 dark:text-green-400'
                    : absentDays <= 1
                      ? 'text-orange-600 dark:text-orange-400'
                      : 'text-red-600 dark:text-red-400'
                }`}
              >
                {absentDays}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Out of {days(expectedDays)} so far this month</span>
              </div>
              <div>
                {absentDays === 0 && (
                  <Badge
                    variant="outline"
                    className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800"
                  >
                    Perfect Record
                  </Badge>
                )}
                {absentDays > 0 && absentDays <= 1 && (
                  <Badge
                    variant="outline"
                    className="bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800"
                  >
                    Good
                  </Badge>
                )}
                {absentDays > 1 && (
                  <Badge
                    variant="outline"
                    className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800"
                  >
                    Review Required
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Breakdown */}
      {analytics && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Present Days</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{analytics.presentDays}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Late Days</p>
                <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{analytics.lateDays}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Half Days</p>
                <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{analytics.halfDays}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Leave Days</p>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{analytics.leaveDays}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
