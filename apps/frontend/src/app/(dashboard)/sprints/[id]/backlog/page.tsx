'use client';

import { PageHeader } from '@/components/layout/page-header';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSprint } from '@/hooks/use-sprint';
import { useTasks } from '@/hooks/use-task';
import {
  useFunctionalRequirements,
  useFunctionalRequirementsBySprint,
  useUpdateFunctionalRequirement,
} from '@/hooks/use-functional-requirement';
import { useWorkspaceMembers } from '@/hooks/use-workspace';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, PlusCircle, FileText } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { FRAssignmentCard } from '@/components/sprints/fr-assignment-card';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { plural } from '@/lib/plural';
import { logger } from '@/lib/logger';

export default function SprintBacklogPage() {
  const params = useParams();
  const router = useRouter();
  const sprintId = params.id as string;
  const canEditFR = useHasPermission(Permission.EDIT_FUNCTIONAL_REQUIREMENT);

  const {
    data: sprint,
    isLoading: sprintLoading,
    isError: sprintError,
    refetch: refetchSprint,
  } = useSprint(sprintId);
  const { data: allTasks, isLoading: tasksLoading } = useTasks(sprint?.projectId);
  const { data: allFRs } = useFunctionalRequirements(sprint?.projectId);
  const { data: sprintFRs } = useFunctionalRequirementsBySprint(sprintId);
  const { data: workspaceMembers = [] } = useWorkspaceMembers(sprint?.workspaceId);
  const updateFR = useUpdateFunctionalRequirement();

  const sprintTasks = React.useMemo(() => {
    if (!allTasks || !sprintId) return [];
    return allTasks.filter((task) => task.sprintId === sprintId);
  }, [allTasks, sprintId]);

  // ✅ NEW: Separate FRs into backlog and sprint
  const backlogFRs = React.useMemo(() => {
    if (!allFRs) return [];
    return allFRs.filter((fr) => !fr.sprintId || fr.sprintId === '');
  }, [allFRs]);

  const assignedSprintFRs = React.useMemo(() => {
    return sprintFRs || [];
  }, [sprintFRs]);

  // Sprint task counts (replaces removed story points / capacity fields)
  const totalSprintTasks = React.useMemo(() => sprintTasks.length, [sprintTasks]);
  const completedSprintTasks = React.useMemo(
    () => sprintTasks.filter((t) => t.status === 'DONE').length,
    [sprintTasks]
  );
  const completionPercentage =
    totalSprintTasks > 0 ? Math.round((completedSprintTasks / totalSprintTasks) * 100) : 0;

  // ✅ NEW: Handle FR sprint assignment
  const handleAssignFRToSprint = async (frId: string) => {
    const fr = allFRs?.find((f) => f.id === frId);
    if (!fr) return;

    try {
      await updateFR.mutateAsync({
        requirementId: frId,
        projectId: fr.projectId,
        updates: { sprintId: sprintId },
      });

      toast({
        title: 'FR assigned to sprint',
        description: `${fr.hierarchyId} - ${fr.title}`,
      });
    } catch (error) {
      logger.error('Failed to assign FR to sprint', { error });
      toast({
        title: 'Error',
        description: 'Failed to assign FR to sprint',
        variant: 'destructive',
      });
    }
  };

  const handleRemoveFRFromSprint = async (frId: string) => {
    const fr = allFRs?.find((f) => f.id === frId);
    if (!fr) return;

    try {
      await updateFR.mutateAsync({
        requirementId: frId,
        projectId: fr.projectId,
        updates: { sprintId: '' },
      });

      toast({
        title: 'FR removed from sprint',
        description: `${fr.hierarchyId} - ${fr.title}`,
      });
    } catch (error) {
      logger.error('Failed to remove FR from sprint', { error });
    }
  };

  if (sprintLoading || tasksLoading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <p className="text-muted-foreground">Loading sprint backlog...</p>
      </div>
    );
  }

  // isError BEFORE the not-found branch. A 500 (or an offline blip) leaves
  // `sprint` undefined exactly like a deleted sprint does, so every sub-page
  // told the user a sprint that plainly exists was "Sprint not found" — a
  // dead end with nothing to retry.
  if (sprintError) {
    return (
      <ErrorState
        className="mt-10"
        title="Couldn't load this sprint"
        description="The sprint is still there — this is a connection problem."
        onRetry={() => void refetchSprint()}
      />
    );
  }

  if (!sprint) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh]">
        <p className="text-muted-foreground mb-4">Sprint not found</p>
        <Button onClick={() => router.push('/sprints')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Sprints
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => router.push('/sprints')} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Sprints
        </Button>

        <PageHeader
          title={sprint.name}
          description="Sprint Backlog - Manage sprint assignments and backlog priorities"
          actions={
            <>
              <Button variant="outline" onClick={() => router.push(`/sprints/${sprintId}/board`)}>
                Open Board
              </Button>
              <Button variant="outline" onClick={() => router.push(`/sprints/${sprintId}/analytics`)}>
                View Analytics
              </Button>
            </>
          }
        />
      </div>

      {/* Sprint Progress Card. This was labelled "Sprint Capacity" and carried an
          "Over capacity!" warning, but the number is completed/total — bounded by
          100 by construction, so the warning could never fire. No capacity field
          exists on Sprint, so report progress honestly instead. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Sprint Progress</span>
            <Badge variant="secondary">
              {completedSprintTasks} / {totalSprintTasks} tasks ({completionPercentage}%)
            </Badge>
          </CardTitle>
          <CardDescription>{plural(sprintTasks.length, 'task')} in sprint</CardDescription>
        </CardHeader>
      </Card>

      {/* ✅ FRs Section - Only Sprint FRs and FR Backlog */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Sprint FRs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Sprint FRs ({assignedSprintFRs.length})
            </CardTitle>
            <CardDescription>Functional requirements assigned to this sprint</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 min-h-100">
              {assignedSprintFRs.length > 0 ? (
                assignedSprintFRs.map((fr) => (
                  <div key={fr.id} className="relative">
                    <FRAssignmentCard
                      fr={fr}
                      teamMembers={workspaceMembers}
                      projectId={sprint.projectId}
                      canEdit={canEditFR}
                    />
                    {canEditFR && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-2 right-2"
                        onClick={() => handleRemoveFRFromSprint(fr.id)}
                      >
                        Remove from Sprint
                      </Button>
                    )}
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-100 text-center p-4 bg-muted/30 rounded-lg border-2 border-dashed">
                  <FileText className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No FRs assigned to this sprint yet</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Drag or click FRs from the backlog to assign them
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Backlog FRs */}
        <Card>
          <CardHeader>
            <CardTitle>FR Backlog ({backlogFRs.length})</CardTitle>
            <CardDescription>Unassigned functional requirements</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 min-h-100">
              {backlogFRs.length > 0 ? (
                backlogFRs.map((fr) => (
                  <div key={fr.id} className="relative">
                    <FRAssignmentCard
                      fr={fr}
                      teamMembers={workspaceMembers}
                      projectId={sprint.projectId}
                      canEdit={canEditFR}
                    />
                    {canEditFR && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="absolute top-2 right-2"
                        onClick={() => handleAssignFRToSprint(fr.id)}
                      >
                        <PlusCircle className="h-4 w-4 mr-2" />
                        Add to Sprint
                      </Button>
                    )}
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-100 text-center p-4 bg-muted/30 rounded-lg">
                  <FileText className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No FRs in backlog</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Create functional requirements in your project first
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
