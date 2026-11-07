'use client';

import * as React from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm } from '@/components/providers/confirm-provider';
import {
  useCorrectAttendance,
  useDeleteAttendance,
  useFileAttendance,
  type TeamMemberAttendance,
} from '@/hooks/use-team-attendance';
import { addDays } from 'date-fns';
import { formatDateOnly, getBusinessTimeZone, parseDateOnly } from '@/lib/utils/working-days';

/** How the day is to be recorded: worked out from the times, or stated outright. */
type RecordAs = 'AUTO' | 'HALF_DAY' | 'ABSENT';

const pad = (n: number) => String(n).padStart(2, '0');

/*
 * Whose clock the times are on.
 *
 * The OFFICE's — the timezone attendance is filed in — not the browser's. The
 * first version of this dialog read and wrote times on the viewer's own clock,
 * pinned to the record's date. For a manager in the office's zone that is the
 * same thing. For one who is not, a 09:00 arrival in Kolkata showed as 23:30
 * in New York, and saving it — even to change a note — rebuilt it as 23:30 on
 * the record's date: a day later than it happened.
 */

/** The date and HH:MM a zone's wall clock shows for an instant. */
function zonedParts(instant: Date, timeZone: string | null): { date: string; clock: string } {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(instant);
      const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
      return {
        date: `${read('year')}-${read('month')}-${read('day')}`,
        clock: `${read('hour')}:${read('minute')}`,
      };
    } catch {
      // An unrecognised zone falls through to the viewer's own clock.
    }
  }
  return {
    date: formatDateOnly(instant),
    clock: `${pad(instant.getHours())}:${pad(instant.getMinutes())}`,
  };
}

/** The instant at which a zone's wall clock reads `date` `clock`. */
function zonedInstant(date: string, clock: string, timeZone: string | null): Date | null {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = clock.split(':').map(Number);
  if ([year, month, day, hours, minutes].some((n) => !Number.isFinite(n))) return null;
  // Read the target as if it were UTC, see what the zone shows at that instant,
  // and move by the difference. Twice, so a daylight-saving edge settles.
  const target = Date.UTC(year, month - 1, day, hours, minutes);
  let guess = target;
  for (let pass = 0; pass < 2; pass += 1) {
    const shown = zonedParts(new Date(guess), timeZone);
    const [sy, sm, sd] = shown.date.split('-').map(Number);
    const [sh, smin] = shown.clock.split(':').map(Number);
    guess += target - Date.UTC(sy, sm - 1, sd, sh, smin);
  }
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result;
}

/**
 * Correct a member's attendance for one day, file it when there is none, or
 * delete it.
 *
 * The API has always allowed an HR manager all three, and nothing in the product
 * reached any of them: a forgotten check-out stayed open forever, a stray one
 * closed the day at an hour, and the Today tab's own "an HR manager can file the
 * day for you" pointed at a screen that did not exist.
 */
export function AttendanceRecordDialog({
  workspaceId,
  date,
  member,
  onClose,
}: {
  workspaceId: string;
  /** 'YYYY-MM-DD' — the day being restated. */
  date: string;
  /** The roster row being edited, or null while the dialog is closed. */
  member: TeamMemberAttendance | null;
  onClose: () => void;
}) {
  const correct = useCorrectAttendance();
  const file = useFileAttendance();
  const remove = useDeleteAttendance();
  const confirm = useConfirm();

  const [checkIn, setCheckIn] = React.useState('');
  const [checkOut, setCheckOut] = React.useState('');
  const [recordAs, setRecordAs] = React.useState<RecordAs>('AUTO');
  const [notes, setNotes] = React.useState('');
  // The day the stored check-in actually falls on, on the office's clock.
  const [checkInDay, setCheckInDay] = React.useState(date);
  // The stored times as the dialog opened on them, and the day the check-out
  // really fell on: saved untouched (a note added, say), a record keeps its
  // real days rather than having them worked out again from two clock times.
  const [opened, setOpened] = React.useState<{
    checkIn: string;
    checkOut: string;
    checkOutDay: string;
  } | null>(null);

  const record = member?.attendance;
  const wasOnLeave = record?.status === 'ON_LEAVE';
  const zone = getBusinessTimeZone();

  // Reset to the row's own values each time a different row is opened.
  React.useEffect(() => {
    if (!member) return;
    const arrived = member.attendance?.checkInTime
      ? zonedParts(new Date(member.attendance.checkInTime), zone)
      : null;
    const left = member.attendance?.checkOutTime
      ? zonedParts(new Date(member.attendance.checkOutTime), zone)
      : null;
    setCheckIn(arrived?.clock ?? '');
    setCheckOut(left?.clock ?? '');
    setCheckInDay(arrived?.date ?? date);
    setOpened(
      arrived && left
        ? { checkIn: arrived.clock, checkOut: left.clock, checkOutDay: left.date }
        : null
    );
    // Always "work it out". This used to start on the record's CURRENT status
    // whenever that was Absent or Half day — which is what the server itself
    // files for a day closed too early. So the commonest correction, undoing a
    // stray check-out, sent that status back as an explicit override: the row
    // came out as nine hours worked and still Absent.
    setRecordAs('AUTO');
    setNotes(member.attendance?.notes ?? '');
  }, [member, date, zone]);

  /**
   * A check-out that reads EARLIER than the check-in is the next morning — a
   * shift that ran past midnight — exactly as the time-entry dialog reads an
   * overnight window. The day it lands on used to be the record's own date
   * whatever was typed, so 22:00 → 06:00 could not be entered at all ("has to
   * be after the check-in"), and the one correction a night shift needs was the
   * one this dialog refused. Once either time is changed the day is derived
   * from the two of them rather than kept from the stored row, so moving a
   * stored overnight check-out back before midnight lands it on the same day
   * again instead of 24 hours later.
   */
  const untouched = opened !== null && checkIn === opened.checkIn && checkOut === opened.checkOut;
  const checkOutDay = untouched && opened
    ? opened.checkOutDay
    : Boolean(checkIn && checkOut) && checkOut < checkIn
      ? formatDateOnly(addDays(parseDateOnly(checkInDay), 1))
      : checkInDay;
  const checkOutNextDay = Boolean(checkOut) && checkOutDay > checkInDay;
  const checkInAt = checkIn ? (zonedInstant(checkInDay, checkIn, zone)?.toISOString() ?? null) : null;
  const checkOutAt = checkOut
    ? (zonedInstant(checkOutDay, checkOut, zone)?.toISOString() ?? null)
    : null;
  const problem = !checkIn
    ? 'Enter the time this member checked in.'
    : !checkInAt || (checkOut && !checkOutAt)
      ? 'Enter the times as hours and minutes.'
      : checkOutAt && checkOutAt <= checkInAt
        ? 'Check-out has to be after the check-in.'
        : null;
  const busy = correct.isPending || file.isPending || remove.isPending;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member || problem || !checkInAt) return;
    const correction = {
      checkInTime: checkInAt,
      checkOutTime: checkOutAt,
      ...(recordAs === 'AUTO' ? {} : { status: recordAs }),
      notes: notes.trim(),
    };
    try {
      if (record) {
        await correct.mutateAsync({ attendanceId: record.id, ...correction });
      } else {
        await file.mutateAsync({ workspaceId, userId: member.userId, date, ...correction });
      }
      onClose();
    } catch {
      // the mutation surfaces the reason as a toast; keep the dialog open
    }
  };

  const handleDelete = async () => {
    if (!member || !record) return;
    const proceed = await confirm({
      title: 'Delete this attendance record?',
      description: wasOnLeave
        ? `${member.userName} will no longer show as on leave for this day. The leave request itself is not changed.`
        : `${member.userName} will have nothing filed for this day, and will count as absent if it was a working day.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!proceed) return;
    try {
      await remove.mutateAsync({ attendanceId: record.id });
      onClose();
    } catch {
      // toast already shown
    }
  };

  const dayLabel = parseDateOnly(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{record ? 'Correct attendance' : 'File attendance'}</DialogTitle>
          <DialogDescription>
            {member ? `${member.userName} — ${dayLabel}. ` : ''}
            Hours, lateness and status are worked out from the times you enter
            {zone ? `, which are on the office's clock (${zone}).` : '.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          {wasOnLeave && (
            <p className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">
              This day is filed as approved leave. Saving times here replaces the leave marker with
              a worked day.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="attendance-check-in">Check in</Label>
              <Input
                id="attendance-check-in"
                type="time"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="attendance-check-out">Check out</Label>
              <Input
                id="attendance-check-out"
                type="time"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                aria-describedby="attendance-check-out-hint"
              />
              <p id="attendance-check-out-hint" className="text-xs text-muted-foreground">
                {checkOutNextDay
                  ? // Said, because an earlier time is also what a mistyped one
                    // looks like: name the day it lands on.
                    `(next day) — ${parseDateOnly(checkOutDay).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}`
                  : 'Leave empty if the day is still open. A time before the check-in is the next day.'}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="attendance-record-as">Record as</Label>
            <Select value={recordAs} onValueChange={(v) => setRecordAs(v as RecordAs)}>
              <SelectTrigger id="attendance-record-as">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AUTO">Work it out from the times</SelectItem>
                <SelectItem value="HALF_DAY">Half day</SelectItem>
                <SelectItem value="ABSENT">Absent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="attendance-notes">Notes</Label>
            <Textarea
              id="attendance-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why the record is being changed"
              maxLength={500}
            />
          </div>
          {problem && checkIn !== '' && <p className="text-sm text-destructive-text">{problem}</p>}
          <DialogFooter className="gap-2 sm:justify-between">
            {record ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive-text hover:text-destructive-text"
                onClick={handleDelete}
                disabled={busy}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Record
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || problem !== null}>
                {correct.isPending || file.isPending
                  ? 'Saving...'
                  : record
                    ? 'Save Changes'
                    : 'File Attendance'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
