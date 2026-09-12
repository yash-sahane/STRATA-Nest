import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { getCurrentDate, getMonthDateRange, isWorkingDay } from '@/lib/attendance-utils';
import { useHolidays } from '@/hooks/use-holidays';
import type { HolidayDates } from '@/lib/utils/working-days';

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
    };
    status: 'PRESENT' | 'ABSENT' | 'LATE' | 'ON_LEAVE' | 'WEEKEND' | 'HALF_DAY';
}

export interface TeamAttendanceAnalytics {
    totalMembers: number;
    presentCount: number;
    absentCount: number;
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
            const membersResponse = await resources.listAll('workspace_members', [
                query.equal('workspaceId', workspaceId),
                query.equal('status', 'ACTIVE'),
            ]
            );

            // Fetch attendance records for the date
            const attendanceResponse = await resources.listAll('attendance', [
                query.equal('workspaceId', workspaceId),
                query.equal('date', targetDate),
            ]
            );

            // Create a map of attendance by userId
            const attendanceMap = new Map();
            attendanceResponse.items.forEach((record: any) => {
                attendanceMap.set(record.userId, record);
            });

            const dateIsWorking = isWorkingDay(targetDate, holidays);

            // Combine member data with attendance
            const teamAttendance: TeamMemberAttendance[] = membersResponse.items.map((member: any) => {
                const attendance = attendanceMap.get(member.userId);

                // A persisted row always wins over the "no check-in ⇒ absent"
                // fallback — approving leave materialises an ON_LEAVE row, which
                // is how this hook can surface leave at all.
                let status: TeamMemberAttendance['status'] = dateIsWorking ? 'ABSENT' : 'WEEKEND';
                if (attendance) {
                    status = attendance.status as TeamMemberAttendance['status'];
                }
                const onLeave = status === 'ON_LEAVE';

                return {
                    userId: member.userId,
                    userName: member.userName || member.email,
                    userEmail: member.email,
                    userAvatar: member.userAvatar,
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
    const expected = Math.max(0, totalMembers - onLeaveCount);
    const dateIsWorking = isWorkingDay(date, holidays);

    return {
        totalMembers,
        presentCount: attended,
        absentCount,
        lateCount,
        onLeaveCount,
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

/**
 * Get team attendance for a date range (for reports)
 * Manager-only feature
 */
export function useTeamAttendanceRange(
    workspaceId?: string,
    year?: number,
    month?: number
) {
    const currentDate = new Date();
    const targetYear = year ?? currentDate.getFullYear();
    const targetMonth = month ?? currentDate.getMonth();
    const { start, end } = getMonthDateRange(targetYear, targetMonth);

    return useQuery({
        queryKey: ['teamAttendanceRange', workspaceId, targetYear, targetMonth],
        queryFn: async () => {
            if (!workspaceId) return [];

            // Fetch attendance records for the date range
            const response = await resources.listAll('attendance', [
                query.equal('workspaceId', workspaceId),
                query.greaterThanEqual('date', start),
                query.lessThanEqual('date', end),
                query.orderDesc('date'),
            ]
            );

            return response.items as any[];
        },
        enabled: !!workspaceId,
    });
}
