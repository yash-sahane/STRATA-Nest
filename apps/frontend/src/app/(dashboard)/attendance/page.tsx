'use client';

import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { AttendanceWidget } from '@/components/attendance/attendance-widget';
import { AttendanceCalendar } from '@/components/attendance/attendance-calendar';
import { AttendanceStats } from '@/components/attendance/attendance-stats';
import { TeamAttendanceTab } from '@/components/attendance/team-attendance-tab';
import { useIsManager } from '@/hooks/use-permissions';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useAttendanceRealtime } from '@/hooks/use-realtime';
import { Clock, Calendar, BarChart3, Users, FileText } from 'lucide-react';

export default function AttendancePage() {
  const isManager = useIsManager();
  const { currentWorkspace } = useCurrentWorkspace();
  // Live updates: the gateway already broadcasts every write on this
  // collection, this page just never subscribed — so another member's
  // change only appeared after a manual navigation.
  // Mounted on the page, not per tab, so every tab below stays live.
  useAttendanceRealtime(currentWorkspace?.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance Management"
        description="Track your daily attendance, view calendar, and analyze your work patterns"
        icon={Clock}
        actions={
          // Leave lives on /leave — link to the single canonical entry point
          // rather than embedding a second copy of the request form here.
          <Button asChild variant="outline" className="gap-2">
            <Link href="/leave">
              <FileText className="h-4 w-4" />
              Leave Requests
            </Link>
          </Button>
        }
      />

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
          {/* Today is the check-in/out surface only. The monthly figures live
              under Analytics — rendering AttendanceStats here too duplicated
              every card. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <AttendanceWidget />
          </div>
        </TabsContent>

        <TabsContent value="calendar" className="space-y-4">
          <AttendanceCalendar />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          {/* No year/month props: AttendanceStats already defaults to the
              current month, and pinning it to the month the page mounted was
              the only thing the removed state did. */}
          <AttendanceStats />
        </TabsContent>

        {isManager && (
          <TabsContent value="team" className="space-y-4">
            <TeamAttendanceTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
