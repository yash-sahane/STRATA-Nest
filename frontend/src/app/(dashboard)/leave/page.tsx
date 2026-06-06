'use client';

import * as React from 'react';
import { Calendar, Users, BarChart3 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LeaveRequestForm } from '@/components/leave/leave-request-form';
import { LeaveApprovalCard } from '@/components/leave/leave-approval-card';
import { LeaveBalanceDisplay } from '@/components/leave/leave-balance-display';
import { useLeaveRequests, useTeamLeaveRequests } from '@/hooks/use-leave';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { LEAVE_STATUS, getLeaveStatusColor, formatLeaveDateRange } from '@/lib/leave-utils';

export default function LeavePage() {
  const { user } = useAuth();
  const { currentWorkspaceId } = useCurrentWorkspace();
  const [activeTab, setActiveTab] = React.useState('my-leaves');
  const [isLeaveFormOpen, setIsLeaveFormOpen] = React.useState(false);

  const { data: myLeaves = [], isLoading: myLeavesLoading } = useLeaveRequests(user?.id);
  const { data: teamLeaves = [], isLoading: teamLeavesLoading } = useTeamLeaveRequests(
    currentWorkspaceId || undefined
  );

  // Filter team leaves (exclude own requests)
  const teamLeaveRequests = teamLeaves.filter((leave) => leave.userId !== user?.id);

  // Check if user is a manager
  const isManager = ['MANAGER', 'ASSISTANT_MANAGER', 'ADMIN'].includes(user?.role || '');

  // Count pending requests
  const pendingCount = myLeaves.filter((leave) => leave.status === 'PENDING').length;
  const teamPendingCount = teamLeaveRequests.filter(
    (leave) => leave.status === 'PENDING'
  ).length;

  if (!user) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <p className="text-muted-foreground">Please log in to view leave management</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leave Management</h1>
          <p className="text-muted-foreground">
            Manage your leave requests and view your leave balance
          </p>
        </div>
        <Button onClick={() => setIsLeaveFormOpen(true)}>
          <Calendar className="mr-2 h-4 w-4" />
          Request Leave
        </Button>
      </div>

      {/* Leave Request Form Dialog */}
      {user && (
        <LeaveRequestForm 
          open={isLeaveFormOpen}
          onOpenChange={setIsLeaveFormOpen}
          userId={user.id}
          workspaceId={currentWorkspaceId || ''}
        />
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="my-leaves" className="relative">
            <Calendar className="h-4 w-4 mr-2" />
            My Leaves
            {pendingCount > 0 && (
              <Badge className="ml-2 bg-yellow-500 hover:bg-yellow-600 h-5 w-5 p-0 flex items-center justify-center">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          {isManager && (
            <TabsTrigger value="team-leaves" className="relative">
              <Users className="h-4 w-4 mr-2" />
              Team Leaves
              {teamPendingCount > 0 && (
                <Badge className="ml-2 bg-red-500 hover:bg-red-600 h-5 w-5 p-0 flex items-center justify-center">
                  {teamPendingCount}
                </Badge>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="balance">
            <BarChart3 className="h-4 w-4 mr-2" />
            Balance
          </TabsTrigger>
        </TabsList>

        {/* My Leaves Tab */}
        <TabsContent value="my-leaves" className="space-y-4 mt-6">
          {myLeavesLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[1, 2, 3, 4].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-4 w-32 bg-muted rounded mb-2"></div>
                    <div className="h-3 w-48 bg-muted rounded"></div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-20 bg-muted rounded"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : myLeaves.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-12">
                  <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No leave requests yet</h3>
                  <p className="text-muted-foreground mb-4">
                    Click the "Request Leave" button above to submit your first leave request
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {myLeaves.map((leave) => (
                <Card key={leave.id} className="hover:shadow-md transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <CardTitle className="text-lg">
                          {formatLeaveDateRange(leave.startDate, leave.endDate)}
                        </CardTitle>
                        <CardDescription>
                          {leave.days} {leave.days === 1 ? 'day' : 'days'}
                          {leave.halfDay && ' (Half Day)'}
                        </CardDescription>
                      </div>
                      <Badge
                        className={getLeaveStatusColor(leave.status)}
                        variant="outline"
                      >
                        {LEAVE_STATUS[leave.status]}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {leave.reason}
                      </p>
                      {leave.approverComments && (
                        <div className="mt-3 p-3 bg-muted/30 rounded-md">
                          <p className="text-xs font-medium mb-1">Manager Comments:</p>
                          <p className="text-sm text-muted-foreground">
                            {leave.approverComments}
                          </p>
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground pt-2">
                        Requested on {new Date(leave.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Team Leaves Tab (Managers only) */}
        {isManager && (
          <TabsContent value="team-leaves" className="space-y-4 mt-6">
            {teamLeavesLoading ? (
              <div className="grid gap-4">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="animate-pulse">
                    <CardHeader>
                      <div className="h-4 w-32 bg-muted rounded mb-2"></div>
                      <div className="h-3 w-48 bg-muted rounded"></div>
                    </CardHeader>
                    <CardContent>
                      <div className="h-32 bg-muted rounded"></div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : teamLeaveRequests.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-12">
                    <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">No team leave requests</h3>
                    <p className="text-muted-foreground">
                      There are no pending leave requests from your team members
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Pending Requests */}
                {teamLeaveRequests.filter((leave) => leave.status === 'PENDING').length >
                  0 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      Pending Approvals
                      <Badge variant="secondary">{teamPendingCount}</Badge>
                    </h3>
                    <div className="grid gap-4">
                      {teamLeaveRequests
                        .filter((leave) => leave.status === 'PENDING')
                        .map((leave) => (
                          <LeaveApprovalCard
                            key={leave.id}
                            leaveRequest={leave}
                            approverId={user.id}
                            approverName={user.name || user.email}
                          />
                        ))}
                    </div>
                  </div>
                )}

                {/* Processed Requests */}
                {teamLeaveRequests.filter(
                  (leave) => leave.status === 'APPROVED' || leave.status === 'REJECTED'
                ).length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">Recently Processed</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      {teamLeaveRequests
                        .filter(
                          (leave) =>
                            leave.status === 'APPROVED' || leave.status === 'REJECTED'
                        )
                        .slice(0, 6)
                        .map((leave) => (
                          <LeaveApprovalCard
                            key={leave.id}
                            leaveRequest={leave}
                            approverId={user.id}
                            approverName={user.name || user.email}
                          />
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        )}

        {/* Leave Balance Tab */}
        <TabsContent value="balance" className="space-y-4 mt-6">
          <LeaveBalanceDisplay userId={user.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
