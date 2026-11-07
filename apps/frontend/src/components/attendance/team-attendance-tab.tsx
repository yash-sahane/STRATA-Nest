'use client';

import * as React from 'react';
import { getInitials } from '@/lib/utils';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import {
  useTeamAttendance,
  useTeamAttendanceAnalytics,
  type TeamMemberAttendance,
} from '@/hooks/use-team-attendance';
import { AttendanceRecordDialog } from '@/components/attendance/attendance-record-dialog';
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
  Pencil,
  Plus,
} from 'lucide-react';
import { ROLE_CONFIG } from '@/hooks/use-team';
import { roleDisplayName as roleLabel } from '@/hooks/use-role-options';
import {
  formatMinutes,
  formatTime,
  getAttendanceStatusColor,
  getCurrentDate,
} from '@/lib/attendance-utils';
import { ErrorState } from '@/components/ui/error-state';
import { humanizeEnum } from '@/lib/semantic/status';
import { useAuth } from '@/components/providers/auth-provider';
import { useLeaveApprovers } from '@/hooks/use-leave';


/** One CSV cell. Quoted always; a leading =, +, - or @ is defused, because a
 *  spreadsheet runs such a cell as a formula and a display name is free text. */
function csvCell(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function TeamAttendanceTab() {
  const { currentWorkspace } = useCurrentWorkspace();
  const { user } = useAuth();
  // Your own day is restated by another HR manager — the server refuses it
  // otherwise — unless you are the only one there is.
  const { data: approvers = [] } = useLeaveApprovers(currentWorkspace?.id);
  const anotherHrManager = approvers.some((a) => a.userId !== user?.id);

  const [selectedDate, setSelectedDate] = React.useState(getCurrentDate());
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<string>('ALL');
  const [roleFilter, setRoleFilter] = React.useState<string>('ALL');
  // The roster row whose record is open in the correction dialog.
  const [editing, setEditing] = React.useState<TeamMemberAttendance | null>(null);

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
    status === 'UNKNOWN' ? 'No record' : humanizeEnum(status);

  const statusHint = (status: string) =>
    status === 'UNKNOWN'
      ? 'Nothing to report for this date — it is in the future, or before this member joined the workspace.'
      : undefined;

  // Nothing can be filed for a day that has not happened; the API refuses it.
  const dateIsFuture = selectedDate > getCurrentDate();

  // The roles actually on this roster, in the product's own order — the list
  // used to be four hand-written options, so an Assistant Manager, a Content
  // Engineer or a plain Member could not be filtered for at all.
  const rolesPresent = React.useMemo(() => {
    const present = new Set((teamAttendance ?? []).map((m) => m.role));
    const known = Object.keys(ROLE_CONFIG).filter((role) => present.has(role));
    const custom = [...present].filter((role) => !(role in ROLE_CONFIG)).sort();
    return [...known, ...custom];
  }, [teamAttendance]);

  /** The roster as filtered on screen, as a CSV — what the Download button was
   *  drawn for and never did. */
  const downloadRoster = () => {
    const header = [
      'Name',
      'Email',
      'Role',
      'Status',
      'Check in',
      'Check out',
      'Hours worked',
      'Late (minutes)',
    ];
    const rows = filteredTeam.map((m) => [
      m.userName,
      m.userEmail,
      roleLabel(m.role),
      statusLabel(m.status),
      m.attendance?.checkInTime ? formatTime(m.attendance.checkInTime) : '',
      m.attendance?.checkOutTime ? formatTime(m.attendance.checkOutTime) : '',
      m.attendance?.workHours != null ? m.attendance.workHours.toFixed(2) : '',
      m.attendance?.lateMinutes ?? '',
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    // The BOM is what makes a spreadsheet read the file as UTF-8.
    const url = window.URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-${selectedDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PRESENT':
        return <CheckCircle className="h-4 w-4 text-success-text" />;
      case 'ABSENT':
        return <XCircle className="h-4 w-4 text-destructive-text" />;
      case 'LATE':
        return <Clock className="h-4 w-4 text-warning-text" />;
      case 'ON_LEAVE':
        return <Calendar className="h-4 w-4 text-info-text" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Date Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
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
            aria-label="Day to show"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-auto"
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Download attendance for this day"
            title="Download as CSV"
            onClick={downloadRoster}
            disabled={filteredTeam.length === 0}
          >
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
              <CheckCircle className="h-4 w-4 text-success-text" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-success-text">{analytics.presentCount}</div>
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
              <XCircle className="h-4 w-4 text-destructive-text" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive-text">{analytics.absentCount}</div>
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
                <SelectItem value="HALF_DAY">Half Day</SelectItem>
                <SelectItem value="ON_LEAVE">On Leave</SelectItem>
              </SelectContent>
            </Select>

            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Roles</SelectItem>
                {rolesPresent.map((role) => (
                  <SelectItem key={role} value={role}>
                    {roleLabel(role)}
                  </SelectItem>
                ))}
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
            {isLoading ? (
              // Not the "no members match" line below: that is a statement
              // about the roster, and there is no roster yet.
              [1, 2, 3].map((i) => <Skeleton key={i} className="h-[72px] w-full" />)
            ) : isError ? (
              <div className="text-center py-8 text-muted-foreground">
                The roster could not be loaded.
              </div>
            ) : filteredTeam.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No team members found matching your filters.
              </div>
            ) : (
              filteredTeam.map((member) => (
                <div
                  key={member.userId}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-lg border"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={member.userAvatar} alt={member.userName} />
                      <AvatarFallback>{getInitials(member.userName)}</AvatarFallback>
                    </Avatar>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="min-w-0 truncate font-medium" title={member.userName}>
                          {member.userName}
                        </p>
                        <Badge variant="outline" className="text-xs">
                          {roleLabel(member.role)}
                        </Badge>
                      </div>
                      <p className="truncate text-sm text-muted-foreground" title={member.userEmail}>
                        {member.userEmail}
                      </p>
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
                        {/* A day that is over, with an arrival and no departure:
                            the hours are unknown, not zero, and whoever is
                            reading this is the person who can put them right.
                            It used to look exactly like somebody still at work. */}
                        {!member.attendance.checkOutTime &&
                          selectedDate < getCurrentDate() &&
                          member.attendance.status !== 'ON_LEAVE' &&
                          member.attendance.status !== 'ABSENT' && (
                            <div className="text-xs font-medium text-warning-text">
                              No check-out recorded
                            </div>
                          )}
                        {member.attendance.workHours != null &&
                          member.attendance.workHours !== undefined && (
                            <div className="text-xs text-muted-foreground">
                              {member.attendance.workHours.toFixed(1)}h worked
                            </div>
                          )}
                        {(member.attendance.lateMinutes ?? 0) > 0 && (
                          <div className="text-xs text-warning-text">
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

                    {/* Correct what is filed, or file the day when nothing is.
                        Kept in the layout on a future date so the badges stay
                        in one column. */}
                    {(() => {
                      const ownDay = member.userId === user?.id && anotherHrManager;
                      return (
                    <Button
                      variant="ghost"
                      size="icon"
                      className={dateIsFuture || ownDay ? 'invisible' : undefined}
                      disabled={dateIsFuture || ownDay}
                      aria-hidden={ownDay || undefined}
                      aria-label={
                        member.attendance
                          ? `Correct attendance for ${member.userName}`
                          : `File attendance for ${member.userName}`
                      }
                      title={member.attendance ? 'Correct this record' : 'File attendance'}
                      onClick={() => setEditing(member)}
                    >
                      {member.attendance ? (
                        <Pencil className="h-4 w-4" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
                      );
                    })()}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {currentWorkspace?.id && (
        <AttendanceRecordDialog
          workspaceId={currentWorkspace.id}
          date={selectedDate}
          member={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
