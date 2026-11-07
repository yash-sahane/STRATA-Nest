'use client';

import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';

import * as React from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useTabParam } from '@/hooks/use-tab-param';
import {
  useJoinRequestsRealtime,
  useWorkspaceMembersRealtime,
  useWorkspaceTasksRealtime,
} from '@/hooks/use-realtime';
import { useWorkspaceTasks } from '@/hooks/use-task';
import {
  useTeamMembers,
  useUpdateTeamMember,
  useChangeSignInEmail,
  useDeleteTeamMember,
  useMemberTaskCounts,
  getWorkloadLevel,
  ROLE_CONFIG,
  STATUS_CONFIG,
  TeamMember,
  TeamMemberUpdate,
  useReissueTempPassword,
} from '@/hooks/use-team';
import { useJoinRequests } from '@/hooks/use-join-request';
import { useCanGrantRole, useHasPermission, useHasPermissionKey } from '@/hooks/use-permissions';
import { useGrantableRolesWith } from '@/hooks/use-role-options';
import { Permission } from '@/lib/permissions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn, formatDate } from '@/lib/utils';
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
  Phone,
  Trash2,
  Edit,
  UserCheck,
  UserPlus,
  ShieldCheck,
  KeyRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { ResourceAllocationCard } from '@/components/team/resource-allocation-card';
import { AddMembersSection } from '@/components/team/add-members-section';
import { JoinRequestsSection } from '@/components/team/join-requests-section';
import { DeleteMemberDialog } from '@/components/team/delete-member-dialog';
import {
  TempPasswordNotice,
  type IssuedCredential,
} from '@/components/team/temp-password-notice';
import { calculateTeamWorkload } from '@/lib/team-workload';
import { logger } from '@/lib/logger';
import { getInitials } from '@/lib/utils';
import { useConfirm } from '@/components/providers/confirm-provider';

const TEAM_TABS = ['members', 'add-members', 'requests'] as const;
type TeamTab = (typeof TEAM_TABS)[number];

function TeamPageContent() {
  const { user } = useAuth();
  const confirm = useConfirm();
  // In the URL so a "new join request" notification can land on the queue.
  const [tab, setTab] = useTabParam<TeamTab>(TEAM_TABS, 'members');
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();
  // Realtime: a member joining or leaving left both workload panels stale.
  useWorkspaceMembersRealtime(currentWorkspace?.id);
  // The page also shows each member's workload and the join-request queue; it
  // heard about neither, so a reassignment or a new request did not show until
  // a reload — while the bell had already said "New join request".
  useWorkspaceTasksRealtime(currentWorkspace?.id);
  useJoinRequestsRealtime(currentWorkspace?.id);

  const {
    data: teamMembers = [],
    isLoading: membersLoading,
    isError: membersError,
    refetch: refetchMembers,
  } = useTeamMembers(
    currentWorkspace?.id
  );
  const { data: tasks, isLoading: tasksLoading } = useWorkspaceTasks(currentWorkspace?.id);
  const { data: taskCounts } = useMemberTaskCounts(currentWorkspace?.id);
  const updateMember = useUpdateTeamMember();
  const changeEmail = useChangeSignInEmail();
  const deleteMember = useDeleteTeamMember();

  // Invite gating (Add Members tab) is separate from member management gating
  // (Actions column) — each action checks its own permission.
  const canInviteMembers = useHasPermission(Permission.INVITE_MEMBER);
  // The queue is `join:manage` on the server — reading it, deciding it, and
  // being notified of it. It used to ride on the invite permission: a role with
  // only `member:invite` was shown an empty queue as fact, and a role with only
  // `join:manage` was notified of a request and had no tab to open.
  const canReviewRequests = useHasPermissionKey(currentWorkspace?.id, 'join:manage');
  const canEditMembers = useHasPermission(Permission.EDIT_MEMBER);
  const canRemoveMembers = useHasPermission(Permission.REMOVE_MEMBER);
  const canManageMembers = canEditMembers || canRemoveMembers;
  // Rank: the API refuses a role grant above the caller's own, and refuses to
  // change or remove a member who outranks them.
  const canGrantRole = useCanGrantRole(currentWorkspace?.id);
  const grantableRolesWith = useGrantableRolesWith(currentWorkspace?.id);

  // Shares the cache entry with the Join Requests tab below, so the summary
  // card and the queue can never disagree — and gated on the same permission
  // as that tab, because the ENDPOINT is: GET /join_requests only returns the
  // rows of workspaces where the caller holds join:manage (plus their own
  // requests). Ungated, a plain member read an empty list as fact and the card
  // stated a confident "0 people awaiting review" over a queue it cannot see
  // and has no tab to open. Passing undefined disables the query outright, so
  // those visitors also stop paying for a list request they can't use.
  const { data: joinRequests = [] } = useJoinRequests(
    canReviewRequests ? currentWorkspace?.id : undefined
  );
  // A request whose author has since joined by another route is not a decision
  // waiting on anybody: the API flags it (`alreadyMember`) and the queue offers
  // only "Clear request" for it, so counting it here would overstate the work.
  const awaitingReview = React.useMemo(
    () => joinRequests.filter((request) => !request.alreadyMember).length,
    [joinRequests]
  );

  const [searchQuery, setSearchQuery] = React.useState('');
  /**
   * Filter options: what is CONFIGURED, plus whatever is actually on the roster.
   *
   * Built from ROLE_CONFIG/STATUS_CONFIG alone, a member holding a custom workspace
   * role showed up in the table — the row renderer falls back to ROLE_CONFIG.MEMBER
   * for an unknown key — while their role had no entry in the picker. So the only
   * value a user could see was the one they could not filter by.
   *
   * An unconfigured value keeps its raw name: inventing a friendly label for a role
   * this page knows nothing about would be its own kind of guess.
   */
  /**
   * Is this the name of a role this page already has a label and colour for?
   *
   * Memberships store built-ins as the uppercase key (MANAGER) while ROLE_CONFIG is
   * keyed the same way and carries the friendly label, so both spellings count. A
   * name that is neither is a custom workspace role and is shown as stored.
   */
  const isKnownRoleName = React.useCallback((raw?: string): boolean => {
    if (!raw) return false;
    const keys: string[] = Object.keys(ROLE_CONFIG);
    const labels: string[] = Object.values(ROLE_CONFIG).map((c) => c.label);
    return keys.includes(raw) || labels.includes(raw);
  }, []);

  const roleOptions = React.useMemo(() => {
    // Every role present on the roster, plus the built-ins. Keyed on rawRole — the
    // value actually stored — because the normalised `role` collapses every custom
    // workspace role to MEMBER, so a "Release Captain" could neither be seen for what
    // they are nor filtered for. Built-ins are listed under their friendly label and
    // matched by it, so the list does not carry both "Manager" and "MANAGER".
    const present = (teamMembers.map((m) => m.rawRole).filter(Boolean) as string[]).filter(
      (r) => !isKnownRoleName(r),
    );
    const configured = (Object.keys(ROLE_CONFIG) as Array<keyof typeof ROLE_CONFIG>).map((key) => ({
      value: key,
      label: ROLE_CONFIG[key].label,
    }));
    return [...configured, ...[...new Set(present)].map((r) => ({ value: r, label: r }))];
  }, [teamMembers, isKnownRoleName]);

  const statusOptions = React.useMemo(() => {
    const configured = Object.keys(STATUS_CONFIG);
    const present = teamMembers.map((m) => m.status).filter(Boolean) as string[];
    return [...new Set([...configured, ...present])].map((status) => ({
      value: status,
      label: STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]?.label ?? status,
    }));
  }, [teamMembers]);

  const [selectedRole, setSelectedRole] = React.useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = React.useState<string>('ALL');
  const [editingMember, setEditingMember] = React.useState<TeamMember | null>(null);
  const [memberToDelete, setMemberToDelete] = React.useState<TeamMember | null>(null);
  // A temporary password the API handed back because it could not be mailed.
  const [reissued, setReissued] = React.useState<IssuedCredential[]>([]);
  const reissuePassword = useReissueTempPassword();

  // A platform administrator can reset anybody's password (the API allows it);
  // a manager only the password of somebody who has never signed in.
  const platformAdmin = user?.isAdmin === true;
  const handleReissuePassword = async (member: TeamMember) => {
    if (!member.awaitingFirstSignIn) {
      // A password they set themselves: replacing it signs them out everywhere.
      const proceed = await confirm({
        title: `Reset ${member.name}'s password?`,
        description:
          'They are signed out on every device and sign in next with a temporary password, which they then replace.',
        confirmText: 'Reset password',
        destructive: true,
      });
      if (!proceed) return;
    }
    try {
      const result = await reissuePassword.mutateAsync({
        userId: member.userId,
        workspaceId: member.workspaceId,
      });
      if (result.temporaryPassword) {
        // Shown once, here, and nowhere else — see TempPasswordNotice.
        setReissued([
          { name: member.name, email: member.email, temporaryPassword: result.temporaryPassword },
        ]);
        toast.success('New temporary password issued', {
          description: `Email is not set up here, so pass it to ${member.name} yourself. It is shown above the list.`,
        });
      } else {
        toast.success('New temporary password sent', {
          description: `It has been emailed to ${member.email}. The old one no longer works.`,
        });
      }
    } catch (error) {
      toast.error("Couldn't issue a new password", {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };
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
      // A built-in option carries the ROLE_CONFIG key, so it matches the normalised
      // role; a custom one carries the stored name, so it matches rawRole. Comparing
      // only the normalised role made every custom role look like MEMBER.
      const matchesRole =
        selectedRole === 'ALL' || member.role === selectedRole || member.rawRole === selectedRole;
      const matchesStatus = selectedStatus === 'ALL' || member.status === selectedStatus;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [teamMembers, searchQuery, selectedRole, selectedStatus]);

  // Calculate stats
  const stats = React.useMemo(() => {
    const totalMembers = teamMembers.length;
    const activeMembers = teamMembers.filter((member) => member.status === 'ACTIVE').length;
    const roleBreakdown = teamMembers.reduce(
      (acc, member) => {
        acc[member.role] = (acc[member.role] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    const activeRate = totalMembers > 0 ? Math.round((activeMembers / totalMembers) * 100) : 0;
    const roleCount = Object.keys(roleBreakdown).length;

    return { totalMembers, activeMembers, activeRate, roleBreakdown, roleCount };
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
      // Was "Pending Invites". Invitations waiting on an answer show on the
      // roster itself, as "Invited (not joined yet)"; the queue waiting on a
      // decision HERE is the join requests, which only a caller who can action
      // them is allowed to read — hence the gate.
      ...(canReviewRequests
        ? [
            {
              title: 'Pending Requests',
              value: awaitingReview,
              detail:
                awaitingReview === 1
                  ? '1 person awaiting review'
                  : `${awaitingReview} people awaiting review`,
              icon: UserPlus,
            },
          ]
        : []),
      {
        title: 'Role Coverage',
        value: stats.roleCount,
        detail:
          stats.roleCount === 1 ? '1 role represented' : `${stats.roleCount} roles represented`,
        icon: ShieldCheck,
      },
    ],
    [stats, awaitingReview, canReviewRequests]
  );

  // Each member's open tasks, against what counts as a full load.
  const workloadData = React.useMemo(() => {
    if (!tasks || !teamMembers) return null;
    return calculateTeamWorkload(tasks, teamMembers);
  }, [tasks, teamMembers]);

  const handleEditMember = (member: TeamMember) => {
    setEditingMember(member);
    setIsEditDialogOpen(true);
  };

  const handleUpdateMember = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingMember) return;

    const formData = new FormData(e.currentTarget);
    // The API persists only role and status on a workspace membership —
    // name/email/phone belong to the user's own profile. Send only what
    // actually changed: resubmitting the role on a status-only edit would
    // overwrite a custom workspace role with the normalized display value.
    const role = formData.get('role') as string;
    const status = formData.get('status') as TeamMember['status'];
    const email = String(formData.get('email') ?? editingMember.email).trim();
    const updates: TeamMemberUpdate = {};
    if (role !== editingMember.rawRole) updates.role = role;
    if (status !== editingMember.status) updates.status = status;
    const emailChanged = user?.isAdmin === true && email.toLowerCase() !== editingMember.email.toLowerCase();

    if (emailChanged) {
      try {
        await changeEmail.mutateAsync({
          userId: editingMember.userId,
          workspaceId: editingMember.workspaceId,
          email,
        });
        toast.success('Sign-in email changed', {
          description: `${editingMember.name} signs in with ${email.toLowerCase()} from now on.`,
        });
      } catch (error) {
        toast.error("Couldn't change the sign-in email", {
          description: error instanceof Error ? error.message : undefined,
        });
        return;
      }
    }

    if (Object.keys(updates).length === 0) {
      setIsEditDialogOpen(false);
      setEditingMember(null);
      return;
    }

    try {
      await updateMember.mutateAsync({
        id: editingMember.id,
        data: updates,
      });

      // Say what a non-ACTIVE status actually does: the save used to report
      // plain success while quietly cutting the member off from the workspace.
      toast.success('Team member updated successfully', {
        description:
          updates.status && updates.status !== 'ACTIVE'
            ? `${editingMember.name} can no longer open this workspace.`
            : undefined,
      });
      setIsEditDialogOpen(false);
      setEditingMember(null);
    } catch (error) {
      // The API refuses edits that would orphan the workspace — show its reason.
      toast.error('Failed to update team member', {
        description: error instanceof Error ? error.message : undefined,
      });
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

      toast.success(
        memberToDelete.status === 'INVITED'
          ? `Invitation to ${memberToDelete.name} withdrawn`
          : `${memberToDelete.name} removed from the workspace`
      );
      setDeleteDialogOpen(false);
      setMemberToDelete(null);
    } catch (error) {
      // The server says why (the owner, the last manager, a higher role): say it.
      toast.error("Couldn't remove the member", {
        description: error instanceof Error ? error.message : undefined,
      });
      logger.error('Unexpected error', { error: error });
    }
  };

  if (workspacesLoading || membersLoading) {
    return <PageLoader message="Loading team members..." />;
  }

  if (membersError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Team" description="We couldn't load your team members." />
        <ErrorState onRetry={() => refetchMembers()} />
      </div>
    );
  }

  if (!currentWorkspace) {
    return (
      <EmptyState
        icon={Users}
        title="No workspace found"
        description="Create a workspace to manage team members."
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        icon={Users}
        title="Team"
        description={`Manage members, roles, and workload for ${currentWorkspace.name}`}
      />

      {/* Team Management Tabs */}
      <Tabs
        // Each of the other two tabs exists only for someone allowed to use it;
        // a link to one must not leave anybody else on an empty page.
        value={
          (tab === 'add-members' && !canInviteMembers) || (tab === 'requests' && !canReviewRequests)
            ? 'members'
            : tab
        }
        onValueChange={(next) => setTab(next as TeamTab)}
        className="space-y-6"
      >
        <TabsList className="flex h-auto w-full flex-wrap justify-start sm:w-fit">
          <TabsTrigger value="members">Team Members</TabsTrigger>
          {canInviteMembers && <TabsTrigger value="add-members">Add Members</TabsTrigger>}
          {canReviewRequests && <TabsTrigger value="requests">Join Requests</TabsTrigger>}
        </TabsList>

        <TabsContent value="members" className="space-y-6">
          {/* Stats Cards */}
          <div
            className={cn(
              'grid gap-3 sm:grid-cols-2',
              // One card is permission-gated, so the track count follows the
              // cards rather than leaving a hole in the row.
              summaryCards.length === 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-3'
            )}
          >
            {summaryCards.map((card) => {
              const Icon = card.icon;

              return (
                <Card
                  key={card.title}
                  className="overflow-hidden"
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
          {/* Rendered while the tasks are still coming, not after. `workloadData` is null
              until they arrive, so gating on it alone meant this whole card was ABSENT and
              then appeared — shoving the Team Directory below it down the page. Measured
              with the task list held back 4s: CLS 0.1799 against a "good" bar of 0.1. The
              card now occupies its space from the first paint and fills in where it
              stands. */}
          {(workloadData || tasksLoading) && (
            <ResourceAllocationCard
              workloadData={workloadData?.members ?? []}
              averageWorkload={workloadData?.averageWorkload ?? 0}
              // The roster is already here — this card renders below it — so the number
              // of rows to hold open is known exactly, and the placeholder is the same
              // height as the list that replaces it.
              isLoading={tasksLoading}
              placeholderRows={teamMembers.length}
            />
          )}

          {/* Filters & Team Directory */}
          <Card className="overflow-hidden">
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
                  <SelectTrigger aria-label="Filter members by role" className="w-full">
                    <SelectValue placeholder="Filter by role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Roles</SelectItem>
                    {roleOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger aria-label="Filter members by status" className="w-full">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Status</SelectItem>
                    {statusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <TempPasswordNotice credentials={reissued} onDismiss={() => setReissued([])} />

              {/* Team Members Table */}
              <div className="overflow-hidden rounded-md border">
                <Table className="min-w-[640px] lg:min-w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Workload</TableHead>
                      <TableHead className="hidden lg:table-cell">Joined</TableHead>
                      {canManageMembers && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMembers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={canManageMembers ? 7 : 6} className="text-center py-8">
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <Users className="h-8 w-8 opacity-50" />
                            <span>No team members found</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredMembers.map((member) => {
                        const isCurrentUser = member.userId === user?.id;
                        const isOwner = member.userId === currentWorkspace.ownerId;
                        // ...nor a member whose role can do more than the caller's.
                        const outranksMe = !canGrantRole(member.rawRole);
                        // An unanswered invitation is withdrawn, not removed — and
                        // asking somebody in and taking it back are one permission.
                        const isInvitation = member.status === 'INVITED';
                        const canRemoveThisMember =
                          (isInvitation ? canInviteMembers : canRemoveMembers) &&
                          !isOwner &&
                          !isCurrentUser &&
                          !outranksMe;
                        // Same rule as removal: the API refuses to demote or
                        // deactivate the owner or the caller, so don't offer it.
                        const canEditThisMember =
                          canEditMembers && !isOwner && !isCurrentUser && !outranksMe;
                        // The colour comes from the normalised role; the LABEL is
                        // what is actually stored. Using the config's label showed a
                        // custom workspace role as "Member", because normalizeRole
                        // falls back to MEMBER for anything outside its seven
                        // built-ins — so the roster reported the wrong role outright.
                        const roleConfig = ROLE_CONFIG[member.role] ?? ROLE_CONFIG.MEMBER;
                        // A built-in role keeps its friendly label; only a role this
                        // page does not know about is shown verbatim. Showing rawRole
                        // unconditionally turned "Manager" into "MANAGER", which is
                        // the stored key rather than a name for a human.
                        const roleLabel = isKnownRoleName(member.rawRole)
                          ? roleConfig.label
                          : member.rawRole || roleConfig.label;
                        const statusConfig = STATUS_CONFIG[member.status] ?? STATUS_CONFIG.ACTIVE;
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
                                    <span className="truncate" title={member.name}>{member.name}</span>
                                    {/* Somebody who was added and has never got in.
                                        Until now the roster showed them exactly like
                                        everybody else, so nobody knew to chase it. */}
                                    {member.awaitingFirstSignIn && (
                                      <Badge
                                        variant="outline"
                                        className="h-5 whitespace-nowrap rounded-md px-1.5 text-2xs font-medium"
                                      >
                                        Hasn&apos;t signed in yet
                                      </Badge>
                                    )}
                                    {isCurrentUser && (
                                      <Badge
                                        variant="secondary"
                                        className="h-5 rounded-md px-1.5 text-2xs font-medium"
                                      >
                                        You
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="truncate text-sm text-muted-foreground" title={member.email}>
                                    {member.email}
                                  </div>
                                  {/* The phone lives with the name and address now. A
                                      separate Contact column printed the email a second
                                      time, a few centimetres to the right, and its width
                                      pushed Joined and the row actions off the table at
                                      an ordinary 1440px window. */}
                                  {member.phone && (
                                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                      <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
                                      <span className="truncate">{member.phone}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge className={cn('whitespace-nowrap', roleConfig.color)}>
                                {roleLabel}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge className={cn('whitespace-nowrap', statusConfig.color)}>
                                {statusConfig.label}
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
                                  <span className="whitespace-nowrap text-sm font-medium">{activeTasks} active</span>
                                </div>
                                <div className="flex items-center gap-3 whitespace-nowrap text-xs text-muted-foreground">
                                  <span>{completedTasks} done</span>
                                  {overdueTasks > 0 && (
                                    <span className="text-red-500 font-medium">
                                      {overdueTasks} overdue
                                    </span>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                              {formatDate(member.createdAt)}
                            </TableCell>
                            {canManageMembers && (
                              <TableCell className="text-right">
                                {(canEditThisMember || canRemoveThisMember) && (
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
                                      {canEditThisMember && (
                                        <DropdownMenuItem onClick={() => handleEditMember(member)}>
                                          <Edit className="h-4 w-4 mr-2" />
                                          Edit Member
                                        </DropdownMenuItem>
                                      )}
                                      {((canEditThisMember && member.awaitingFirstSignIn) ||
                                        (platformAdmin && member.userId !== user?.id)) && (
                                        <DropdownMenuItem
                                          disabled={reissuePassword.isPending}
                                          onClick={() => handleReissuePassword(member)}
                                        >
                                          <KeyRound className="h-4 w-4 mr-2" />
                                          {member.awaitingFirstSignIn
                                            ? 'New Temporary Password'
                                            : 'Reset Password'}
                                        </DropdownMenuItem>
                                      )}
                                      {canRemoveThisMember && (
                                        <DropdownMenuItem
                                          onClick={() => handleDeleteMember(member)}
                                          className="text-destructive-text focus:text-destructive-text"
                                        >
                                          <Trash2 className="h-4 w-4 mr-2" />
                                          {isInvitation ? 'Withdraw Invitation' : 'Remove Member'}
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
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
          // Kept mounted while another tab is showing. This section holds the
          // only copy of a new account's temporary password when the server
          // cannot mail it; unmounting on a tab click threw it away, and there
          // is no way to issue another.
          <TabsContent value="add-members" forceMount className="data-[state=inactive]:hidden">
            <AddMembersSection
              workspaceId={currentWorkspace.id}
              workspaceName={currentWorkspace.name}
              currentUserId={user!.id}
            />
          </TabsContent>
        )}

        {canReviewRequests && (
          <TabsContent value="requests">
            <JoinRequestsSection workspaceId={currentWorkspace.id} />
          </TabsContent>
        )}
      </Tabs>

      {/* Edit Member Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Team Member</DialogTitle>
            <DialogDescription>
              {editingMember
                ? `Update the workspace role and status for ${editingMember.name} (${editingMember.email}).`
                : 'Update the workspace role and status for this member.'}
            </DialogDescription>
          </DialogHeader>
          {editingMember && (
            <form onSubmit={handleUpdateMember}>
              <div className="space-y-4">
                {user?.isAdmin === true && (
                  <div>
                    <Label htmlFor="member-email">Sign-in email</Label>
                    <Input
                      id="member-email"
                      name="email"
                      type="email"
                      defaultValue={editingMember.email}
                      required
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      As a platform administrator you can change the address they sign in with.
                    </p>
                  </div>
                )}
                <div>
                  <Label htmlFor="role">Role</Label>
                  {/* Seeded from the RAW role so a custom workspace role stays
                      selected — picking a built-in is then a deliberate change. */}
                  <Select name="role" defaultValue={editingMember.rawRole}>
                    <SelectTrigger id="role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Only roles the caller may hand out — the workspace's
                          custom roles among them — plus the one the member
                          already holds so the field is never blank. */}
                      {grantableRolesWith(editingMember.rawRole).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="status">Status</Label>
                  {editingMember.status === 'INVITED' && user?.isAdmin !== true ? (
                    // An invitation is the invited person's to answer: the API
                    // refuses any other status for it, so none is offered.
                    <>
                      <input type="hidden" name="status" value="INVITED" />
                      <p className="mt-2 text-sm text-muted-foreground">
                        Invited — waiting for {editingMember.name} to accept. Only they can; to
                        withdraw the invitation, remove it from the member list.
                      </p>
                    </>
                  ) : (
                  <>
                  {/* "Invited" is not an edit you can make to somebody who has
                      already joined: the API authorizes on `status: 'ACTIVE'`
                      alone, so applying it locks the member out of the whole
                      workspace behind a label that reads "not here yet". It
                      stays selectable only for a membership that already
                      carries it, so such a row can still be repaired. */}
                  <Select name="status" defaultValue={editingMember.status}>
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_CONFIG)
                        .filter(
                          ([status]) => status !== 'INVITED' || editingMember.status === 'INVITED'
                        )
                        .map(([status, config]) => (
                          <SelectItem key={status} value={status}>
                            {config.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Only Active members can open this workspace. Any other status revokes their
                    access — their data is kept, but they see nothing until it is set back.
                  </p>
                  </>
                  )}
                </div>
              </div>
              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateMember.isPending || changeEmail.isPending}>
                  {updateMember.isPending || changeEmail.isPending ? 'Saving...' : 'Save Changes'}
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
        onDeactivate={async () => {
          if (!memberToDelete) return;
          try {
            await updateMember.mutateAsync({ id: memberToDelete.id, data: { status: 'INACTIVE' } });
            toast.success(`${memberToDelete.name}'s access is switched off`, {
              description: 'Everything is kept. Switch it back on from Edit Member.',
            });
            setDeleteDialogOpen(false);
            setMemberToDelete(null);
          } catch (error) {
            toast.error("Couldn't switch their access off", {
              description: error instanceof Error ? error.message : undefined,
            });
          }
        }}
      />
    </div>
  );
}

// useTabParam reads useSearchParams(), which bails out of prerendering unless a
// Suspense boundary sits above the component that calls it.
export default function TeamPage() {
  return (
    <React.Suspense fallback={<PageLoader message="Loading team members..." />}>
      <TeamPageContent />
    </React.Suspense>
  );
}
