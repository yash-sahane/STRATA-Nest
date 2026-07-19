'use client';

import { getFunctionalRequirementStatusConfig } from '@/lib/semantic/status';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Trash2, Link as LinkIcon, Calendar, Copy, Save } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  useUpdateFunctionalRequirement,
  useDeleteFunctionalRequirement,
  useCloneFunctionalRequirement,
} from '@/hooks/use-functional-requirement';
import { useTeamMembers } from '@/hooks/use-team';
import { useSprints } from '@/hooks/use-sprint';
import { useProjects } from '@/hooks/use-project';
import { useTasksByFunctionalRequirement, useUpdateTask } from '@/hooks/use-task';
import { TeamMemberSelector } from '@/components/tasks/team-member-selector';
import { createBulkNotifications } from '@/hooks/use-notification';
import { useAuth } from '@/components/providers/auth-provider';
import type { FunctionalRequirement, ClientRequirement } from '@/types';
import { logger } from '@/lib/logger';

const complexityConfig: Record<
  FunctionalRequirement['complexity'],
  { label: string; color: string }
> = {
  LOW: { label: 'Low', color: 'green' },
  MEDIUM: { label: 'Medium', color: 'yellow' },
  HIGH: { label: 'High', color: 'orange' },
  VERY_HIGH: { label: 'Very High', color: 'red' },
};

interface FunctionalRequirementDetailDialogProps {
  requirement: FunctionalRequirement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workspaceId: string;
  clientRequirements: ClientRequirement[];
  canEdit?: boolean; // Permission to edit requirements
  canDelete?: boolean; // Permission to delete requirements
}

export function FunctionalRequirementDetailDialog({
  requirement,
  open,
  onOpenChange,
  projectId,
  workspaceId,
  clientRequirements,
  canEdit = false,
  canDelete = false,
}: FunctionalRequirementDetailDialogProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = React.useState(false);
  const [selectedProject, setSelectedProject] = React.useState<string>('');

  // Local state for editable fields
  const [localSprintId, setLocalSprintId] = React.useState<string>(requirement.sprintId || '');
  const [localAssignedTo, setLocalAssignedTo] = React.useState<string[]>(
    requirement.assignedTo || []
  );
  const [hasChanges, setHasChanges] = React.useState(false);

  const updateRequirement = useUpdateFunctionalRequirement();
  const deleteRequirement = useDeleteFunctionalRequirement();
  const cloneRequirement = useCloneFunctionalRequirement();
  const updateTask = useUpdateTask();
  const { toast } = useToast();
  const { user } = useAuth();

  // Load workspace members, sprints, and linked tasks
  const { data: members = [] } = useTeamMembers(workspaceId);
  const { data: sprints = [] } = useSprints(projectId);
  const { data: projects = [] } = useProjects(workspaceId);
  const { data: linkedTasks = [] } = useTasksByFunctionalRequirement(requirement.id);

  // Reset local state when requirement changes
  React.useEffect(() => {
    setLocalSprintId(requirement.sprintId || '');
    setLocalAssignedTo(requirement.assignedTo || []);
    setHasChanges(false);
  }, [requirement.id, requirement.sprintId, requirement.assignedTo]);

  // Track changes
  React.useEffect(() => {
    const sprintChanged = localSprintId !== (requirement.sprintId || '');
    const assigneesChanged =
      JSON.stringify(localAssignedTo.sort()) !==
      JSON.stringify((requirement.assignedTo || []).sort());
    setHasChanges(sprintChanged || assigneesChanged);
  }, [localSprintId, localAssignedTo, requirement.sprintId, requirement.assignedTo]);

  const handleSprintChange = (sprintId: string) => {
    setLocalSprintId(sprintId === 'none' ? '' : sprintId);
  };

  const handleTeamMemberChange = (userIds: string[]) => {
    setLocalAssignedTo(userIds);
  };

  const handleSave = async () => {
    // Build assignedToNames from selected user IDs
    const assignedToNames = localAssignedTo.map((userId) => {
      const member = members.find((m) => m.userId === userId);
      return member?.name || member?.email || 'Unknown';
    });

    // Check if assignees changed
    const previousAssignees = requirement.assignedTo || [];
    const assigneesChanged =
      JSON.stringify(localAssignedTo.sort()) !== JSON.stringify(previousAssignees.sort());
    const newAssignees = localAssignedTo.filter((id) => !previousAssignees.includes(id));

    // Get project name for notifications
    const currentProject = projects.find((p) => p.id === projectId);
    const projectName = currentProject?.name || 'Project';

    await updateRequirement.mutateAsync({
      requirementId: requirement.id,
      projectId,
      updates: {
        sprintId: localSprintId || undefined,
        assignedTo: localAssignedTo,
        assignedToNames,
      },
      previousSprintId: requirement.sprintId || undefined,
    });

    // ✅ AUTO-ASSIGN: Update linked tasks with the same assignees
    if (assigneesChanged && linkedTasks.length > 0) {
      try {
        // Update all linked tasks with the new assignees
        await Promise.all(
          linkedTasks.map((task) =>
            updateTask.mutateAsync({
              taskId: task.id,
              projectId,
              updates: {
                assignedTo: localAssignedTo,
                assignedToNames,
                assigneeIds: localAssignedTo,
                assignedBy: user?.id,
                assignedByName: user?.name || user?.email || 'Team Member',
              },
            })
          )
        );

        toast({
          title: 'Tasks Updated',
          description: `${linkedTasks.length} linked task(s) were also assigned to the same team members.`,
        });

        // Send notifications to newly assigned members for each task
        if (newAssignees.length > 0) {
          for (const task of linkedTasks) {
            try {
              await createBulkNotifications({
                workspaceId,
                userIds: newAssignees,
                type: 'TASK_ASSIGNED',
                data: {
                  taskId: task.id,
                  taskTitle: task.title,
                  taskHierarchyId: task.hierarchyId,
                  projectId,
                  projectName,
                  assignerName: user?.name || user?.email || 'Team Member',
                  priority: task.priority,
                  dueDate: task.dueDate,
                  entityType: 'TASK',
                },
              });
            } catch (error) {
              logger.error('Failed to send task assignment notification', { error });
            }
          }
        }
      } catch (error) {
        logger.error('Failed to update linked tasks', { error });
        toast({
          title: 'Warning',
          description: 'FR updated but failed to update some linked tasks.',
          variant: 'destructive',
        });
      }
    }

    // ✅ Send FR assignment notifications to new assignees
    if (newAssignees.length > 0) {
      try {
        await createBulkNotifications({
          workspaceId,
          userIds: newAssignees,
          type: 'FR_ASSIGNED',
          data: {
            frId: requirement.id,
            frTitle: requirement.title,
            frHierarchyId: requirement.hierarchyId,
            projectId,
            projectName,
            assignerName: user?.name || user?.email || 'Team Member',
            entityType: 'FR',
          },
        });
      } catch (error) {
        logger.error('Failed to send FR assignment notifications', { error });
      }
    }

    toast({
      title: 'Saved',
      description: 'Functional requirement updated successfully.',
    });

    setHasChanges(false);
  };

  const handleDelete = async () => {
    await deleteRequirement.mutateAsync({
      requirementId: requirement.id,
      projectId,
    });
    setDeleteDialogOpen(false);
    onOpenChange(false);
  };

  const handleClone = async () => {
    if (!selectedProject) {
      toast({
        title: 'Error',
        description: 'Please select a target project',
        variant: 'destructive',
      });
      return;
    }

    const targetProj = projects.find((p) => p.id === selectedProject);
    if (!targetProj) return;

    await cloneRequirement.mutateAsync({
      requirementId: requirement.id,
      targetProjectId: selectedProject,
      targetProjectCode: targetProj.shortCode,
      targetEpicId: undefined, // User can move to epic later
      targetClientRequirementId: undefined,
    });

    setCloneDialogOpen(false);
    setSelectedProject('');
  };

  const complexity = complexityConfig[requirement.complexity];
  const linkedClientReq = clientRequirements.find(
    (cr) => cr.id === requirement.clientRequirementId
  );

  // Get assigned sprint name (for display)
  const selectedSprint = sprints.find((s) => s.id === localSprintId);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    {requirement.hierarchyId}
                  </Badge>
                  {requirement.reusable && <Badge variant="secondary">Reusable</Badge>}
                </div>
                <DialogTitle className="text-2xl">{requirement.title}</DialogTitle>
                {requirement.description && (
                  <DialogDescription className="text-base">
                    {requirement.description}
                  </DialogDescription>
                )}
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-6">
            {/* Status - Auto-calculated from tasks, read-only */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30 rounded-md">
                <div
                  className={`w-2 h-2 rounded-full ${getFunctionalRequirementStatusConfig(requirement.status).dot}`}
                />
                <span className="text-sm">
                  {getFunctionalRequirementStatusConfig(requirement.status).label}
                </span>
                <span className="text-xs text-muted-foreground ml-auto">
                  (Auto-calculated from tasks)
                </span>
              </div>
            </div>

            {/* Progress */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Progress</label>
              <div className="flex items-center gap-3">
                <Progress value={requirement.progress ?? 0} className="flex-1 h-2" />
                <span className="text-sm font-medium w-12 text-right">
                  {requirement.progress ?? 0}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Based on linked tasks completion (
                {linkedTasks.filter((t) => t.status === 'DONE').length}/{linkedTasks.length} done)
              </p>
            </div>

            <Separator />

            {/* Metadata Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Priority</label>
                <div className="mt-1">
                  <Badge variant="outline">{requirement.priority}</Badge>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Complexity</label>
                <div className="mt-1">
                  <Badge variant="outline" className={`bg-${complexity.color}-500/10`}>
                    {complexity.label}
                  </Badge>
                </div>
              </div>
            </div>

            <Separator />

            {/* Sprint Assignment */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Assign to Sprint
              </label>
              <Select value={localSprintId || 'none'} onValueChange={handleSprintChange}>
                <SelectTrigger>
                  <SelectValue placeholder="No sprint assigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No sprint</SelectItem>
                  {sprints.map((sprint) => (
                    <SelectItem
                      key={sprint.id}
                      value={sprint.id}
                      disabled={sprint.status === 'COMPLETED'}
                    >
                      {sprint.name} ({sprint.status}){sprint.status === 'COMPLETED' && ' - Closed'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedSprint && (
                <p className="text-sm text-muted-foreground">Selected: {selectedSprint.name}</p>
              )}
            </div>

            <Separator />

            {/* Team Assignment */}
            <div className="space-y-3">
              <label className="text-sm font-medium">Assigned Team Members</label>
              <TeamMemberSelector
                workspaceId={workspaceId}
                value={localAssignedTo}
                onChange={handleTeamMemberChange}
                placeholder="Select team members..."
                multiSelect={true}
              />
            </div>

            <Separator />

            {/* Linked Client Requirement */}
            {linkedClientReq && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <LinkIcon className="h-4 w-4" />
                    Linked Client Requirement
                  </label>
                  <div className="p-3 border rounded-lg">
                    <div className="font-medium">{linkedClientReq.title}</div>
                    {linkedClientReq.description && (
                      <div className="text-sm text-muted-foreground mt-1">
                        {linkedClientReq.description}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline">{linkedClientReq.priority}</Badge>
                      <Badge
                        className={`bg-${linkedClientReq.status === 'APPROVED' ? 'green' : 'gray'}-500`}
                      >
                        {linkedClientReq.status}
                      </Badge>
                    </div>
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
              <div>
                <div>Created</div>
                <div className="font-medium text-foreground">
                  {formatDate(requirement.createdAt)}
                </div>
              </div>
              <div>
                <div>Last Updated</div>
                <div className="font-medium text-foreground">
                  {formatDate(requirement.updatedAt)}
                </div>
              </div>
            </div>
          </div>

          {/* Footer with Save and Actions */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-0">
            <div className="flex gap-2 w-full sm:w-auto">
              {canEdit && (
                <Button
                  variant="outline"
                  onClick={() => setCloneDialogOpen(true)}
                  className="flex-1 sm:flex-none"
                  title="Clone to another project"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Clone
                </Button>
              )}
              {canDelete && (
                <Button
                  variant="outline"
                  onClick={() => setDeleteDialogOpen(true)}
                  className="flex-1 sm:flex-none text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 sm:flex-none"
              >
                {hasChanges ? 'Cancel' : 'Close'}
              </Button>
              {canEdit && (
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges || updateRequirement.isPending}
                  className="flex-1 sm:flex-none"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {updateRequirement.isPending ? 'Saving...' : 'Save'}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Functional Requirement?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &lquo;{requirement.title}&rquo;. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-row sm:justify-between sm:space-x-0">
            <AlertDialogCancel className="mt-2 sm:mt-0">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clone to Project Dialog */}
      <AlertDialog open={cloneDialogOpen} onOpenChange={setCloneDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clone Functional Requirement</AlertDialogTitle>
            <AlertDialogDescription>
              Clone &lquo;{requirement.hierarchyId}&rquo; to another project. The FR will be
              duplicated with a new hierarchy id.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">Target Project</label>
            <Select value={selectedProject} onValueChange={setSelectedProject}>
              <SelectTrigger>
                <SelectValue placeholder="Select project..." />
              </SelectTrigger>
              <SelectContent>
                {projects
                  .filter((p) => p.id !== projectId) // Exclude current project
                  .map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.shortCode} - {project.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedProject('')}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClone}
              disabled={!selectedProject}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Clone FR
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
