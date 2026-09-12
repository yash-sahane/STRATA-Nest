'use client';

import * as React from 'react';
import { getInitials } from '@/lib/utils';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useTeamAttendance, useTeamAttendanceAnalytics } from '@/hooks/use-team-attendance';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Users,
  CheckCircle,
  XCircle,
  Clock,
  Calendar,
  Search,
  TrendingUp,
  Download,
} from 'lucide-react';
import { ROLE_CONFIG } from '@/hooks/use-team';
import {
  formatMinutes,
  formatTime,
  getAttendanceStatusColor,
  getCurrentDate,
} from '@/lib/attendance-utils';
import { ErrorState } from '@/components/ui/error-state';

export function TeamAttendanceTab() {
  const { currentWorkspace } = useCurrentWorkspace();

  const [selectedDate, setSelectedDate] = React.useState(getCurrentDate());
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<string>('ALL');
  const [roleFilter, setRoleFilter] = React.useState<string>('ALL');

  const { data: teamAttendance, isLoading, isError, refetch } = useTeamAttendance(
    currentWorkspace?.id,
    selectedDate
  );

  const { data: analytics } = useTeamAttendanceAnalytics(currentWorkspace?.id, selectedDate);

  // Filter team members
  const filteredTeam = React.useMemo(() => {
    if (!teamAttendance) return [];

    return teamAttendance.filter((member) => {
      const matchesSearch =
        (member.userName?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
        (member.userEmail?.toLowerCase() || '').includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'ALL' || member.status === statusFilter;
      const matchesRole = roleFilter === 'ALL' || member.role === roleFilter;

      return matchesSearch && matchesStatus && matchesRole;
    });
  }, [teamAttendance, searchQuery, statusFilter, roleFilter]);

  // UNKNOWN is a real state — a date in the future, or one before this person
  // joined — but "UNKNOWN" is not a word to put on a badge. Say what it means.
  const statusLabel = (status: string) =>
    status === 'UNKNOWN' ? 'No record' : status.replace('_', ' ');

  const statusHint = (status: string) =>
    status === 'UNKNOWN'
      ? 'Nothing to report for this date — it is in the future, or before this member joined the workspace.'
      : undefined;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PRESENT':
        return <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />;
      case 'ABSENT':
        return <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />;
      case 'LATE':
        return <Clock className="h-4 w-4 text-orange-600 dark:text-orange-400" />;
      case 'ON_LEAVE':
        return <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Date Selector */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" />
            Team Attendance
          </h3>
          <p className="text-sm text-muted-foreground">
            Daily attendance for everyone in this workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-auto"
          />
          <Button variant="outline" size="icon" aria-label="Download attendance for this day">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      {isError ? (
        <ErrorState
          title="Couldn't load team attendance"
          description="The team's attendance for this date could not be fetched."
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : analytics ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Members</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.totalMembers}</div>
              <p className="text-xs text-muted-foreground">Active team members</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Present</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">{analytics.presentCount}</div>
              <p className="text-xs text-muted-foreground">
                {!analytics.isWorkingDay
                  ? 'Non-working day'
                  : analytics.expectedCount === 0
                    ? 'Nobody expected in on this date'
                    : `${analytics.attendanceRate}% attendance rate`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Absent</CardTitle>
              <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{analytics.absentCount}</div>
              <p className="text-xs text-muted-foreground">
                {analytics.lateCount} late &middot; {analytics.onLeaveCount} on leave
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Work Hours</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.averageWorkHours}h</div>
              <p className="text-xs text-muted-foreground">{analytics.totalWorkHours}h total</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="PRESENT">Present</SelectItem>
                <SelectItem value="ABSENT">Absent</SelectItem>
                <SelectItem value="LATE">Late</SelectItem>
                <SelectItem value="ON_LEAVE">On Leave</SelectItem>
              </SelectContent>
            </Select>

            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Roles</SelectItem>
                <SelectItem value="MANAGER">Manager</SelectItem>
                <SelectItem value="SOFTWARE_DEVELOPER">Software Developer</SelectItem>
                <SelectItem value="TESTER">Tester</SelectItem>
                <SelectItem value="DEVELOPER_INTERN">Developer Intern</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Team Member List */}
      <Card>
        <CardHeader>
          <CardTitle>Team Members ({filteredTeam.length})</CardTitle>
          <CardDescription>
            Showing {filteredTeam.length} of {teamAttendance?.length || 0} members
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {filteredTeam.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No team members found matching your filters.
              </div>
            ) : (
              filteredTeam.map((member) => (
                <div
                  key={member.userId}
                  className="flex items-center justify-between p-4 rounded-lg border hover:bg-accent transition-colors"
                >
                  <div className="flex items-center gap-4 flex-1">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={member.userAvatar} alt={member.userName} />
                      <AvatarFallback>{getInitials(member.userName)}</AvatarFallback>
                    </Avatar>

                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{member.userName}</p>
                        <Badge variant="outline" className="text-xs">
                          {ROLE_CONFIG[member.role as keyof typeof ROLE_CONFIG]?.label ||
                            member.role}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{member.userEmail}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {/* An ON_LEAVE row carries no arrival time — the badge alone
                        tells that story. */}
                    {member.attendance?.checkInTime && (
                      <div className="text-right">
                        <div className="text-sm font-medium">
                          {formatTime(member.attendance.checkInTime)}
                          {member.attendance.checkOutTime && (
                            <> - {formatTime(member.attendance.checkOutTime)}</>
                          )}
                        </div>
                        {member.attendance.workHours != null &&
                          member.attendance.workHours !== undefined && (
                            <div className="text-xs text-muted-foreground">
                              {member.attendance.workHours.toFixed(1)}h worked
                            </div>
                          )}
                        {(member.attendance.lateMinutes ?? 0) > 0 && (
                          <div className="text-xs text-orange-600 dark:text-orange-400">
                            Late by {formatMinutes(member.attendance.lateMinutes ?? 0)}
                          </div>
                        )}
                      </div>
                    )}

                    <Badge
                      variant="outline"
                      className={`gap-1 ${getAttendanceStatusColor(member.status)}`}
                      title={statusHint(member.status)}
                    >
                      {getStatusIcon(member.status)}
                      {statusLabel(member.status)}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
