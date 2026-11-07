'use client';

import { SprintHeader, SprintUnavailable } from '@/components/sprints/sprint-header';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
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
import { PlusCircle, FileText, MinusCircle } from 'lucide-react';
import { FRAssignmentCard } from '@/components/sprints/fr-assignment-card';
import type { FunctionalRequirement } from '@/types';
import { useHasPermission } from '@/hooks/use-permissions';
import { useIsProjectArchived } from '@/hooks/use-project';
import { Permission } from '@/lib/permissions';
import { plural } from '@/lib/plural';
import { logger } from '@/lib/logger';
import { useSprintsRealtime, useTasksRealtime, useFunctionalRequirementsRealtime } from '@/hooks/use-realtime';
import { useConfirm } from '@/components/providers/confirm-provider';
import { toast } from 'sonner';

/**
 * A requirement with nothing left to plan: every task under it is done
 * ("Tasks Done"), or it has been signed off ("Done"). Planning one moved no
 * work into the sprint — or, with no task under it yet, made it a fresh one and
 * reopened a requirement somebody had signed off.
 */
const isFinished = (fr: Pick<FunctionalRequirement, 'status'>): boolean =>
  fr.status === 'TESTED' || fr.status === 'DEPLOYED';

export default function SprintBacklogPage() {
  const params = useParams();
  const sprintId = params.id as string;
  const mayEditFR = useHasPermission(Permission.EDIT_FUNCTIONAL_REQUIREMENT);
  const mayPlanSprints = useHasPermission(Permission.EDIT_SPRINT);
  const confirm = useConfirm();
  const mayCreateFR = useHasPermission(Permission.CREATE_FUNCTIONAL_REQUIREMENT);

  const {
    data: sprint,
    isLoading: sprintLoading,
    isError: sprintError,
    error: sprintLoadError,
    refetch: refetchSprint,
  } = useSprint(sprintId);
  // Nothing is planned into, or out of, a sprint of an archived project: the
  // project is read-only, and the server refuses the change.
  const projectArchived = useIsProjectArchived(sprint?.projectId);
  // Planning a requirement into a sprint changes the requirement and the
  // sprint's plan: the server asks for both.
  const canEditFR = mayEditFR && !projectArchived;
  const canPlanSprints = mayPlanSprints && !projectArchived;
  const canPlan = canEditFR && canPlanSprints;
  const canCreateFR = mayCreateFR && !projectArchived;
  const tasksQuery = useTasks(sprint?.projectId);
  const { data: allTasks, isLoading: tasksLoading } = tasksQuery;
  const allFRsQuery = useFunctionalRequirements(sprint?.projectId);
  const { data: allFRs } = allFRsQuery;
  const sprintFRsQuery = useFunctionalRequirementsBySprint(sprintId);
  const { data: sprintFRs } = sprintFRsQuery;
  // The lists this page is drawn from that failed with nothing cached to show.
  // Each used to fall through to an empty list, which read as a statement about
  // the sprint ("Nothing planned", "no functional requirements yet") with no
  // way to try again.
  const failedLists = [tasksQuery, allFRsQuery, sprintFRsQuery].filter(
    (q) => q.isError && q.data === undefined
  );
  // Two people plan a sprint at once more often than not: what the other one
  // adds or removes has to appear here, or each plans over the other.
  useSprintsRealtime(sprint?.projectId);
  useTasksRealtime(sprint?.projectId);
  useFunctionalRequirementsRealtime(sprint?.projectId);
  const { data: workspaceMembers = [] } = useWorkspaceMembers(sprint?.workspaceId);
  const updateFR = useUpdateFunctionalRequirement();

  const sprintTasks = React.useMemo(() => {
    if (!allTasks || !sprintId) return [];
    return allTasks.filter((task) => task.sprintId === sprintId);
  }, [allTasks, sprintId]);

  // ✅ NEW: Separate FRs into backlog and sprint
  const unplannedFRs = React.useMemo(() => {
    if (!allFRs) return [];
    return allFRs.filter((fr) => !fr.sprintId || fr.sprintId === '');
  }, [allFRs]);
  // Finished requirements are not offered for planning: see isFinished.
  const backlogFRs = React.useMemo(() => unplannedFRs.filter((fr) => !isFinished(fr)), [unplannedFRs]);
  const finishedCount = unplannedFRs.length - backlogFRs.length;

  const assignedSprintFRs = React.useMemo(() => {
    return sprintFRs || [];
  }, [sprintFRs]);

  // Tasks on the sprint's board that no requirement planned into it brought:
  // put on the sprint directly, or finished work a requirement left behind when
  // it was taken out. Planning lists requirements, so without this a sprint of
  // nine such tasks read "Nothing planned into this sprint yet" under a header
  // that said "9 tasks in sprint".
  const unplannedTaskCount = React.useMemo(() => {
    const planned = new Set(assignedSprintFRs.map((fr) => fr.id));
    return sprintTasks.filter(
      (task) => !task.functionalRequirementId || !planned.has(task.functionalRequirementId)
    ).length;
  }, [sprintTasks, assignedSprintFRs]);

  // Sprint task counts (replaces removed story points / capacity fields).
  //
  // A closed sprint has had its unfinished tasks rolled back to the backlog, so
  // counting what is still attached reads 100% however it went. The figures
  // recorded when it closed are the true ones (null on a sprint completed before
  // they were recorded) — the same rule as the sprint list and the board.
  const recorded =
    sprint?.status === 'COMPLETED' &&
    typeof sprint.totalTaskCount === 'number' &&
    typeof sprint.completedTaskCount === 'number'
      ? { total: sprint.totalTaskCount, completed: sprint.completedTaskCount }
      : null;
  const totalSprintTasks = recorded ? recorded.total : sprintTasks.length;
  const completedSprintTasks = recorded
    ? recorded.completed
    : sprintTasks.filter((t) => t.status === 'DONE').length;
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

      toast.success('Added to the sprint', { description: `${fr.hierarchyId} - ${fr.title}. Its open tasks came with it.` });
    } catch (error) {
      // The mutation has already said why (a conflict names the field); a
      // second, vaguer "Error" toast on top of it said nothing more.
      logger.error('Failed to assign FR to sprint', { error });
    }
  };

  const handleRemoveFRFromSprint = async (frId: string) => {
    const fr = allFRs?.find((f) => f.id === frId);
    if (!fr) return;
    // Its finished tasks stay: they were delivered in this sprint, and taking
    // them out would rewrite its velocity (RequirementTasks.followSprint).
    const confirmed = await confirm({
      title: `Take ${fr.hierarchyId} out of the sprint?`,
      description: `${fr.title} leaves ${sprint?.name ?? 'the sprint'}, and its unfinished tasks leave with it — off the sprint's board. Finished ones stay, as work done in this sprint. It can be planned in again.`,
      confirmText: 'Take out',
    });
    if (!confirmed) return;

    try {
      await updateFR.mutateAsync({
        requirementId: frId,
        projectId: fr.projectId,
        updates: { sprintId: '' },
      });

      toast.success('Taken out of the sprint', { description: `${fr.hierarchyId} - ${fr.title}. Its unfinished tasks left with it.` });
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

  // isError BEFORE the not-found branch: a 500 or an offline blip leaves
  // `sprint` undefined exactly like a deleted sprint does. SprintUnavailable
  // tells the two apart — a retry for the blip, a way back for the 404.
  if (sprintError || !sprint) {
    return (
      <SprintUnavailable
        error={sprintError ? sprintLoadError : null}
        onRetry={() => void refetchSprint()}
      />
    );
  }

  const header = (
    <SprintHeader sprint={sprint} current="planning" description="Choose the functional requirements this sprint takes on, and who works on them" />
  );

  if (failedLists.length > 0) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title="Couldn't load this sprint's plan"
          description="Its tasks or requirements didn't arrive. This is a connection or server problem — try again."
          onRetry={() => failedLists.forEach((q) => void q.refetch())}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header — shared by the sprint's three views. */}
      {header}

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
          <CardDescription>
            {recorded
              ? `As it closed. ${plural(recorded.total - recorded.completed, 'unfinished task')} left the sprint to be planned again.`
              : `${plural(sprintTasks.length, 'task')} in sprint`}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* ✅ FRs Section - Only Sprint FRs and FR Backlog */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Sprint FRs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              In This Sprint ({assignedSprintFRs.length})
            </CardTitle>
            <CardDescription>Functional requirements this sprint has taken on</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 min-h-100">
              {assignedSprintFRs.length > 0 ? (
                <>
                  {assignedSprintFRs.map((fr) => (
                    <FRAssignmentCard
                      key={fr.id}
                      fr={fr}
                      teamMembers={workspaceMembers}
                      projectId={sprint.projectId}
                      canEdit={canEditFR}
                      // Not on a completed sprint: what it took on is part of
                      // its record. The API refuses it too.
                      action={
                        canPlan && sprint.status !== 'COMPLETED' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveFRFromSprint(fr.id)}
                          >
                            <MinusCircle className="h-4 w-4 mr-2" />
                            Remove from Sprint
                          </Button>
                        ) : undefined
                      }
                    />
                  ))}
                  {unplannedTaskCount > 0 && (
                    <p className="text-sm text-muted-foreground">
                      Also on the board: {plural(unplannedTaskCount, 'task')} not under a
                      requirement planned here.{' '}
                      <Link
                        href={`/sprints/${sprint.id}/board`}
                        className="font-medium text-foreground underline underline-offset-4"
                      >
                        Open the board
                      </Link>
                    </p>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-100 text-center p-4 bg-muted/30 rounded-lg border-2 border-dashed">
                  <FileText className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">
                    {sprint.status === 'COMPLETED'
                      ? unplannedTaskCount > 0
                        ? 'This sprint closed with no requirement planned into it'
                        : 'This sprint closed with nothing planned into it'
                      : unplannedTaskCount > 0
                        ? 'No requirement is planned into this sprint'
                        : 'Nothing planned into this sprint yet'}
                  </p>
                  {unplannedTaskCount > 0 && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {plural(unplannedTaskCount, 'task')}{' '}
                      {unplannedTaskCount === 1 ? 'is' : 'are'} on its board all the same — put on
                      the sprint directly rather than through a requirement.
                    </p>
                  )}
                  {sprint.status !== 'COMPLETED' && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {canPlan
                        ? 'Use “Add to Sprint” on a requirement in the other list.'
                        : 'Whoever plans the sprints adds requirements to it.'}
                    </p>
                  )}
                  {unplannedTaskCount > 0 && (
                    <Button asChild variant="outline" size="sm" className="mt-3">
                      <Link href={`/sprints/${sprint.id}/board`}>Open the board</Link>
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Backlog FRs */}
        <Card>
          <CardHeader>
            <CardTitle>Not in a Sprint ({backlogFRs.length})</CardTitle>
            <CardDescription>Functional requirements that have not been planned yet</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 min-h-100">
              {backlogFRs.length > 0 ? (
                backlogFRs.map((fr) => (
                  <FRAssignmentCard
                    key={fr.id}
                    fr={fr}
                    teamMembers={workspaceMembers}
                    projectId={sprint.projectId}
                    canEdit={canEditFR}
                    action={
                      canPlan && sprint.status !== 'COMPLETED' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAssignFRToSprint(fr.id)}
                        >
                          <PlusCircle className="h-4 w-4 mr-2" />
                          Add to Sprint
                        </Button>
                      ) : undefined
                    }
                  />
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-100 text-center p-4 bg-muted/30 rounded-lg">
                  <FileText className="h-12 w-12 text-muted-foreground mb-3" />
                  {(allFRs?.length ?? 0) > 0 ? (
                    <p className="text-muted-foreground">
                      {finishedCount > 0
                        ? 'Nothing left to plan'
                        : 'Every functional requirement is planned into a sprint'}
                    </p>
                  ) : (
                    <>
                      <p className="text-muted-foreground">
                        This project has no functional requirements yet
                      </p>
                      <p className="text-sm text-muted-foreground mt-2">
                        Sprints are planned from them: each is a piece of an epic.
                      </p>
                      {canCreateFR && (
                        <Button asChild variant="outline" size="sm" className="mt-3">
                          <Link href={`/functional-requirements?projectId=${sprint.projectId}&action=create`}>
                            Add a functional requirement
                          </Link>
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
              {finishedCount > 0 && (
                <p className="text-sm text-muted-foreground">
                  {plural(finishedCount, 'finished requirement')} not listed —{' '}
                  {finishedCount === 1 ? 'its' : 'their'} work is done, so there is nothing in{' '}
                  {finishedCount === 1 ? 'it' : 'them'} to plan.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
