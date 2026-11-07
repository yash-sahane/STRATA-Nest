'use client';

import { getFunctionalRequirementStatusConfig } from '@/lib/semantic/status';
import { ComplexityBadge } from '@/components/requirements/complexity-badge';
import { getPriorityConfig } from '@/lib/semantic/priority';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { X, UserPlus, FileText } from 'lucide-react';
import type { FunctionalRequirement } from '@/types';
import type { WorkspaceMemberUser } from '@/hooks/use-workspace';
import { useUpdateFunctionalRequirement } from '@/hooks/use-functional-requirement';
import { getInitials } from '@/lib/utils';
import { useConfirm } from '@/components/providers/confirm-provider';
import { toast } from 'sonner';

interface FRAssignmentCardProps {
  /** Assigning or unassigning PATCHes the FR and its tasks, so it needs
   *  `requirement:write`. Defaults to false: an omitted prop shows the roster
   *  read-only rather than a control the API will refuse. */
  canEdit?: boolean;
  fr: FunctionalRequirement;
  /**
   * The workspace roster as `useWorkspaceMembers` returns it — `id` is the USER
   * id, which is what `fr.assigneeIds` holds. Typed as the roster row rather than
   * `User` so the only call site (the sprint backlog) no longer needs `as any`.
   */
  teamMembers: WorkspaceMemberUser[];
  projectId: string;
  /**
   * What planning can do with this requirement here ("Add to Sprint", "Remove
   * from Sprint"), drawn in the card's footer. The page used to put the button
   * under the card, where it read as belonging to the card below.
   */
  action?: React.ReactNode;
}

export function FRAssignmentCard({
  fr,
  teamMembers,
  projectId,
  canEdit = false,
  action,
}: FRAssignmentCardProps) {
  const updateFR = useUpdateFunctionalRequirement();
  const [isAssigning, setIsAssigning] = React.useState(false);

  const assignedMembers = React.useMemo(
    () => teamMembers.filter((member) => (fr.assigneeIds ?? []).includes(member.id)),
    [fr.assigneeIds, teamMembers]
  );

  const unassignedMembers = React.useMemo(
    () => teamMembers.filter((member) => !(fr.assigneeIds ?? []).includes(member.id)),
    [fr.assigneeIds, teamMembers]
  );

  const handleAssignMember = async (userId: string) => {
    const member = teamMembers.find((m) => m.id === userId);
    if (!member) return;

    await updateFR.mutateAsync({
      requirementId: fr.id,
      projectId,
      updates: { assigneeIds: [...(fr.assigneeIds ?? []), userId] },
    });

    // The requirement's tasks follow on the server (RequirementTasks): the ones
    // that had the requirement's people get the new list, and a task somebody
    // gave to a particular person keeps them. This card used to write the whole
    // list over every linked task itself.
    //
    // The only success feedback on this path: the hook is deliberately silent,
    // so without this the click looked like a no-op until the refetch landed.
    toast.success('Assigned', { description: `${member.name} is on ${fr.hierarchyId}.` });

    setIsAssigning(false);
  };

  const confirm = useConfirm();

  const handleUnassignMember = async (userId: string) => {
    const current = fr.assigneeIds ?? [];
    const index = current.indexOf(userId);

    if (index === -1) return;

    const removedName =
      (fr.assigneeNames ?? [])[index] ||
      teamMembers.find((member) => member.id === userId)?.name ||
      'member';

    // It moves their work: the requirement's open tasks lose them too.
    const confirmed = await confirm({
      title: `Take ${removedName} off ${fr.hierarchyId}?`,
      description: `${removedName} comes off its open tasks too, and is told.`,
      confirmText: 'Take off',
    });
    if (!confirmed) return;

    try {
      await updateFR.mutateAsync({
        requirementId: fr.id,
        projectId,
        updates: { assigneeIds: current.filter((id) => id !== userId) },
      });
    } catch {
      return; // the save's own toast has said why
    }

    toast.success('Removed', { description: `${removedName} is no longer on ${fr.hierarchyId} or its open tasks.` });
  };

  const status = getFunctionalRequirementStatusConfig(fr.status);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <Badge variant="outline" className="font-mono text-xs">
                {fr.hierarchyId}
              </Badge>
              <ComplexityBadge complexity={fr.complexity} showName />
            </div>
            <CardTitle className="text-base">{fr.title}</CardTitle>
          </div>
        </div>
        {fr.description && (
          <CardDescription className="line-clamp-2 mt-2">{fr.description}</CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Assigned Team Members */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">Assigned Team Members</div>

          {assignedMembers.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {assignedMembers.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center gap-2 bg-secondary/50 rounded-full pl-1 pr-3 py-1"
                >
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-xs">{getInitials(member.name)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{member.name}</span>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Unassign ${member.name}`}
                      className="h-6 w-6 rounded-full hover:bg-destructive hover:text-destructive-foreground"
                      onClick={() => handleUnassignMember(member.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No team members assigned</p>
          )}
        </div>

        {/* Assign New Member */}
        {canEdit && unassignedMembers.length > 0 && (
          <div className="space-y-2">
            {isAssigning ? (
              <div className="flex gap-2">
                <Select onValueChange={handleAssignMember}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select team member" />
                  </SelectTrigger>
                  <SelectContent>
                    {unassignedMembers.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-5 w-5">
                            <AvatarFallback className="text-xs">
                              {getInitials(member.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span>{member.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={() => setIsAssigning(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setIsAssigning(true)}
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Assign Team Member
              </Button>
            )}
          </div>
        )}

        {/* FR Metadata, and the planning action at its far end — wrapping
            under the badges on a narrow card rather than squeezing them. */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t text-xs text-muted-foreground">
          <Badge variant={status.badgeVariant} className={status.badgeClassName}>
            Status: {status.label}
          </Badge>
          {fr.priority && (
            <Badge variant="outline" className="border-primary/20">
              {getPriorityConfig(fr.priority).label} priority
            </Badge>
          )}
          {action && <div className="ml-auto">{action}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
