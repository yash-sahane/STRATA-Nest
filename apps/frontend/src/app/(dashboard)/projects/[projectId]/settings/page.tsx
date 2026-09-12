'use client';

import { PageLoader } from '@/components/ui/page-loader';
import { ErrorState } from '@/components/ui/error-state';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useProject, useUpdateProject, useDeleteProject, useChangeProjectMethodology } from '@/hooks/use-project';
import { useHasPermissionIn } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { Shield } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { DatePicker } from '@/components/ui/date-picker';
import { MethodologySelector } from '@/components/projects/methodology-selector';
import { format, startOfDay } from 'date-fns';
import { ArrowLeft, Save, Trash2, Edit2 } from 'lucide-react';
import { parseDateOnly } from '@/components/projects/project-dates';
import type { ProjectStatus, ProjectMethodology } from '@/types';

export default function ProjectSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  // By id, not by scanning the current workspace's list — see the detail page.
  const {
    data: project,
    isLoading,
    isError: projectError,
    refetch: refetchProject,
  } = useProject(params.projectId as string);
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const changeMethodology = useChangeProjectMethodology();
  // The navigation entry point on /projects is gated; the ROUTE was not, so a
  // shared link or typed URL handed anyone the Danger Zone. The server rejects
  // the write, but the UI must not offer it.
  //
  // Resolved against the PROJECT's workspace, not the currently selected one:
  // this page deliberately loads a project by id, so it routinely renders a
  // project from a workspace the user has not switched to — and a MEMBER in the
  // active workspace who is MANAGER in the project's own was being denied (and
  // the mirror case handed the Danger Zone to someone who cannot write).
  // `isLoading` matters just as much: the role is null until the member roster
  // resolves, which is a different request from the project's, so a legitimate
  // manager saw a full-page "Access Denied" before it flipped to the form.
  const {
    allowed: canManageSettings,
    isLoading: permissionLoading,
    // A FAILED membership request is not a denial. Without this the page reads
    // `allowed === false` after a 5xx or an offline blip and pins an
    // affirmatively wrong, unrecoverable "Access Denied" — `refetchOnWindowFocus`
    // is off, so it survives until a manual reload.
    isError: permissionError,
  } = useHasPermissionIn(project?.workspaceId, Permission.MANAGE_PROJECT_SETTINGS);
  const { allowed: canDeleteProject } = useHasPermissionIn(
    project?.workspaceId,
    Permission.DELETE_PROJECT,
  );

  const [name, setName] = React.useState('');
  const [clientName, setClientName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [methodology, setMethodology] = React.useState<ProjectMethodology>('SCRUM');
  const [status, setStatus] = React.useState<ProjectStatus>('PLANNING');
  const [startDate, setStartDate] = React.useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = React.useState<Date | undefined>(undefined);
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [showMethodologyDialog, setShowMethodologyDialog] = React.useState(false);

  // Initialize form with project data
  React.useEffect(() => {
    if (project) {
      setName(project.name);
      setClientName(project.clientName || '');
      setDescription(project.description || '');
      setMethodology(project.methodology);
      setStatus(project.status);
      setStartDate(parseDateOnly(project.startDate));
      setEndDate(parseDateOnly(project.endDate));
    }
  }, [project]);

  const handleSave = async () => {
    if (!project) return;
    if (!name.trim()) {
      toast.error('Project name cannot be empty');
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      // Rows written before the API grew its own ordering check can arrive here
      // already inverted, in which case the user has not touched either field
      // and needs telling which way out exists — the End Date calendar disables
      // every day before the start, so the day currently selected cannot be
      // clicked off; the field's clear control is the way.
      toast.error(
        'End date must be on or after the start date. Move the start date back, or clear the end date.'
      );
      return;
    }

    try {
      await updateProject.mutateAsync({
        projectId: project.id,
        workspaceId: project.workspaceId,
        name: name.trim(),
        description,
        clientName,
        status,
        // `null`, not `undefined`: JSON.stringify drops an undefined property,
        // so clearing a date used to send no field at all — the save reported
        // success and the old date stayed on the row, with no other UI able to
        // remove it. The API treats null as "clear this column".
        startDate: startDate ? format(startDate, 'yyyy-MM-dd') : null,
        endDate: endDate ? format(endDate, 'yyyy-MM-dd') : null,
      });
    } catch {
      // error toast handled inside the mutation
    }
  };

  const handleMethodologyChange = async (newMethodology: ProjectMethodology) => {
    if (!project) return;

    try {
      await changeMethodology.mutateAsync({
        projectId: project.id,
        workspaceId: project.workspaceId,
        methodology: newMethodology,
      });
    } catch {
      return; // error toast handled inside the mutation
    }

    setMethodology(newMethodology);
  };

  const handleDelete = async () => {
    if (!project) return;

    try {
      await deleteProject.mutateAsync({
        projectId: project.id,
        workspaceId: project.workspaceId,
      });
    } catch {
      return; // error toast handled inside the mutation; keep the dialog open
    }

    setShowDeleteDialog(false);
    router.push('/projects');
  };

  if (isLoading) {
    return <PageLoader message="Loading project settings..." />;
  }

  // A failed fetch is not a missing project. Telling the owner of a live
  // project that it "doesn't exist or you don't have access to it" over one
  // 500 reads as a permissions change, and offered nothing to retry.
  if (projectError) {
    return (
      <div className="space-y-6">
        <div>
          <Button variant="ghost" onClick={() => router.push('/projects')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Projects
          </Button>
        </div>
        <ErrorState
          title="Couldn't load this project"
          description="The project is still there — this is a connection problem, not a change to your access."
          onRetry={() => void refetchProject()}
        />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="space-y-6">
        <div>
          <Button variant="ghost" onClick={() => router.push('/projects')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Projects
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Project Not Found</CardTitle>
            <CardDescription>
              The project you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Wait for the capability answer before rendering a denial. `project` is
  // resolved by now, so `permissionLoading` is the roster request only.
  if (permissionLoading) {
    return <PageLoader message="Loading project settings..." />;
  }

  // "We could not find out" is a different answer from "no", and the only one
  // of the two that a retry can fix.
  if (permissionError) {
    return (
      <ErrorState
        title="Couldn't check your access"
        description="We couldn't load your membership for this project's workspace, so we can't tell whether you may edit it."
        onRetry={() => queryClient.invalidateQueries({ queryKey: ['my-memberships'] })}
      />
    );
  }

  if (!canManageSettings) {
    return (
      <div className="space-y-6">
        <div>
          <Button variant="ghost" onClick={() => router.push(`/projects/${project.id}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Project
          </Button>
        </div>
        <Card className="border-destructive/50">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive-text">
              <Shield className="h-6 w-6" />
              <CardTitle>Access Denied</CardTitle>
            </div>
            <CardDescription>
              You don&apos;t have permission to manage this project&apos;s settings.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" onClick={() => router.push(`/projects/${project.id}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Project
          </Button>
          <h1 className="text-3xl font-bold tracking-tight mt-2">Project Settings</h1>
          <p className="text-muted-foreground">
            Manage {project.name} configuration
          </p>
        </div>
      </div>

      <div className="grid gap-6">
        {/* General Settings */}
        <Card>
          <CardHeader>
            <CardTitle>General Information</CardTitle>
            <CardDescription>Update your project details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Project Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Mobile App Development"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="clientName">Client Name</Label>
              <Input
                id="clientName"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Client or stakeholder name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your project..."
                className="min-h-[100px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="methodology">Methodology</Label>
                <div className="flex gap-2">
                  <Select value={methodology} disabled>
                    <SelectTrigger id="methodology" className="flex-1">
                      <SelectValue placeholder="Select methodology" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SCRUM">Scrum</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowMethodologyDialog(true)}
                    title="Change methodology"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Click the edit icon to change methodology
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as ProjectStatus)}>
                  <SelectTrigger id="status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PLANNING">Planning</SelectItem>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="ON_HOLD">On Hold</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                    <SelectItem value="ARCHIVED">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* The shared DatePicker, not a second hand-rolled copy of it: the
                  inline calendars here were the only ones without `defaultMonth`,
                  so they opened on today instead of the month already in the
                  field. Same trigger, same 'PPP' label, one implementation. */}
              <div className="space-y-2">
                <Label>Start Date</Label>
                <DatePicker
                  date={startDate}
                  onSelect={setStartDate}
                  buttonClassName="w-full"
                />
              </div>

              <div className="space-y-2">
                <Label>End Date</Label>
                <DatePicker
                  date={endDate}
                  onSelect={setEndDate}
                  disabled={(date) => (startDate ? date < startOfDay(startDate) : false)}
                  buttonClassName="w-full"
                />
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={handleSave} disabled={updateProject.isPending}>
                <Save className="mr-2 h-4 w-4" />
                {updateProject.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        {canDeleteProject && (
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="text-destructive-text">Danger Zone</CardTitle>
              <CardDescription>Irreversible actions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <h3 className="font-medium">Delete this project</h3>
                  <p className="text-sm text-muted-foreground">
                    Once deleted, it will be gone forever. Please be certain.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Project
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the project <strong>{project.name}</strong> and all
              associated tasks, sprints, and requirements. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProject.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              // preventDefault so the dialog stays open while the delete is in
              // flight (Radix closes it on click otherwise).
              onClick={(event) => {
                event.preventDefault();
                handleDelete();
              }}
              disabled={deleteProject.isPending}
            >
              {deleteProject.isPending ? 'Deleting...' : 'Delete Project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Methodology Selector Dialog */}
      <MethodologySelector
        open={showMethodologyDialog}
        onOpenChange={setShowMethodologyDialog}
        currentMethodology={methodology}
        onSelect={handleMethodologyChange}
        isChanging={changeMethodology.isPending}
      />
    </div>
  );
}
