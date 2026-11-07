import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import {
    attendanceWindowStart,
    getCurrentDate,
    isWorkingDay,
} from '@/lib/attendance-utils';
import { useHolidays } from '@/hooks/use-holidays';
import type { HolidayDates } from '@/lib/utils/working-days';
import type { Attendance } from '@/types';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================

export interface TeamMemberAttendance {
    userId: string;
    userName: string;
    userEmail: string;
    userAvatar?: string;
    role: string;
    attendance?: {
        id: string;
        date: string;
        /** Absent on an ON_LEAVE marker row — that day has no real arrival. */
        checkInTime?: string;
        checkOutTime?: string;
        workHours?: number;
        status: string;
        lateMinutes?: number;
        notes?: string;
    };
    /**
      * UNKNOWN: the day is in the future, or predates this membership, so there
      * is nothing to report either way — as distinct from ABSENT, which is a
      * judgement about a day the person could have attended.
      */
    status: 'PRESENT' | 'ABSENT' | 'LATE' | 'ON_LEAVE' | 'WEEKEND' | 'HALF_DAY' | 'UNKNOWN';
}

/** A workspace_members row, as far as the roster below reads it. */
interface WorkspaceMemberRow {
    userId: string;
    /** The member's display name — the field the API sends (workspaces/mappers.ts). */
    name?: string;
    userName?: string;
    email: string;
    avatar?: string | null;
    userAvatar?: string;
    role?: string;
    joinedAt?: string;
}

export interface TeamAttendanceAnalytics {
    totalMembers: number;
    presentCount: number;
    absentCount: number;
    /** Members for whom this date carries no judgement — see status UNKNOWN. */
    unknownCount: number;
    /** Members who could have attended on this date — the rate's denominator. */
    expectedCount: number;
    lateCount: number;
    onLeaveCount: number;
    attendanceRate: number;
    averageWorkHours: number;
    totalWorkHours: number;
    /** False on Sundays and non-working Saturdays — the rate is not meaningful then. */
    isWorkingDay: boolean;
}

// ============================================================================
// Team Attendance Hooks
// ============================================================================

/**
 * Get today's attendance for all team members
 * Manager-only feature
 */
export function useTeamAttendance(workspaceId?: string, date?: string) {
    // A public holiday is not a working day, so nobody is 'ABSENT' on one.
    const { data: holidays = [] } = useHolidays(workspaceId);
    const targetDate = date || getCurrentDate();

    return useQuery({
        // `holidays` is part of the key: the queryFn closes over it, so without
        // it a cached roster keeps the pre-holiday WEEKEND/ABSENT split forever.
        queryKey: ['teamAttendance', workspaceId, targetDate, holidays],
        queryFn: async () => {
            if (!workspaceId) return [];

            // Fetch all workspace members (listAll: a single page silently
            // truncates the roster past 100 members and skews every counter)
            const membersResponse = await resources.listAll<WorkspaceMemberRow>('workspace_members', [
                query.equal('workspaceId', workspaceId),
                query.equal('status', 'ACTIVE'),
            ]
            );

            // Fetch attendance records for the date
            const attendanceResponse = await resources.listAll<Attendance>('attendance', [
                query.equal('workspaceId', workspaceId),
                query.equal('date', targetDate),
            ]
            );

            // Create a map of attendance by userId
            const attendanceMap = new Map<string, Attendance>();
            attendanceResponse.items.forEach((record) => {
                attendanceMap.set(record.userId, record);
            });

            const dateIsWorking = isWorkingDay(targetDate, holidays);
            // A date that has not happened cannot have absences. The picker
            // accepts any date, so without this the whole team read ABSENT nine
            // months out, with the card reporting "0% attendance rate" — a
            // number a manager could act on.
            const dateIsFuture = targetDate > getCurrentDate();

            // Combine member data with attendance
            const teamAttendance: TeamMemberAttendance[] = membersResponse.items.map((member) => {
                const attendance = attendanceMap.get(member.userId);

                // A persisted row always wins over the "no check-in ⇒ absent"
                // fallback — approving leave materialises an ON_LEAVE row, which
                // is how this hook can surface leave at all.
                // A day before this member joined is not a day they missed,
                // and a day in the future has not happened. Neither is an
                // absence.
                const beforeJoining =
                    attendanceWindowStart(targetDate, member.joinedAt) !== targetDate;
                let status: TeamMemberAttendance['status'] = !dateIsWorking
                    ? 'WEEKEND'
                    : dateIsFuture || beforeJoining
                      ? 'UNKNOWN'
                      : 'ABSENT';
                if (attendance) {
                    status = attendance.status as TeamMemberAttendance['status'];
                }
                const onLeave = status === 'ON_LEAVE';

                return {
                    userId: member.userId,
                    // `name` is what a workspace_members row carries. This read
                    // `userName` alone — a field the API never sends — so every
                    // person on Team Attendance was listed by email address,
                    // twice, under the same people the Team page shows by name.
                    userName: member.name || member.userName || member.email,
                    userEmail: member.email,
                    // The API sends `avatar`; `userAvatar` was read and never there.
                    userAvatar: member.avatar ?? member.userAvatar,
                    role: member.role || 'MEMBER',
                    attendance: attendance ? {
                        id: attendance.id,
                        date: attendance.date,
                        // An ON_LEAVE marker pins checkInTime to the day marker
                        // (UTC midnight) because the column is non-null; passing
                        // it on would render as a literal 12:00 AM arrival.
                        checkInTime: onLeave ? undefined : attendance.checkInTime,
                        checkOutTime: attendance.checkOutTime,
                        workHours: attendance.workHours,
                        status: attendance.status,
                        lateMinutes: attendance.lateMinutes,
                        notes: attendance.notes,
                    } : undefined,
                    status,
                };
            });

            return teamAttendance;
        },
        enabled: !!workspaceId,
        refetchInterval: 30000, // Refetch every 30 seconds for real-time updates
    });
}

/** Summarize the joined roster. Every counter comes from the SAME member list,
 *  so present + absent + on-leave always add up to the roster (subtracting two
 *  independently fetched cardinalities could even go negative). */
function summarizeTeamAttendance(
    team: TeamMemberAttendance[],
    date: string,
    holidays?: HolidayDates
): TeamAttendanceAnalytics {
    const totalMembers = team.length;
    // Nobody is expected on a day that has not happened, or before they joined,
    // so an UNKNOWN member is out of the denominator the same way somebody on
    // approved leave is.
    const unknownCount = team.filter((m) => m.status === 'UNKNOWN').length;
    const attended = team.filter(
        (m) => m.status === 'PRESENT' || m.status === 'LATE' || m.status === 'HALF_DAY'
    ).length;
    const lateCount = team.filter((m) => m.status === 'LATE').length;
    const onLeaveCount = team.filter((m) => m.status === 'ON_LEAVE').length;
    const absentCount = team.filter((m) => m.status === 'ABSENT').length;

    const totalWorkHours = team.reduce((sum, m) => sum + (m.attendance?.workHours || 0), 0);
    const withHours = team.filter((m) => (m.attendance?.workHours || 0) > 0).length;
    const averageWorkHours = withHours > 0 ? totalWorkHours / withHours : 0;

    // Members on approved leave are not expected in, so they are out of the
    // denominator rather than counted as a miss.
    const expected = Math.max(0, totalMembers - onLeaveCount - unknownCount);
    const dateIsWorking = isWorkingDay(date, holidays);

    return {
        totalMembers,
        unknownCount,
        presentCount: attended,
        absentCount,
        lateCount,
        onLeaveCount,
        // expected === 0 on a working day means nobody COULD have attended —
        // a future date, or a team who had all either joined later or are on
        // approved leave. A rate of 0% there reads as a team that failed to
        // show up, so callers are told the figure is unknown instead.
        expectedCount: expected,
        attendanceRate: dateIsWorking && expected > 0 ? Math.round((attended / expected) * 100) : 0,
        averageWorkHours: Math.round(averageWorkHours * 10) / 10,
        totalWorkHours: Math.round(totalWorkHours * 10) / 10,
        isWorkingDay: dateIsWorking,
    };
}

/**
 * Get team attendance analytics for a specific date
 * Manager-only feature
 *
 * Derived from useTeamAttendance's cache entry (same query key), so the cards
 * and the roster below them can never disagree, and the data is fetched once.
 */
export function useTeamAttendanceAnalytics(workspaceId?: string, date?: string) {
    const targetDate = date || getCurrentDate();
    const { data: team, ...rest } = useTeamAttendance(workspaceId, targetDate);
    // Same set the roster above was built with, so the header cards and the rows
    // beneath them cannot disagree about whether today is a working day.
    const { data: holidays = [] } = useHolidays(workspaceId);

    const analytics = useMemo(
        () => (team ? summarizeTeamAttendance(team, targetDate, holidays) : null),
        [team, targetDate, holidays]
    );

    return { ...rest, data: analytics };
}

// ============================================================================
// HR corrections
// ============================================================================

/**
 * What a correction may say about a day.
 *
 * `status` is only ever sent to OVERRIDE what the times work out to: the server
 * derives the hours, the lateness and the status from the two stamps, and an
 * explicit status is how a day is restated as an absence or a half day anyway.
 */
export interface AttendanceCorrection {
    /** ISO instant. */
    checkInTime: string;
    /** ISO instant, or null for a day that is still open. */
    checkOutTime: string | null;
    status?: 'ABSENT' | 'HALF_DAY';
    notes?: string;
}

/** Every cache a changed attendance row is read from: the member's own Today /
 *  Calendar / Analytics, the Team roster, and the monthly report. */
function invalidateAttendance(queryClient: QueryClient): void {
    queryClient.invalidateQueries({ queryKey: ['attendance'] });
    queryClient.invalidateQueries({ queryKey: ['teamAttendance'] });
    queryClient.invalidateQueries({ queryKey: ['teamAttendanceRange'] });
}

const reasonOf = (error: unknown) =>
    error instanceof Error && error.message ? error.message : 'Please try again.';

/** Restate a day that already has a record. */
export function useCorrectAttendance() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({
            attendanceId,
            ...correction
        }: AttendanceCorrection & { attendanceId: string }) =>
            resources.update('attendance', attendanceId, { ...correction }),
        onSuccess: () => {
            invalidateAttendance(queryClient);
            toast.success('Attendance corrected');
        },
        onError: (error: unknown) => {
            toast.error("Couldn't correct the record", { description: reasonOf(error) });
        },
    });
}

/** File a day for a member who has no record for it — a forgotten check-in, or
 *  work done on a day the Today tab offers no control for. */
export function useFileAttendance() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({
            checkOutTime,
            ...rest
        }: AttendanceCorrection & { workspaceId: string; userId: string; date: string }) =>
            resources.create('attendance', {
                ...rest,
                // The create route takes an absent check-out, not a null one.
                ...(checkOutTime ? { checkOutTime } : {}),
            }),
        onSuccess: () => {
            invalidateAttendance(queryClient);
            toast.success('Attendance filed');
        },
        onError: (error: unknown) => {
            toast.error("Couldn't file the record", { description: reasonOf(error) });
        },
    });
}

/** Remove a record outright, leaving the day with nothing filed. */
export function useDeleteAttendance() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ attendanceId }: { attendanceId: string }) => {
            await resources.remove('attendance', attendanceId);
        },
        onSuccess: () => {
            invalidateAttendance(queryClient);
            toast.success('Attendance record deleted');
        },
        onError: (error: unknown) => {
            toast.error("Couldn't delete the record", { description: reasonOf(error) });
        },
    });
}
