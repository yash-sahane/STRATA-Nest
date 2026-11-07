'use client';

import Link from 'next/link';
import { PageLoader } from '@/components/ui/page-loader';
import { ErrorState } from '@/components/ui/error-state';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useProject, useUpdateProject, useDeleteProject } from '@/hooks/use-project';
import { useHasPermissionIn } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { toast } from 'sonner';
import { basedOnFor, changedFields } from '@/lib/utils/changed-fields';
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
import { format, startOfDay } from 'date-fns';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { parseDateOnly } from '@/components/projects/project-dates';
import type { ProjectStatus } from '@/types';
import { NoAccess } from '@/components/ui/no-access';
import { ProjectLoadFailure, ProjectNotFound } from '@/components/projects/project-load-failure';

export default function ProjectSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  // By id, not by scanning the current workspace's list — see the detail page.
  const {
    data: project,
    isLoading,
    isError: projectError,
    error: projectLoadError,
    refetch: refetchProject,
  } = useProject(params.projectId as string);
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
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
  const [status, setStatus] = React.useState<ProjectStatus>('PLANNING');
  const [startDate, setStartDate] = React.useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = React.useState<Date | undefined>(undefined);
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);

  /**
   * The project as the form was seeded from it: what this person is editing
   * from, and what a save is checked against.
   *
   * The form used to re-seed on EVERY refetch of the project — any colleague's
   * save, or simply returning to the tab, threw away whatever was being typed.
   * And a save sent every field with no baseline, so it wrote this page's copy
   * of the fields nobody here had touched back over what they had since become.
   */
  const [seeded, setSeeded] = React.useState<typeof project | null>(null);

  /** The fields as the form holds them, in the shape a save sends. */
  const formValues = {
    name: name.trim(),
    description,
    clientName,
    status,
    // `null`, not `undefined`: JSON.stringify drops an undefined property, so
    // clearing a date used to send no field at all — the save reported success
    // and the old date stayed on the row. The API treats null as "clear this".
    startDate: startDate ? format(startDate, 'yyyy-MM-dd') : null,
    endDate: endDate ? format(endDate, 'yyyy-MM-dd') : null,
  };
  /** The same shape, for a project as the API returned it. */
  const valuesOf = (source: NonNullable<typeof project>): typeof formValues => {
    const start = parseDateOnly(source.startDate);
    const end = parseDateOnly(source.endDate);
    return {
      name: source.name,
      description: source.description || '',
      clientName: source.clientName || '',
      status: source.status,
      startDate: start ? format(start, 'yyyy-MM-dd') : null,
      endDate: end ? format(end, 'yyyy-MM-dd') : null,
    };
  };
  const pending = seeded ? changedFields(valuesOf(seeded), formValues) : {};
  const dirty = Object.keys(pending).length > 0;
  // An archived project takes one change: its status (the server refuses the
  // rest — see the API's project-archive). The other fields open up once a
  // status that un-archives it is chosen, and are saved together with it.
  const lockedByArchive = seeded?.status === 'ARCHIVED' && status === 'ARCHIVED';

  // Seed when the project first arrives, or a different one does. A refetch of
  // the same project re-seeds only while nothing has been changed here, so
  // somebody else's save shows up without costing an edit in progress.
  React.useEffect(() => {
    if (!project) return;
    if (seeded && seeded.id === project.id && dirty) return;
    setSeeded(project);
    setName(project.name);
    setClientName(project.clientName || '');
    setDescription(project.description || '');
    setStatus(project.status);
    setStartDate(parseDateOnly(project.startDate));
    setEndDate(parseDateOnly(project.endDate));
    // `seeded` and `dirty` are read, not followed: this runs when the PROJECT
    // changes, and following them would re-seed on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    if (!seeded || !dirty) {
      toast.info('Nothing has been changed.');
      return;
    }

    try {
      const saved = await updateProject.mutateAsync({
        projectId: project.id,
        workspaceId: project.workspaceId,
        // Only what was changed here, and what those fields held when the form
        // was seeded — so the API can refuse a save that would undo somebody
        // else's change to the same field, and leave alone one that would not.
        ...pending,
        basedOn: basedOnFor(seeded as unknown as Record<string, unknown>, pending),
      });
      // What was just saved is what the next edit starts from.
      setSeeded({ ...seeded, ...saved });
    } catch {
      // error toast handled inside the mutation; a conflict names the field,
      // and the form keeps what was typed
    }
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

  // A failed fetch is not a missing project, and a missing project is not a
  // connection problem: a 500 must not read as a permissions change, and a 404
  // must not offer a retry that can only fail again. See ProjectLoadFailure.
  if (projectError) {
    return <ProjectLoadFailure error={projectLoadError} onRetry={() => void refetchProject()} />;
  }

  if (!project) return <ProjectNotFound />;

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
        onRetry={() => queryClient.invalidateQueries({ queryKey: ['my-access'] })}
      />
    );
  }

  if (!canManageSettings) {
    return (
      <div className="space-y-6">
        <div>
          <Button variant="ghost" asChild>
            <Link href={`/projects/${project.id}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Project
            </Link>
          </Button>
        </div>
        <NoAccess what="change this project's settings" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" asChild>
            <Link href={`/projects/${project.id}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Project
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl mt-2">Project Settings</h1>
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
            {/* A disabled fieldset disables every control in it, the date
                pickers' triggers and clear buttons included. */}
            <fieldset disabled={lockedByArchive} className="min-w-0 space-y-4 disabled:opacity-60">
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
            </fieldset>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as ProjectStatus)}>
                  <SelectTrigger id="status" aria-describedby={seeded?.status === 'ARCHIVED' ? 'archived-note' : undefined}>
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
              {seeded?.status === 'ARCHIVED' && (
                <p id="archived-note" className="text-sm text-muted-foreground sm:self-end">
                  {lockedByArchive
                    ? 'Archived — read-only: nothing in this project can be changed. Choose another status to unarchive it; the rest of the form opens up with it.'
                    : 'Saving un-archives the project, with any other changes made here.'}
                </p>
              )}
            </div>

            <fieldset disabled={lockedByArchive} className="min-w-0 disabled:opacity-60">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* The shared DatePicker, not a second hand-rolled copy of it: the
                  inline calendars here were the only ones without `defaultMonth`,
                  so they opened on today instead of the month already in the
                  field. Same trigger, same 'PPP' label, one implementation. */}
              <div className="space-y-2">
                <Label htmlFor="project-start-date">Start Date</Label>
                <DatePicker
                  id="project-start-date"
                  date={startDate}
                  onSelect={setStartDate}
                  buttonClassName="w-full"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="project-end-date">End Date</Label>
                <DatePicker
                  id="project-end-date"
                  date={endDate}
                  onSelect={setEndDate}
                  disabled={(date) => (startDate ? date < startOfDay(startDate) : false)}
                  buttonClassName="w-full"
                />
              </div>
            </div>
            </fieldset>

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

    </div>
  );
}
