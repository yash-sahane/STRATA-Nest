'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useTodayAttendance, useCheckIn, useCheckOut } from '@/hooks/use-attendance';
import {
  getCurrentDate,
  getCurrentTime,
  getGreeting,
  formatTime,
  calculateWorkHours,
  isLateCheckIn,
  calculateLateMinutes,
  isSaturdayWorking,
  getWeekOfMonth,
  isWeekend,
  ATTENDANCE_STATUS,
} from '@/lib/attendance-utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { InlineLoader } from '@/components/ui/page-loader';
import { Clock, CheckCircle, XCircle, AlertCircle, Calendar, Loader2 } from 'lucide-react';
import { logger } from '@/lib/logger';

export function AttendanceWidget() {
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();

  // Use currentWorkspace as single source of truth for workspace id
  const workspaceId = currentWorkspace?.id || '';

  const { data: todayAttendance, isLoading } = useTodayAttendance(user?.id || '', workspaceId);
  const checkInMutation = useCheckIn();
  const checkOutMutation = useCheckOut();

  const [currentTime, setCurrentTime] = useState(getCurrentTime());
  const [currentDate] = useState(getCurrentDate());
  const [workDuration, setWorkDuration] = useState<string>('0h 0m');

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(getCurrentTime());

      // Update work duration if checked in
      if (todayAttendance && todayAttendance.checkInTime && !todayAttendance.checkOutTime) {
        const hours = calculateWorkHours(todayAttendance.checkInTime, new Date().toISOString());
        const totalMinutes = Math.floor(hours * 60);
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        setWorkDuration(`${h}h ${m}m`);
      }
    }, 60000); // Update every minute

    return () => clearInterval(timer);
  }, [todayAttendance]);

  // Calculate work duration on mount and when attendance changes
  useEffect(() => {
    if (todayAttendance && todayAttendance.checkInTime && !todayAttendance.checkOutTime) {
      const hours = calculateWorkHours(todayAttendance.checkInTime, new Date().toISOString());
      const totalMinutes = Math.floor(hours * 60);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      setWorkDuration(`${h}h ${m}m`);
    } else if (todayAttendance && todayAttendance.workHours) {
      const totalMinutes = Math.floor(todayAttendance.workHours * 60);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      setWorkDuration(`${h}h ${m}m`);
    }
  }, [todayAttendance]);

  const handleCheckIn = async () => {
    if (!user?.id) return;

    if (!workspaceId) {
      logger.error('No workspace id found. Please join or create a workspace first.');
      return;
    }

    try {
      await checkInMutation.mutateAsync({
        userId: user.id,
        workspaceId: workspaceId,
      });
    } catch (error) {
      logger.error('Check-in error', { error });
    }
  };

  const handleCheckOut = async () => {
    if (!user?.id || !todayAttendance?.id) return;

    try {
      await checkOutMutation.mutateAsync({
        attendanceId: todayAttendance.id,
      });
    } catch (error) {
      logger.error('Check-out error', { error });
    }
  };

  // Determine current status
  const hasCheckedIn = todayAttendance && todayAttendance.checkInTime;
  const hasCheckedOut = todayAttendance && todayAttendance.checkOutTime;
  const isProcessing = checkInMutation.isPending || checkOutMutation.isPending;

  // Check if today is a weekend
  const todayIsWeekend = isWeekend(currentDate);
  const todayDay = new Date().getDay();
  const isSaturday = todayDay === 6;
  const weekOfMonth = getWeekOfMonth(currentDate);
  const saturdayIsWorking = isSaturday && isSaturdayWorking(currentDate);

  // Get status badge
  const getStatusBadge = () => {
    if (todayIsWeekend && !saturdayIsWorking) {
      return (
        <Badge variant="secondary" className="gap-1">
          <Calendar className="h-3 w-3" />
          Weekend
        </Badge>
      );
    }

    if (hasCheckedOut) {
      return (
        <Badge variant="default" className="gap-1 bg-green-600">
          <CheckCircle className="h-3 w-3" />
          Checked Out
        </Badge>
      );
    }

    if (hasCheckedIn) {
      const isLate = todayAttendance?.checkInTime && isLateCheckIn(todayAttendance.checkInTime);
      return (
        <Badge variant="default" className={`gap-1 ${isLate ? 'bg-orange-600' : 'bg-blue-600'}`}>
          <Clock className="h-3 w-3" />
          Checked In
          {isLate && ' - Late'}
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="gap-1">
        <XCircle className="h-3 w-3" />
        Not Checked In
      </Badge>
    );
  };

  // Get late arrival info
  const getLateInfo = () => {
    if (!todayAttendance?.checkInTime) return null;

    const lateMinutes = calculateLateMinutes(todayAttendance.checkInTime);
    if (lateMinutes > 0) {
      return (
        <div className="flex items-center gap-2 p-3 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-lg">
          <AlertCircle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
          <p className="text-sm text-orange-800 dark:text-orange-200">
            Late by {lateMinutes} minutes
          </p>
        </div>
      );
    }
    return null;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Attendance</CardTitle>
        </CardHeader>
        <CardContent>
          <InlineLoader />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>{getGreeting()}</CardTitle>
            <CardDescription>
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </CardDescription>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Working Day Info */}
        {isSaturday && (
          <div
            className={`p-3 rounded-lg border ${
              saturdayIsWorking
                ? 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800'
                : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700'
            }`}
          >
            <p className="text-sm font-medium">
              {saturdayIsWorking ? (
                <>
                  <span className="text-blue-700 dark:text-blue-300">📅 Working Saturday</span>
                  <span className="text-blue-600 dark:text-blue-400 ml-2">
                    (Week {weekOfMonth})
                  </span>
                </>
              ) : (
                <>
                  <span className="text-gray-700 dark:text-gray-300">Weekend</span>
                  <span className="text-gray-600 dark:text-gray-400 ml-2">
                    (Week {weekOfMonth})
                  </span>
                </>
              )}
            </p>
          </div>
        )}

        {/* Current Time */}
        <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">Current Time</span>
          </div>
          <span className="text-2xl font-bold">{currentTime}</span>
        </div>

        {/* Check-in/Check-out Times */}
        {hasCheckedIn && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Check In</p>
              <p className="text-lg font-semibold">
                {todayAttendance.checkInTime ? formatTime(todayAttendance.checkInTime) : '-'}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Check Out</p>
              <p className="text-lg font-semibold">
                {todayAttendance.checkOutTime ? formatTime(todayAttendance.checkOutTime) : '-'}
              </p>
            </div>
          </div>
        )}

        {/* Work Duration */}
        {hasCheckedIn && (
          <div className="p-4 bg-primary/5 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Work Duration</span>
              <span className="text-xl font-bold text-primary">{workDuration}</span>
            </div>
          </div>
        )}

        {/* Late Arrival Warning */}
        {getLateInfo()}

        {/* Action Buttons */}
        <div className="space-y-2 pt-2">
          {!hasCheckedIn && !todayIsWeekend && (
            <Button
              onClick={handleCheckIn}
              disabled={isProcessing || todayIsWeekend}
              className="w-full"
              size="lg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Check In
                </>
              )}
            </Button>
          )}

          {hasCheckedIn && !hasCheckedOut && (
            <Button
              onClick={handleCheckOut}
              disabled={isProcessing}
              variant="outline"
              className="w-full"
              size="lg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <XCircle className="mr-2 h-4 w-4" />
                  Check Out
                </>
              )}
            </Button>
          )}

          {todayIsWeekend && !saturdayIsWorking && (
            <div className="text-center p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">
                You haven&apos;t checked in today. Click the button above to check in.
              </p>
            </div>
          )}

          {hasCheckedOut && (
            <div className="text-center p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                You've completed your work for today! 🎉
              </p>
            </div>
          )}
        </div>

        {/* Status Info */}
        {todayAttendance?.status && (
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium">
                {ATTENDANCE_STATUS[todayAttendance.status as keyof typeof ATTENDANCE_STATUS]}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
