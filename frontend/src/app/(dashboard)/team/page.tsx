'use client';

import * as React from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useWorkspaceTasks } from '@/hooks/use-task';
import {
  useTeamMembers,
  useUpdateTeamMember,
  useDeleteTeamMember,
  useMemberTaskCounts,
  getWorkloadLevel,
  ROLE_CONFIG,
  STATUS_CONFIG,
  TeamMember,
} from '@/hooks/use-team';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { PageLoader } from '@/components/ui/page-loader';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PageHeader } from '@/components/layout/page-header';
import {
  Users,
  Search,
  MoreVertical,
  Mail,
  Phone,
  Trash2,
  Edit,
  UserCheck,
  UserPlus,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { ResourceAllocationCard } from '@/components/team/resource-allocation-card';
import { AddMembersSection } from '@/components/team/add-members-section';
import { DeleteMemberDialog } from '@/components/team/delete-member-dialog';
import { calculateTeamWorkload } from '@/lib/team-workload';
import { addDays } from 'date-fns';
import { logger } from '@/lib/logger';
import { getInitials } from '@/lib/utils';

export default function TeamPage() {
  const { user } = useAuth();
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();

  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers(
    currentWorkspace?.id
  );
  const { data: tasks } = useWorkspaceTasks(currentWorkspace?.id);
  const { data: taskCounts } = useMemberTaskCounts(currentWorkspace?.id);
  const updateMember = useUpdateTeamMember();
  const deleteMember = useDeleteTeamMember();

  // Check if user has permission to invite members
  const canInviteMembers = useHasPermission(Permission.INVITE_MEMBER);

  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedRole, setSelectedRole] = React.useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = React.useState<string>('ALL');
  const [editingMember, setEditingMember] = React.useState<TeamMember | null>(null);
  const [memberToDelete, setMemberToDelete] = React.useState<TeamMember | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);

  // Filter team members
  const filteredMembers = React.useMemo(() => {
    return teamMembers.filter((member) => {
      const name = member.name || '';
      const email = member.email || '';
      const matchesSearch =
        name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = selectedRole === 'ALL' || member.role === selectedRole;
      const matchesStatus = selectedStatus === 'ALL' || member.status === selectedStatus;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [teamMembers, searchQuery, selectedRole, selectedStatus]);

  // Calculate stats
  const stats = React.useMemo(() => {
    const totalMembers = teamMembers.length;
    const activeMembers = teamMembers.filter((member) => member.status === 'ACTIVE').length;
    const invitedMembers = teamMembers.filter((member) => member.status === 'INVITED').length;
    const roleBreakdown = teamMembers.reduce(
      (acc, member) => {
        acc[member.role] = (acc[member.role] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    const activeRate = totalMembers > 0 ? Math.round((activeMembers / totalMembers) * 100) : 0;
    const roleCount = Object.keys(roleBreakdown).length;

    return { totalMembers, activeMembers, invitedMembers, activeRate, roleBreakdown, roleCount };
  }, [teamMembers]);

  const summaryCards = React.useMemo(
    () => [
      {
        title: 'Total Members',
        value: stats.totalMembers,
        detail: `${stats.activeMembers} active`,
        icon: Users,
      },
      {
        title: 'Active Members',
        value: stats.activeMembers,
        detail: `${stats.activeRate}% active rate`,
        icon: UserCheck,
      },
      {
        title: 'Pending Invites',
        value: stats.invitedMembers,
        detail:
          stats.invitedMembers === 1
            ? '1 invite pending'
            : `${stats.invitedMembers} invites pending`,
        icon: UserPlus,
      },
      {
        title: 'Role Coverage',
        value: stats.roleCount,
        detail:
          stats.roleCount === 1 ? '1 role represented' : `${stats.roleCount} roles represented`,
        icon: ShieldCheck,
      },
    ],
    [stats]
  );

  // Calculate team workload (next 14 days)
  const workloadData = React.useMemo(() => {
    if (!tasks || !teamMembers) return null;

    const startDate = new Date();
    const endDate = addDays(startDate, 14);

    return calculateTeamWorkload(tasks, teamMembers, startDate, endDate);
  }, [tasks, teamMembers]);

  const handleEditMember = (member: TeamMember) => {
    setEditingMember(member);
    setIsEditDialogOpen(true);
  };

  const handleUpdateMember = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingMember) return;

    const formData = new FormData(e.currentTarget);
    const updates = {
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      phone: (formData.get('phone') as string) || undefined,
      role: formData.get('role') as TeamMember['role'],
      status: formData.get('status') as TeamMember['status'],
    };

    try {
      await updateMember.mutateAsync({
        id: editingMember.id,
        data: updates,
      });

      toast.success('Team member updated successfully');
      setIsEditDialogOpen(false);
      setEditingMember(null);
    } catch (error) {
      toast.error('Failed to update team member');
      logger.error('Unexpected error', { error: error });
    }
  };

  const handleDeleteMember = (member: TeamMember) => {
    setMemberToDelete(member);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteMember = async () => {
    if (!memberToDelete) return;

    try {
      await deleteMember.mutateAsync({
        id: memberToDelete.id,
        workspaceId: memberToDelete.workspaceId,
      });

      toast.success('Team member removed successfully');
      setDeleteDialogOpen(false);
      setMemberToDelete(null);
    } catch (error) {
      toast.error('Failed to remove team member');
      logger.error('Unexpected error', { error: error });
    }
  };

  if (workspacesLoading || membersLoading) {
    return <PageLoader message="Loading team members..." />;
  }

  if (!currentWorkspace) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center space-y-4">
          <Users className="h-16 w-16 text-muted-foreground/50 mx-auto" />
          <h2 className="text-2xl font-semibold">No Workspace Found</h2>
          <p className="text-muted-foreground">Create a workspace to manage team members</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        icon={Users}
        title="Team Management"
        description={`Manage members, roles, and workload for ${currentWorkspace.name}`}
      />

      {/* Team Management Tabs */}
      <Tabs defaultValue="members" className="space-y-6">
        <TabsList
          className={cn('grid w-full sm:w-fit', canInviteMembers ? 'grid-cols-2' : 'grid-cols-1')}
        >
          <TabsTrigger value="members">Team Members</TabsTrigger>
          {canInviteMembers && <TabsTrigger value="add-members">Add Members</TabsTrigger>}
        </TabsList>

        <TabsContent value="members" className="space-y-6">
          {/* Stats Cards */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map((card, index) => {
              const Icon = card.icon;

              return (
                <Card
                  key={card.title}
                  className="overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md animate-in fade-in slide-in-from-bottom-2"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {card.title}
                    </CardTitle>
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold tracking-tight">{card.value}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{card.detail}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Resource Allocation */}
          {workloadData && (
            <ResourceAllocationCard
              workloadData={workloadData.members}
              averageWorkload={workloadData.averageWorkload}
            />
          )}

          {/* Filters & Team Directory */}
          <Card className="overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500">
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-base">Team Directory</CardTitle>
                <CardDescription>
                  {filteredMembers.length} of {teamMembers.length} members shown
                </CardDescription>
              </div>
              {(searchQuery || selectedRole !== 'ALL' || selectedStatus !== 'ALL') && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedRole('ALL');
                    setSelectedStatus('ALL');
                  }}
                >
                  Clear Filters
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_12rem]">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={selectedRole} onValueChange={setSelectedRole}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Filter by role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Roles</SelectItem>
                    {Object.entries(ROLE_CONFIG).map(([role, config]) => (
                      <SelectItem key={role} value={role}>
                        {config.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Status</SelectItem>
                    {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                      <SelectItem key={status} value={status}>
                        {config.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Team Members Table */}
              <div className="overflow-hidden rounded-md border">
                <Table className="min-w-[640px] lg:min-w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Workload</TableHead>
                      <TableHead className="hidden xl:table-cell">Contact</TableHead>
                      <TableHead className="hidden lg:table-cell">Joined</TableHead>
                      {canInviteMembers && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMembers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={canInviteMembers ? 7 : 6} className="text-center py-8">
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <Users className="h-8 w-8 opacity-50" />
                            <span>No team members found</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredMembers.map((member) => {
                        const isCurrentUser = member.userId === user?.id;
                        const memberCounts = taskCounts?.get(member.userId);
                        const activeTasks = memberCounts?.activeTasks || 0;
                        const overdueTasks = memberCounts?.overdueTasks || 0;
                        const completedTasks = memberCounts?.completedTasks || 0;
                        const workload = getWorkloadLevel(activeTasks);

                        return (
                          <TableRow key={member.id}>
                            <TableCell className="min-w-[220px]">
                              <div className="flex items-center gap-3">
                                <div
                                  className={cn(
                                    'relative rounded-full',
                                    isCurrentUser &&
                                      'ring-2 ring-primary/40 ring-offset-2 ring-offset-background'
                                  )}
                                >
                                  <Avatar className="h-10 w-10">
                                    <AvatarImage src={member.avatar} alt={member.name} />
                                    <AvatarFallback>
                                      {getInitials(member.name || member.email)}
                                    </AvatarFallback>
                                  </Avatar>
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 font-medium">
                                    <span className="truncate">{member.name}</span>
                                    {isCurrentUser && (
                                      <Badge
                                        variant="secondary"
                                        className="h-5 rounded-md px-1.5 text-[11px] font-medium"
                                      >
                                        You
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="truncate text-sm text-muted-foreground">
                                    {member.email}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                className={cn('whitespace-nowrap', ROLE_CONFIG[member.role].color)}
                              >
                                {ROLE_CONFIG[member.role].label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                className={cn(
                                  'whitespace-nowrap',
                                  STATUS_CONFIG[member.status].color
                                )}
                              >
                                {STATUS_CONFIG[member.status].label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant="outline"
                                    className={cn('text-xs', workload.color)}
                                  >
                                    {workload.label}
                                  </Badge>
                                  <span className="text-sm font-medium">{activeTasks} active</span>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                  <span>{completedTasks} done</span>
                                  {overdueTasks > 0 && (
                                    <span className="text-red-500 font-medium">
                                      {overdueTasks} overdue
                                    </span>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="hidden xl:table-cell">
                              <div className="flex flex-col gap-1 text-sm">
                                <div className="flex max-w-64 items-center gap-2 text-muted-foreground">
                                  <Mail className="h-3 w-3" />
                                  <span className="truncate">{member.email}</span>
                                </div>
                                {member.phone && (
                                  <div className="flex items-center gap-2 text-muted-foreground">
                                    <Phone className="h-3 w-3" />
                                    {member.phone}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="hidden text-muted-foreground lg:table-cell">
                              {new Date(member.createdAt).toLocaleDateString()}
                            </TableCell>
                            {canInviteMembers && (
                              <TableCell className="text-right">
                                <DropdownMenu>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                          <MoreVertical className="h-4 w-4" />
                                          <span className="sr-only">Open member actions</span>
                                        </Button>
                                      </DropdownMenuTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent>Member actions</TooltipContent>
                                  </Tooltip>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => handleEditMember(member)}>
                                      <Edit className="h-4 w-4 mr-2" />
                                      Edit Member
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleDeleteMember(member)}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Remove Member
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {canInviteMembers && (
          <TabsContent value="add-members">
            <AddMembersSection
              workspaceId={currentWorkspace.id}
              workspaceName={currentWorkspace.name}
              currentUserId={user!.id}
            />
          </TabsContent>
        )}
      </Tabs>

      {/* Edit Member Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Team Member</DialogTitle>
            <DialogDescription>Update member details and permissions</DialogDescription>
          </DialogHeader>
          {editingMember && (
            <form onSubmit={handleUpdateMember}>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" defaultValue={editingMember.name} required />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    defaultValue={editingMember.email}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" name="phone" type="tel" defaultValue={editingMember.phone} />
                </div>
                <div>
                  <Label htmlFor="role">Role</Label>
                  <Select name="role" defaultValue={editingMember.role}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ROLE_CONFIG).map(([role, config]) => (
                        <SelectItem key={role} value={role}>
                          {config.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="status">Status</Label>
                  <Select name="status" defaultValue={editingMember.status}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                        <SelectItem key={status} value={status}>
                          {config.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateMember.isPending}>
                  {updateMember.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Member Confirmation Dialog */}
      <DeleteMemberDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        member={memberToDelete}
        onConfirm={confirmDeleteMember}
        isDeleting={deleteMember.isPending}
      />
    </div>
  );
}
