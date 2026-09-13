'use client';

import { getFunctionalRequirementStatusConfig } from '@/lib/semantic/status';
import { getComplexityConfig } from '@/lib/semantic/complexity';

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
import { useTasksByFunctionalRequirement, useUpdateTask } from '@/hooks/use-task';
import { toast } from '@/hooks/use-toast';
import { getInitials } from '@/lib/utils';
import { logger } from '@/lib/logger';

interface FRAssignmentCardProps {
  /** Assigning or unassigning PATCHes the FR and its tasks, so it needs
   *  `requirement:write`. Defaults to false: an omitted prop shows the roster
   *  read-only rather than a control the API will refuse. */
  canEdit?: boolean;
  fr: FunctionalRequirement;
  /**
   * The workspace roster as `useWorkspaceMembers` returns it — `id` is the USER
   * id, which is what `fr.assignedTo` holds. Typed as the roster row rather than
   * `User` so the only call site (the sprint backlog) no longer needs `as any`.
   */
  teamMembers: WorkspaceMemberUser[];
  projectId: string;
}

export function FRAssignmentCard({
  fr,
  teamMembers,
  projectId,
  canEdit = false,
}: FRAssignmentCardProps) {
  const updateFR = useUpdateFunctionalRequirement();
  const updateTask = useUpdateTask();
  const { data: linkedTasks = [] } = useTasksByFunctionalRequirement(fr.id);
  const [isAssigning, setIsAssigning] = React.useState(false);

  const assignedMembers = React.useMemo(() => {
    if (!fr.assignedTo || fr.assignedTo.length === 0) return [];
    return teamMembers.filter((member) => fr.assignedTo?.includes(member.id));
  }, [fr.assignedTo, teamMembers]);

  const unassignedMembers = React.useMemo(() => {
    if (!fr.assignedTo || fr.assignedTo.length === 0) return teamMembers;
    return teamMembers.filter((member) => !fr.assignedTo?.includes(member.id));
  }, [fr.assignedTo, teamMembers]);

  const handleAssignMember = async (userId: string) => {
    const member = teamMembers.find((m) => m.id === userId);
    if (!member) return;

    const currentAssignedTo = fr.assignedTo || [];
    const currentAssignedToNames = fr.assignedToNames || [];
    const newAssignedTo = [...currentAssignedTo, userId];
    const newAssignedToNames = [...currentAssignedToNames, member.name];

    await updateFR.mutateAsync({
      requirementId: fr.id,
      projectId,
      updates: {
        assignedTo: newAssignedTo,
        assignedToNames: newAssignedToNames,
      },
    });

    // ✅ AUTO-ASSIGN: Update linked tasks with the same assignees
    if (linkedTasks.length > 0) {
      try {
        await Promise.all(
          linkedTasks.map((task) =>
            updateTask.mutateAsync({
              taskId: task.id,
              projectId,
              // silent: this handler emits ONE toast at the end covering the FR
              // and the whole fan-out. Without it each linked task added its own.
              silent: true,
              updates: {
                assignedTo: newAssignedTo,
                assignedToNames: newAssignedToNames,
                assigneeIds: newAssignedTo,
              },
            })
          )
        );
      } catch (error) {
        logger.error('Failed to update linked tasks', { error });
        toast({
          title: 'Partial Success',
          description: `Assigned ${member.name} to FR but failed to update some linked tasks.`,
          variant: 'destructive',
        });
        setIsAssigning(false);
        return;
      }
    }

    // The only success feedback on this path: useUpdateFunctionalRequirement is
    // deliberately silent and the per-task updates are silenced above, so
    // without this the click looked like a no-op until the invalidation
    // round-tripped and users re-clicked.
    toast({
      title: 'Success',
      description: linkedTasks.length
        ? `Assigned ${member.name} to ${fr.hierarchyId} and ${linkedTasks.length} linked task(s)`
        : `Assigned ${member.name} to ${fr.hierarchyId}`,
    });

    setIsAssigning(false);
  };

  const handleUnassignMember = async (userId: string) => {
    const currentAssignedTo = fr.assignedTo || [];
    const currentAssignedToNames = fr.assignedToNames || [];
    const index = currentAssignedTo.indexOf(userId);

    if (index === -1) return;

    const removedName = currentAssignedToNames[index] ?? 'member';
    const newAssignedTo = currentAssignedTo.filter((id) => id !== userId);
    const newAssignedToNames = currentAssignedToNames.filter((_, i) => i !== index);

    await updateFR.mutateAsync({
      requirementId: fr.id,
      projectId,
      updates: {
        assignedTo: newAssignedTo,
        assignedToNames: newAssignedToNames,
      },
    });

    // ✅ AUTO-UNASSIGN: Update linked tasks with the same assignees
    if (linkedTasks.length > 0) {
      try {
        await Promise.all(
          linkedTasks.map((task) =>
            updateTask.mutateAsync({
              taskId: task.id,
              projectId,
              silent: true, // one toast for the whole fan-out, emitted below
              updates: {
                assignedTo: newAssignedTo,
                assignedToNames: newAssignedToNames,
                assigneeIds: newAssignedTo,
              },
            })
          )
        );
      } catch (error) {
        logger.error('Failed to update linked tasks', { error });
        toast({
          title: 'Partial Success',
          description: `Removed from FR but failed to update some linked tasks.`,
          variant: 'destructive',
        });
        return;
      }
    }

    toast({
      title: 'Success',
      description: linkedTasks.length
        ? `Removed ${removedName} from ${fr.hierarchyId} and ${linkedTasks.length} linked task(s)`
        : `Removed ${removedName} from ${fr.hierarchyId}`,
    });
  };

  const status = getFunctionalRequirementStatusConfig(fr.status);
  const complexity = getComplexityConfig(fr.complexity);

  return (
    <Card className="hover-lift">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <Badge variant="outline" className="font-mono text-xs">
                {fr.hierarchyId}
              </Badge>
              <Badge variant={complexity.badgeVariant}>
                Complexity: {complexity.label}
              </Badge>
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
                      className="h-4 w-4 rounded-full hover:bg-destructive hover:text-destructive-foreground"
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

        {/* FR Metadata */}
        <div className="flex items-center gap-3 pt-2 border-t text-xs text-muted-foreground">
          <Badge variant={status.badgeVariant} className={status.badgeClassName}>
            Status: {status.label}
          </Badge>
          {fr.priority && (
            <Badge variant="outline" className="border-primary/20">
              Priority: {fr.priority}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
