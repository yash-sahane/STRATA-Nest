'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { AttendanceWidget } from '@/components/attendance/attendance-widget';
import { AttendanceCalendar } from '@/components/attendance/attendance-calendar';
import { AttendanceStats } from '@/components/attendance/attendance-stats';
import { TeamAttendanceTab } from '@/components/attendance/team-attendance-tab';
import { LeaveRequestForm } from '@/components/leave/leave-request-form';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useIsManager } from '@/hooks/use-permissions';
import { Clock, Calendar, BarChart3, Users, FileText } from 'lucide-react';

export default function AttendancePage() {
  const { user } = useAuth();
  const { currentWorkspaceId } = useCurrentWorkspace();
  const [currentMonth] = useState(new Date().getMonth());
  const [currentYear] = useState(new Date().getFullYear());
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const isManager = useIsManager();

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Attendance Management</h2>
          <p className="text-muted-foreground">
            Track your daily attendance, view calendar, and analyze your work patterns
          </p>
        </div>
        <Button onClick={() => setIsLeaveModalOpen(true)} className="gap-2">
          <FileText className="h-4 w-4" />
          Apply for Leave
        </Button>
      </div>

      <Tabs defaultValue="today" className="space-y-4">
        <TabsList>
          <TabsTrigger value="today" className="gap-2">
            <Clock className="h-4 w-4" />
            Today
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-2">
            <Calendar className="h-4 w-4" />
            Calendar
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Analytics
          </TabsTrigger>
          {isManager && (
            <TabsTrigger value="team" className="gap-2">
              <Users className="h-4 w-4" />
              Team
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="today" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <AttendanceWidget />
            <div className="space-y-4">
              <AttendanceStats year={currentYear} month={currentMonth} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="calendar" className="space-y-4">
          <AttendanceCalendar />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <AttendanceStats year={currentYear} month={currentMonth} />
        </TabsContent>

        {isManager && (
          <TabsContent value="team" className="space-y-4">
            <TeamAttendanceTab />
          </TabsContent>
        )}
      </Tabs>

      {/* Leave Application Modal */}
      {user && currentWorkspaceId && (
        <LeaveRequestForm 
          open={isLeaveModalOpen} 
          onOpenChange={setIsLeaveModalOpen}
          userId={user.id}
          workspaceId={currentWorkspaceId}
        />
      )}
    </div>
  );
}
