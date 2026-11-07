'use client';

import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useAttendanceAnalytics } from '@/hooks/use-attendance';
import { useHolidaySet } from '@/hooks/use-holidays';
import { countWorkingDaysInMonth, getCurrentDate, getWorkingSaturdaysInMonth } from '@/lib/attendance-utils';
import { parseDateOnly } from '@/lib/utils/working-days';
import { plural } from '@/lib/plural';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
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
  // The business day's month by default — the app's today — not the browser's.
  const today = parseDateOnly(getCurrentDate());
  const currentYear = year ?? today.getFullYear();
  const currentMonth = month ?? today.getMonth();

  const workspaceId = currentWorkspace?.id || '';
  const { data: analytics, isLoading, isError, refetch } = useAttendanceAnalytics(
    user?.id || '',
    workspaceId,
    currentYear,
    currentMonth
  );

  // Public holidays are not working days — the count the rate is taken against.
  const { holidays } = useHolidaySet(workspaceId || undefined);
  const workingDays = countWorkingDaysInMonth(currentYear, currentMonth, holidays);
  const workingSaturdays = getWorkingSaturdaysInMonth(currentYear, currentMonth);
  // The shared helper, so there is one implementation of this rather than one
  // per file — which is how a dozen other sites ended up with none.
  const days = (count: number) => plural(count, 'day');

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
    if (rate >= 95) return 'text-success-text';
    if (rate >= 85) return 'text-info-text';
    if (rate >= 75) return 'text-warning-text';
    return 'text-destructive-text';
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
      <Card className="border-info/30 bg-info/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4 text-info-text" />
            <span className="text-foreground">Working Days Schedule</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-info-text">Total Working Days</span>
            <span className="font-semibold text-foreground">
              {days(workingDays)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-info-text">Working Saturdays</span>
            <span className="font-semibold text-foreground">
              {days(workingSaturdays.length)}
            </span>
          </div>
          <div className="pt-2 border-t border-info/30">
            <p className="text-xs text-info-text">
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
              {/* The primitive supplies the progressbar role and the value; a
                  bare pair of divs told a screen reader nothing. It clamps too,
                  so the explicit Math.min is no longer load-bearing. */}
              <Progress
                value={expectedDays === 0 ? 0 : attendanceRate}
                aria-label="Attendance rate this period"
                indicatorClassName="bg-linear-to-r from-green-500 to-green-600"
              />
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
              <div className="text-3xl font-bold text-info-text">{totalWorkHours.toFixed(1)}h</div>
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
                    <CheckCircle className="h-3 w-3 text-success-text" />
                    <span className="text-success-text">Meeting target</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3 w-3 text-warning-text" />
                    <span className="text-warning-text">Below 8h/day</span>
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
                    ? 'text-success-text'
                    : lateDays <= 2
                      ? 'text-warning-text'
                      : 'text-destructive-text'
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
                    className="bg-success/10 text-success-text border-success/30"
                  >
                    Excellent
                  </Badge>
                )}
                {getLateSeverity(lateDays) === 'warning' && (
                  <Badge
                    variant="outline"
                    className="bg-warning/10 text-warning-text border-warning/30"
                  >
                    Needs Improvement
                  </Badge>
                )}
                {getLateSeverity(lateDays) === 'error' && (
                  <Badge
                    variant="outline"
                    className="bg-destructive/10 text-destructive-text border-destructive/30"
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
                    ? 'text-success-text'
                    : absentDays <= 1
                      ? 'text-warning-text'
                      : 'text-destructive-text'
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
                    className="bg-success/10 text-success-text border-success/30"
                  >
                    Perfect Record
                  </Badge>
                )}
                {absentDays > 0 && absentDays <= 1 && (
                  <Badge
                    variant="outline"
                    className="bg-warning/10 text-warning-text border-warning/30"
                  >
                    Good
                  </Badge>
                )}
                {absentDays > 1 && (
                  <Badge
                    variant="outline"
                    className="bg-destructive/10 text-destructive-text border-destructive/30"
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
                <p className="text-2xl font-bold text-success-text">{analytics.presentDays}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Late Days</p>
                <p className="text-2xl font-bold text-warning-text">{analytics.lateDays}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Half Days</p>
                <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{analytics.halfDays}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Leave Days</p>
                <p className="text-2xl font-bold text-info-text">{analytics.leaveDays}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
