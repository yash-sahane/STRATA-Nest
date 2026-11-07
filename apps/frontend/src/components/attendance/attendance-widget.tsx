'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import {
  useTodayAttendance,
  useCheckIn,
  useCheckOut,
  useHolidayCalendar,
  useAttendanceStanding,
} from '@/hooks/use-attendance';
import {
  getCurrentDate,
  getCurrentTime,
  getGreeting,
  formatTime,
  formatMinutes,
  calculateWorkHours,
  getAttendanceStatusColor,
  getAttendanceStatusIcon,
  isSaturdayWorking,
  getWeekOfMonth,
  isWeekend,
  msUntilNextMinute,
  ATTENDANCE_STATUS,
} from '@/lib/attendance-utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { InlineLoader } from '@/components/ui/page-loader';
import { ErrorState } from '@/components/ui/error-state';
import { useConfirm } from '@/components/providers/confirm-provider';
import { Clock, CheckCircle, XCircle, AlertCircle, Calendar, Loader2 } from 'lucide-react';
import { logger } from '@/lib/logger';
import { parseDateOnly } from '@/lib/utils/working-days';

export function AttendanceWidget() {
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();

  // Use currentWorkspace as single source of truth for workspace id
  const workspaceId = currentWorkspace?.id || '';

  const {
    data: todayAttendance,
    isLoading,
    isError,
    refetch,
  } = useTodayAttendance(user?.id || '', workspaceId);
  const { data: standing } = useAttendanceStanding(user?.id || '', workspaceId);
  const checkInMutation = useCheckIn();
  const checkOutMutation = useCheckOut();
  const confirm = useConfirm();
  // The office is shut on a configured public holiday, exactly as it is at the
  // weekend. The Today tab used to consult `isWeekend` alone, so on a holiday it
  // sat under the banner "Working Saturday" and said nothing about the closure
  // at all.
  //
  // The named calendar rather than the bare date set: the banner has to be able
  // to say WHICH holiday, which is the only form a member can check against the
  // company calendar.
  const { data: holidayCalendar = [], isLoading: holidaysLoading } =
    useHolidayCalendar(workspaceId);

  const [currentTime, setCurrentTime] = useState(getCurrentTime());
  const [currentDate, setCurrentDate] = useState(getCurrentDate());
  const [workDuration, setWorkDuration] = useState<string>('0h 0m');

  // Approving leave persists an ON_LEAVE row whose checkInTime is pinned to the
  // day marker (the column is non-null). It is a leave marker, not an arrival:
  // treating it as a check-in would show a 12:00 AM start and a work duration
  // that grows all day. On an open day check-in stays available — the server
  // converts the marker in place for anyone who comes in anyway.
  const isOnLeave = todayAttendance?.status === 'ON_LEAVE';
  // The server classifies a day with too little logged time as ABSENT. Three
  // parts of this card used to disagree about that: a green "Checked Out" badge,
  // a celebratory banner, and "Status: Absent" immediately underneath.
  const isAbsentDay = todayAttendance?.status === 'ABSENT';

  // Update on every whole minute of the clock — not every sixty seconds from
  // whenever the card happened to mount, which left the clock up to a minute
  // behind: checked in at 21:24:10, the card showed "Check In 09:24 PM" under a
  // clock still reading the minute before. Also at once whenever the record
  // changes, so a check-in and the clock beside it always agree.
  useEffect(() => {
    const refresh = () => {
      setCurrentTime(getCurrentTime());
      setCurrentDate(getCurrentDate()); // pick up the midnight rollover

      // Update work duration if checked in
      if (todayAttendance && todayAttendance.status !== 'ON_LEAVE' && todayAttendance.checkInTime && !todayAttendance.checkOutTime) {
        const hours = calculateWorkHours(todayAttendance.checkInTime, new Date().toISOString());
        const totalMinutes = Math.floor(hours * 60);
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        setWorkDuration(`${h}h ${m}m`);
      }
    };
    refresh();
    // Re-aimed at the next minute boundary every time, so it cannot drift.
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, msUntilNextMinute());
    };
    schedule();

    return () => clearTimeout(timer);
  }, [todayAttendance]);

  // Calculate work duration on mount and when attendance changes
  useEffect(() => {
    if (todayAttendance?.status === 'ON_LEAVE') {
      setWorkDuration('0h 0m');
    } else if (todayAttendance && todayAttendance.checkInTime && !todayAttendance.checkOutTime) {
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
        workspaceId: workspaceId,
      });
    } catch (error) {
      logger.error('Check-in error', { error });
    }
  };

  const handleCheckOut = async () => {
    if (!user?.id || !todayAttendance?.id || !workspaceId) return;

    // There is one record a day and no way back in: a second check-in is
    // refused, so a stray click at 10:00 closed the day at ninety minutes and
    // only an HR manager could undo it. One question is cheaper than that.
    const proceed = await confirm({
      title: 'Check out for today?',
      description: `You've worked ${workDuration} so far. Checking out closes today's attendance — you can't check in again afterwards.`,
      confirmText: 'Check Out',
    });
    if (!proceed) return;

    try {
      await checkOutMutation.mutateAsync({
        workspaceId: workspaceId,
      });
    } catch (error) {
      logger.error('Check-out error', { error });
    }
  };

  // Determine current status
  const hasCheckedIn = !isOnLeave && todayAttendance && todayAttendance.checkInTime;
  const hasCheckedOut = !isOnLeave && todayAttendance && todayAttendance.checkOutTime;
  const isProcessing = checkInMutation.isPending || checkOutMutation.isPending;

  // Check if today is a weekend
  const todayIsWeekend = isWeekend(currentDate);
  const todayHoliday = holidayCalendar.find((h) => h.date === currentDate);
  const todayIsHoliday = Boolean(todayHoliday);
  // The business day's weekday, as `currentDate` is — the browser's clock may be on
  // another day (see lib/utils/working-days.ts).
  const todayDay = parseDateOnly(currentDate).getDay();
  const isSaturday = todayDay === 6;
  const weekOfMonth = getWeekOfMonth(currentDate);
  const saturdayIsWorking = isSaturday && isSaturdayWorking(currentDate);

  // Get status badge.
  //
  // Semantic variants, not raw 600-level fills: the fill was hard-coded while
  // `text-primary-foreground` flips with the theme, so "Checked Out" measured
  // 3.08:1 and "Checked In - Late" 3.43:1 in light and only passed in dark.
  // bg-success / bg-warning / bg-info carry foregrounds picked for both grounds.
  const getStatusBadge = () => {
    if (todayIsWeekend && !saturdayIsWorking) {
      return (
        <Badge variant="secondary" className="gap-1">
          <Calendar className="h-3 w-3" />
          Weekend
        </Badge>
      );
    }

    // Only while nothing has been filed for the day: somebody who came in
    // anyway is better served by their real check-in state, and the holiday
    // banner below still says the office was shut.
    if (todayIsHoliday && !hasCheckedIn && !isOnLeave) {
      return (
        <Badge variant="secondary" className="gap-1">
          <Calendar className="h-3 w-3" />
          Holiday
        </Badge>
      );
    }

    if (isOnLeave) {
      return (
        <Badge variant="info" className="gap-1">
          <Calendar className="h-3 w-3" />
          On Leave
        </Badge>
      );
    }

    if (hasCheckedOut) {
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle className="h-3 w-3" />
          Checked Out
        </Badge>
      );
    }

    if (hasCheckedIn) {
      // What the server filed, not a second opinion worked out here: the
      // workspace sets its own start time, and this used to grade the arrival
      // again against a hard-coded 08:30 on the browser's clock.
      const isLate = (todayAttendance?.lateMinutes ?? 0) > 0;
      return (
        <Badge variant={isLate ? 'warning' : 'info'} className="gap-1">
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

  // Get late arrival info — read the value the server persisted, so the banner
  // can never contradict the "Checked In" badge or the Team tab.
  const getLateInfo = () => {
    const lateMinutes = todayAttendance?.lateMinutes ?? 0;
    if (lateMinutes > 0) {
      return (
        <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/30 rounded-lg">
          <AlertCircle className="h-4 w-4 text-warning-text" />
          <p className="text-sm text-foreground">
            Late by {formatMinutes(lateMinutes)}
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

  // Without this the widget falls through to the "not checked in" state on a
  // failed request — and offers a Check In button that would create a second
  // record for a day the user may already have started.
  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Attendance</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorState
            title="Couldn't load today's attendance"
            description="We can't tell whether you're checked in, so the controls are hidden until this loads."
            onRetry={() => refetch()}
          />
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
        {/* Public Holiday — same colour language the calendar uses for a
            HOLIDAY cell, so the two tabs agree at a glance. Named, because
            "Public Holiday" alone is not something a member can check against
            the company calendar. Kept even once the day has been checked in
            for: it is why the row will be filed as holiday work. */}
        {todayHoliday && (
          <div className={`p-3 rounded-lg border ${getAttendanceStatusColor('HOLIDAY')}`}>
            {/* One template literal rather than JSX text carrying a &mdash;. SWC
                drops the single leading space of a text node that BOTH opens
                with an HTML entity and wraps onto a second line (the entity on
                one line keeps it, and so does a literal character in the same
                position), so this rendered as
                "QA Holiday 2026-09-02— the office is closed today". */}
            <p className="text-sm font-medium">
              {`${getAttendanceStatusIcon('HOLIDAY')} ${todayHoliday.name} — the office is closed today`}
            </p>
          </div>
        )}

        {/* Working Day Info — suppressed on a holiday, where "Working Saturday"
            would be affirmatively wrong. */}
        {isSaturday && !todayIsHoliday && (
          <div
            className={`p-3 rounded-lg border ${
              saturdayIsWorking
                ? 'bg-info/10 border-info/30'
                : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700'
            }`}
          >
            <p className="text-sm font-medium">
              {saturdayIsWorking ? (
                <>
                  <span className="text-info-text">📅 Working Saturday</span>
                  <span className="text-info-text ml-2">
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

        {/* A shift that began yesterday and is still running. Without this the
            card reads like a normal day and the check-in time looks wrong. */}
        {standing?.continuing && hasCheckedIn && !hasCheckedOut && (
          <div className="flex items-start gap-2 rounded-lg border p-3 text-sm">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p>
              You checked in yesterday and haven&apos;t checked out. This is still that shift
              &mdash; check out when you finish.
            </p>
          </div>
        )}

        {/* An earlier day that was never closed. Its owner cannot close it now
            — the hours are not theirs to state after the fact — but they are
            the one who knows it needs correcting, and until now nothing told
            them: the day simply dropped off this screen at midnight. */}
        {standing?.unclosed && (
          <div
            className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
            role="status"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" />
            <p>
              No check-out was recorded for{' '}
              <strong>
                {parseDateOnly(standing.unclosed.date).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                })}
              </strong>
              , so that day has no hours. Ask whoever manages attendance here to add the time
              you left.
            </p>
          </div>
        )}

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
          {/* Never suppressed. Gating this on the office being closed silently
              removed the only line that told somebody on approved leave what
              state their day was in — the weekend note below says nothing about
              their leave. Reworded on a WEEKEND instead, where the "check in if
              you end up working" half is untrue because this widget offers no
              control at all. On a holiday it is true again, so the plain
              wording stands. */}
          {isOnLeave && (
            <div className="p-4 bg-info/10 border border-info/30 rounded-lg">
              {/* Template literals for the same reason as the holiday banner
                  above: written as JSX text with a &mdash;, SWC left the next
                  line's indentation in the string, so this one read
                  "closed anyway —<18 spaces>there's nothing". */}
              <p className="text-sm text-foreground">
                {todayIsWeekend
                  ? `You're on approved leave today, and the office is closed anyway — there's nothing to check in for.`
                  : `You're on approved leave today. Check in only if you end up working — it will replace the leave marker for today.`}
              </p>
            </div>
          )}

          {/* Only the WEEKEND withholds this button. A holiday used to as well,
              mirroring a server refusal that has since been dropped: people do
              work holidays, check-in is their only self-service way to record
              one, and the server now files the day stamped `isHoliday` — kept
              out of the attendance rate on both sides of the fraction, and
              never graded late against a start nobody was expected to make.
              Hiding the control left whoever came in with no way to record the
              day at all, and an HR round trip for a row the server gets right
              by itself. */}
          {!hasCheckedIn && !todayIsWeekend && (
            <>
              <Button
                onClick={handleCheckIn}
                // Also while the holiday list is in flight: on a holiday this
                // button files something different from what it files on an
                // ordinary day, and the line below is what says so.
                disabled={isProcessing || holidaysLoading}
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

              {/* Why a live Check In button sits under a banner that has just
                  called the office closed, and what pressing it will file. */}
              {todayHoliday && (
                <p className="text-xs text-muted-foreground text-center">
                  {`Came in anyway? Checking in records today as holiday work — nobody was expected, so you won't be marked late and today won't count towards your attendance rate.`}
                </p>
              )}
            </>
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

          {/* The weekend's note alone. A holiday keeps its Check In button, so
              this would otherwise sit directly under a live control insisting
              there was nothing to check in for. Not while a real check-in is
              open either (a manager can file a day worked on a closed one, and
              this would contradict the Check Out button right above it), and
              not while the on-leave note above has already explained the day. */}
          {todayIsWeekend && !hasCheckedIn && !isOnLeave && (
            <div className="text-center p-4 bg-muted rounded-lg space-y-1">
              <p className="text-sm text-muted-foreground">
                Today is a weekend &mdash; enjoy your day off!
              </p>
              {/* The weekend is the one closed day this widget offers no control
                  on, so name the route that does exist for anyone who did work
                  it rather than leave them on a dead surface. */}
              <p className="text-xs text-muted-foreground">
                Worked anyway? An HR manager can file the day for you.
              </p>
            </div>
          )}

          {hasCheckedOut && (
            <div
              className={
                isAbsentDay
                  ? 'text-center p-4 bg-muted border rounded-lg'
                  : 'text-center p-4 bg-success/10 border border-success/30 rounded-lg'
              }
            >
              <p
                className={
                  isAbsentDay
                    ? 'text-sm font-medium text-foreground'
                    : 'text-sm font-medium text-foreground'
                }
              >
                {isAbsentDay
                  ? 'Checked out, but too little time was logged for the day to count as attended.'
                  : "You've completed your work for today! 🎉"}
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
