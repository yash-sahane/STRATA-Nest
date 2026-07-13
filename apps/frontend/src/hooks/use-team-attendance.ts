import { useQuery } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { getCurrentDate, getMonthDateRange } from '@/lib/attendance-utils';

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
        checkInTime: string;
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
}

// ============================================================================
// Team Attendance Hooks
// ============================================================================

/**
 * Get today's attendance for all team members
 * Manager-only feature
 */
export function useTeamAttendance(workspaceId?: string, date?: string) {
    const targetDate = date || getCurrentDate();

    return useQuery({
        queryKey: ['teamAttendance', workspaceId, targetDate],
        queryFn: async () => {
            if (!workspaceId) return [];

            // Fetch all workspace members
            const membersResponse = await resources.list('workspace_members', [
                query.equal('workspaceId', workspaceId),
                query.equal('status', 'ACTIVE'),
                query.limit(100),
            ]
            );

            // Fetch attendance records for the date
            const attendanceResponse = await resources.list('attendance', [
                query.equal('workspaceId', workspaceId),
                query.equal('date', targetDate),
                query.limit(100),
            ]
            );

            // Create a map of attendance by userId
            const attendanceMap = new Map();
            attendanceResponse.items.forEach((record: any) => {
                attendanceMap.set(record.userId, record);
            });

            // Combine member data with attendance
            const teamAttendance: TeamMemberAttendance[] = membersResponse.items.map((member: any) => {
                const attendance = attendanceMap.get(member.userId);

                // Determine status
                let status: TeamMemberAttendance['status'] = 'ABSENT';
                if (attendance) {
                    status = attendance.status as TeamMemberAttendance['status'];
                }

                return {
                    userId: member.userId,
                    userName: member.userName || member.email,
                    userEmail: member.email,
                    userAvatar: member.userAvatar,
                    role: member.role || 'MEMBER',
                    attendance: attendance ? {
                        id: attendance.id,
                        date: attendance.date,
                        checkInTime: attendance.checkInTime,
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

/**
 * Get team attendance analytics for a specific date
 * Manager-only feature
 */
export function useTeamAttendanceAnalytics(workspaceId?: string, date?: string) {
    const targetDate = date || getCurrentDate();

    return useQuery({
        queryKey: ['teamAttendanceAnalytics', workspaceId, targetDate],
        queryFn: async () => {
            if (!workspaceId) return null;

            // Fetch all workspace members
            const membersResponse = await resources.list('workspace_members', [
                query.equal('workspaceId', workspaceId),
                query.equal('status', 'ACTIVE'),
                query.limit(100),
            ]
            );

            // Fetch attendance records for the date
            const attendanceResponse = await resources.list('attendance', [
                query.equal('workspaceId', workspaceId),
                query.equal('date', targetDate),
                query.limit(100),
            ]
            );

            const totalMembers = membersResponse.items.length;
            const attendanceRecords = attendanceResponse.items as any[];

            // Calculate metrics
            const presentCount = attendanceRecords.filter(
                (r) => r.status === 'PRESENT' || r.status === 'LATE'
            ).length;

            const absentCount = totalMembers - attendanceRecords.length;

            const lateCount = attendanceRecords.filter(
                (r) => r.status === 'LATE'
            ).length;

            const onLeaveCount = attendanceRecords.filter(
                (r) => r.status === 'ON_LEAVE'
            ).length;

            const totalWorkHours = attendanceRecords.reduce(
                (sum, r) => sum + (r.workHours || 0),
                0
            );

            const averageWorkHours = attendanceRecords.length > 0
                ? totalWorkHours / attendanceRecords.length
                : 0;

            const attendanceRate = totalMembers > 0
                ? Math.round((presentCount / totalMembers) * 100)
                : 0;

            const analytics: TeamAttendanceAnalytics = {
                totalMembers,
                presentCount,
                absentCount,
                lateCount,
                onLeaveCount,
                attendanceRate,
                averageWorkHours: Math.round(averageWorkHours * 10) / 10,
                totalWorkHours: Math.round(totalWorkHours * 10) / 10,
            };

            return analytics;
        },
        enabled: !!workspaceId,
        refetchInterval: 30000, // Refetch every 30 seconds
    });
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
            const response = await resources.list('attendance', [
                query.equal('workspaceId', workspaceId),
                query.greaterThanEqual('date', start),
                query.lessThanEqual('date', end),
                query.orderDesc('date'),
                query.limit(1000),
            ]
            );

            return response.items as any[];
        },
        enabled: !!workspaceId,
    });
}

