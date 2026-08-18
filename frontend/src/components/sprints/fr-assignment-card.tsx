'use client';

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
import type { FunctionalRequirement, User } from '@/types';
import { useUpdateFunctionalRequirement } from '@/hooks/use-functional-requirement';
import { useTasksByFunctionalRequirement, useUpdateTask } from '@/hooks/use-task';
import { toast } from '@/hooks/use-toast';
import { getInitials } from '@/lib/utils';
import { logger } from '@/lib/logger';

const statusConfig: Record<FunctionalRequirement['status'], { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: 'bg-gray-500' },
  REVIEW: { label: 'In Review', color: 'bg-yellow-500' },
  APPROVED: { label: 'Approved', color: 'bg-blue-500' },
  IMPLEMENTED: { label: 'Implemented', color: 'bg-purple-500' },
  TESTED: { label: 'Tested', color: 'bg-indigo-500' },
  DEPLOYED: { label: 'Deployed', color: 'bg-green-500' },
};

const complexityConfig: Record<
  FunctionalRequirement['complexity'],
  { label: string; color: string }
> = {
  LOW: { label: 'Low', color: 'green' },
  MEDIUM: { label: 'Medium', color: 'yellow' },
  HIGH: { label: 'High', color: 'orange' },
  VERY_HIGH: { label: 'Very High', color: 'red' },
};

interface FRAssignmentCardProps {
  fr: FunctionalRequirement;
  teamMembers: User[];
  projectId: string;
}

export function FRAssignmentCard({ fr, teamMembers, projectId }: FRAssignmentCardProps) {
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
              updates: {
                assignedTo: newAssignedTo,
                assignedToNames: newAssignedToNames,
                assigneeIds: newAssignedTo,
              },
            })
          )
        );
        toast({
          title: 'Success',
          description: `Assigned ${member.name} to ${fr.hierarchyId} and ${linkedTasks.length} linked task(s)`,
        });
      } catch (error) {
        logger.error('Failed to update linked tasks', { error });
        toast({
          title: 'Partial Success',
          description: `Assigned ${member.name} to FR but failed to update some linked tasks.`,
          variant: 'destructive',
        });
      }
    } else {
      toast({
        title: 'Success',
        description: `Assigned ${member.name} to ${fr.hierarchyId}`,
      });
    }

    setIsAssigning(false);
  };

  const handleUnassignMember = async (userId: string) => {
    const currentAssignedTo = fr.assignedTo || [];
    const currentAssignedToNames = fr.assignedToNames || [];
    const index = currentAssignedTo.indexOf(userId);

    if (index === -1) return;

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
              updates: {
                assignedTo: newAssignedTo,
                assignedToNames: newAssignedToNames,
                assigneeIds: newAssignedTo,
              },
            })
          )
        );
        toast({
          title: 'Success',
          description: `Removed team member from ${fr.hierarchyId} and ${linkedTasks.length} linked task(s)`,
        });
      } catch (error) {
        logger.error('Failed to update linked tasks', { error });
        toast({
          title: 'Partial Success',
          description: `Removed from FR but failed to update some linked tasks.`,
          variant: 'destructive',
        });
      }
    } else {
      toast({
        title: 'Success',
        description: `Removed team member from ${fr.hierarchyId}`,
      });
    }
  };

  const status = statusConfig[fr.status];
  const complexity = complexityConfig[fr.complexity];

  const complexityColor = {
    LOW: 'bg-green-500',
    MEDIUM: 'bg-yellow-500',
    HIGH: 'bg-orange-500',
    VERY_HIGH: 'bg-red-500',
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <Badge variant="outline" className="font-mono text-xs">
                {fr.hierarchyId}
              </Badge>
              <Badge className={complexityColor[fr.complexity]}>
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 rounded-full hover:bg-destructive hover:text-destructive-foreground"
                    onClick={() => handleUnassignMember(member.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No team members assigned</p>
          )}
        </div>

        {/* Assign New Member */}
        {unassignedMembers.length > 0 && (
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
          <Badge variant="secondary" className={status.color}>
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
