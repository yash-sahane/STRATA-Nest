'use client';

import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useAttendanceAnalytics } from '@/hooks/use-attendance';
import { countWorkingDaysInMonth, getWorkingSaturdaysInMonth } from '@/lib/attendance-utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Clock, AlertCircle, Calendar, CheckCircle } from 'lucide-react';
import { InlineLoader } from '@/components/ui/page-loader';

interface AttendanceStatsProps {
  year?: number;
  month?: number;
}

export function AttendanceStats({ year, month }: AttendanceStatsProps) {
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const currentYear = year ?? new Date().getFullYear();
  const currentMonth = month ?? new Date().getMonth();

  const { data: analytics, isLoading } = useAttendanceAnalytics(
    user?.id || '',
    currentWorkspace?.id || '',
    currentYear,
    currentMonth
  );

  const workingDays = countWorkingDaysInMonth(currentYear, currentMonth);
  const workingSaturdays = getWorkingSaturdaysInMonth(currentYear, currentMonth);

  if (isLoading) {
    return <InlineLoader />;
  }

  const attendanceRate = analytics?.attendanceRate ?? 0;
  const totalWorkHours = analytics?.totalWorkHours ?? 0;
  const averageWorkHours = analytics?.averageWorkHours ?? 0;
  const lateDays = analytics?.lateDays ?? 0;
  const presentDays = analytics?.presentDays ?? 0;
  const absentDays = analytics?.absentDays ?? 0;

  // Determine attendance rate color
  const getRateColor = (rate: number) => {
    if (rate >= 95) return 'text-green-600';
    if (rate >= 85) return 'text-blue-600';
    if (rate >= 75) return 'text-orange-600';
    return 'text-red-600';
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
      <Card className="border-blue-200 bg-blue-50/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4 text-blue-600" />
            <span className="text-blue-900">Working Days Schedule</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-blue-700">Total Working Days</span>
            <span className="font-semibold text-blue-900">{workingDays} days</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-blue-700">Working Saturdays</span>
            <span className="font-semibold text-blue-900">{workingSaturdays.length} days</span>
          </div>
          <div className="pt-2 border-t border-blue-200">
            <p className="text-xs text-blue-700">Week 1 & 3 Saturdays are working days</p>
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
              <div className={`text-3xl font-bold ${getRateColor(attendanceRate)}`}>
                {attendanceRate}%
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {presentDays} present / {workingDays} working days
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-green-500 to-green-600 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(attendanceRate, 100)}%` }}
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
              <div className="text-3xl font-bold text-blue-600">{totalWorkHours.toFixed(1)}h</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Average: {averageWorkHours.toFixed(1)}h/day</span>
              </div>
              <div className="flex items-center gap-1 text-xs">
                {averageWorkHours >= 8 ? (
                  <>
                    <CheckCircle className="h-3 w-3 text-green-600" />
                    <span className="text-green-600">Meeting target</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3 w-3 text-orange-600" />
                    <span className="text-orange-600">Below 8h/day</span>
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
                    ? 'text-green-600'
                    : lateDays <= 2
                      ? 'text-orange-600'
                      : 'text-red-600'
                }`}
              >
                {lateDays}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Out of {presentDays} present days</span>
              </div>
              <div>
                {getLateSeverity(lateDays) === 'success' && (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    Excellent
                  </Badge>
                )}
                {getLateSeverity(lateDays) === 'warning' && (
                  <Badge
                    variant="outline"
                    className="bg-orange-50 text-orange-700 border-orange-200"
                  >
                    Needs Improvement
                  </Badge>
                )}
                {getLateSeverity(lateDays) === 'error' && (
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
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
                    ? 'text-green-600'
                    : absentDays <= 1
                      ? 'text-orange-600'
                      : 'text-red-600'
                }`}
              >
                {absentDays}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Out of {workingDays} working days</span>
              </div>
              <div>
                {absentDays === 0 && (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    Perfect Record
                  </Badge>
                )}
                {absentDays > 0 && absentDays <= 1 && (
                  <Badge
                    variant="outline"
                    className="bg-orange-50 text-orange-700 border-orange-200"
                  >
                    Good
                  </Badge>
                )}
                {absentDays > 1 && (
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
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
                <p className="text-2xl font-bold text-green-600">{analytics.presentDays}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Late Days</p>
                <p className="text-2xl font-bold text-orange-600">{analytics.lateDays}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Half Days</p>
                <p className="text-2xl font-bold text-yellow-600">{analytics.halfDays}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Leave Days</p>
                <p className="text-2xl font-bold text-blue-600">{analytics.leaveDays}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
