'use client';

import {
  getFunctionalRequirementStatusConfig,
  getRequirementStatusConfig,
} from '@/lib/semantic/status';
import { getPriorityConfig } from '@/lib/semantic/priority';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { AttachmentsSection } from '@/components/files/project-files-panel';
import { Skeleton } from '@/components/ui/skeleton';
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
import { Calendar, User, FileText, Trash2, CheckCircle2, Clock, Archive } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import {
  useClientRequirement,
  useUpdateClientRequirement,
  useDeleteClientRequirement,
} from '@/hooks/use-client-requirement';
import { ApiError } from '@/lib/api/rest-client';
import type { EditBasedOn, RequirementPriority, RequirementStatus } from '@/types';
import { basedOnFor, changedFields } from '@/lib/utils/changed-fields';
import Link from 'next/link';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { useEpics } from '@/hooks/use-epic';
import { useFunctionalRequirements } from '@/hooks/use-functional-requirement';

/** Server copy ends with developer instructions; the UI offers the button instead. */
const stripCascadeHint = (message: string) =>
  message.replace(/\s*Delete them first or retry with cascade=true\.?\s*$/i, '');

/** Icon per status; colour and label come from lib/semantic/status. */
const statusIcons: Record<RequirementStatus, React.ComponentType<{ className?: string }>> = {
  DRAFT: FileText,
  SUBMITTED: Clock,
  APPROVED: CheckCircle2,
  IN_PROGRESS: Clock,
  COMPLETED: CheckCircle2,
  ARCHIVED: Archive,
};

// Cancelling the delete confirm used to close this dialog with it (Escape did
// not), throwing away unsaved title/status edits. The guard for that now lives
// in DialogContent itself — `guardNestedOverlays` in components/ui/dialog.tsx —
// so every dialog gets it and no per-dialog copy can drift out of step.
interface ClientRequirementDetailDialogProps {
  requirementId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  canEdit?: boolean;
  canDelete?: boolean;
}

export function ClientRequirementDetailDialog({
  requirementId,
  open,
  onOpenChange,
  projectId,
  canEdit = false,
  canDelete = false,
}: ClientRequirementDetailDialogProps) {
  const {
    data: requirement,
    isError,
    isFetching,
    refetch,
  } = useClientRequirement(requirementId || undefined);
  const updateRequirement = useUpdateClientRequirement();
  const deleteRequirement = useDeleteClientRequirement();
  /**
   * What this requirement led to: the epics raised from it, and the functional
   * requirements under them. The whole chain hangs from here — client
   * requirement, epic, functional requirement, task — and this dialog showed
   * none of it: a requirement read the same whether nothing had been done about
   * it or the whole of it had been delivered.
   */
  const { data: projectEpics = [] } = useEpics(open ? projectId : undefined);
  const { data: projectRequirements = [] } = useFunctionalRequirements(
    open ? projectId : undefined
  );
  const ledToEpics = projectEpics.filter((epic) => epic.requirementId === requirementId);
  const canRaiseEpic = useHasPermission(Permission.CREATE_EPIC);
  const ledToRequirements = projectRequirements.filter(
    (fr) => fr.clientRequirementId === requirementId
  );
  const delivered = ledToRequirements.filter((fr) => fr.status === 'DEPLOYED').length;
  // With functional requirements under it, In Progress and Completed are what
  // they say (the server's roll-up), not something to pick.
  const followsWork = ledToRequirements.length > 0;
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  /** Server's 409 message when linked functional requirements block the delete. */
  const [deleteBlockedBy, setDeleteBlockedBy] = React.useState<string | null>(null);

  // Local state for editing
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [status, setStatus] = React.useState<RequirementStatus>('DRAFT');
  const [priority, setPriority] = React.useState<RequirementPriority>('LOW');
  const [hasChanges, setHasChanges] = React.useState(false);
  /** The requirement whose values are currently seeded into the fields above,
   *  cleared on close so the next open always re-seeds. */
  const lastLoadedId = React.useRef<string | null>(null);
  /**
   * What the fields above were seeded with — the values this person is looking
   * at and editing from.
   *
   * The save used to diff against, and take its `basedOn` from, the LIVE
   * record. That record is refetched in the background whenever anybody saves,
   * while the fields stop following it at the first keystroke. So by the time a
   * colleague's edit to the same field had arrived, the "baseline" already
   * contained it: the API was told this save was based on their value, found
   * nothing to object to, and replaced it without a word — the one case the
   * check exists for.
   */
  const [seeded, setSeeded] = React.useState<{
    title: string;
    description: string;
    status: RequirementStatus;
    priority: RequirementPriority;
  } | null>(null);

  React.useEffect(() => {
    // Closing DISCARDS. This component is mounted for the life of the page (the
    // requirements page renders it unconditionally and only flips `open`), so
    // without this the abandoned draft survived in state: Cancel left
    // `hasChanges` true and `lastLoadedId` still pointing at the same row, so
    // re-opening it took neither the "new requirement" nor the "!hasChanges"
    // branch below, resurrected the abandoned text into the fields and left
    // Save enabled — one click and an edit the user had explicitly cancelled
    // was written, on top of whatever they meant to change this time.
    // Escape, the X, an outside click and Cancel all land here.
    if (!open) {
      lastLoadedId.current = null;
      setHasChanges(false);
      return;
    }
    if (!requirement) return;

    const isNewRequirement = lastLoadedId.current !== requirement.id;

    // `!hasChanges` keeps a background refetch from stomping on an edit in
    // progress; a fresh open (or a different row) always wins over local state.
    if (isNewRequirement || !hasChanges) {
      setTitle(requirement.title);
      setDescription(requirement.description);
      setStatus(requirement.status);
      setPriority(requirement.priority);
      setSeeded({
        title: requirement.title,
        description: requirement.description,
        status: requirement.status,
        priority: requirement.priority,
      });

      if (isNewRequirement) {
        setHasChanges(false);
        lastLoadedId.current = requirement.id;
      }
    }
  }, [open, requirement, hasChanges]);

  // This used to `return null` whenever there was no data, which conflated two very
  // different states. Closed is genuinely nothing to draw. But "open, fetch still in
  // flight" also drew nothing, so clicking "View Details" on the requirements table
  // opened no dialog at all until the response landed -- the click read as ignored, and
  // the natural response to that is to click again. And a fetch that FAILED stayed
  // blank forever, with no message and nothing to retry.
  //
  // Closed still renders nothing. Open renders the dialog immediately: a skeleton while
  // the request is in flight, and an explanation with a retry if it failed.
  if (!requirement) {
    if (!open) return null;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="2xl">
          <DialogHeader>
            <DialogTitle>
              {isError ? 'Requirement unavailable' : 'Loading requirement'}
            </DialogTitle>
            <DialogDescription>
              {isError
                ? 'This requirement could not be loaded. It may have been deleted, or the request failed.'
                : 'Fetching the details for this client requirement.'}
            </DialogDescription>
          </DialogHeader>
          {isError ? (
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={() => void refetch()} disabled={isFetching}>
                {isFetching ? 'Retrying...' : 'Try again'}
              </Button>
            </DialogFooter>
          ) : (
            // aria-busy so a screen reader announces the wait rather than an empty dialog.
            <div className="space-y-4" aria-busy="true" data-testid="requirement-detail-loading">
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-6 w-20" />
              </div>
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  const currentStatusConfig = getRequirementStatusConfig(status);
  const currentPriorityConfig = getPriorityConfig(priority);
  const StatusIcon = statusIcons[status] ?? FileText;

  // The create dialog enforces the same two rules with zod; this hand-rolled
  // form had no validation at all, so a title could be blanked and saved.
  const titleError = title.trim().length === 0 ? 'Title is required' : null;
  const descriptionError = description.trim().length === 0 ? 'Description is required' : null;
  const isValid = !titleError && !descriptionError;

  const handleSave = async () => {
    if (!isValid) return;
    try {
      // Only what changed — see changedFields. This dialog holds every field in local
      // state seeded when it opened, so saving after someone else edited a different
      // field used to write the stale value back over theirs, silently.
      const baseline = (seeded ?? requirement) as unknown as Record<string, unknown>;
      const updates = changedFields(
        baseline,
        {
          title: title.trim(),
          description: description.trim(),
          status,
          priority,
        } as Record<string, unknown>,
      );
      if (Object.keys(updates).length > 0) {
        await updateRequirement.mutateAsync({
          requirementId: requirement.id,
          projectId,
          // What these fields held when the dialog was seeded. The diff above covers two
          // people editing DIFFERENT fields; this covers them editing the same one, where
          // the later save would otherwise win outright and say nothing.
          updates: {
            ...updates,
            basedOn: basedOnFor(baseline, updates),
          } as EditBasedOn<{
            title?: string; description?: string;
            status?: RequirementStatus; priority?: RequirementPriority;
          }>,
        });
      }
    } catch {
      return; // onError already toasted; keep the dialog open with the edits intact
    }
    setHasChanges(false);
    onOpenChange(false);
  };

  const handleDelete = async (cascade = false) => {
    try {
      await deleteRequirement.mutateAsync({
        requirementId: requirement.id,
        projectId,
        cascade,
      });
      setDeleteBlockedBy(null);
      setDeleteDialogOpen(false);
      onOpenChange(false);
    } catch (error) {
      // 409 = linked functional requirements exist. Offer the cascade the API
      // already supports instead of leaving the user at a dead end.
      if (error instanceof ApiError && error.code === 409) {
        setDeleteBlockedBy(stripCascadeHint(error.message));
        return;
      }
      setDeleteDialogOpen(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="2xl" className="max-h-[90vh] overflow-y-auto">
          <DialogHeader className="space-y-4">
            <DialogTitle className="sr-only">Requirement Details</DialogTitle>
            <DialogDescription className="sr-only">
              View and edit the title, description, status and priority of this client requirement.
            </DialogDescription>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant={currentStatusConfig.badgeVariant}
                    className="flex items-center gap-1"
                  >
                    <StatusIcon className="h-3 w-3" />
                    {currentStatusConfig.label}
                  </Badge>
                  <div className="flex items-center gap-1">
                    <span className={`h-2 w-2 rounded-full ${currentPriorityConfig.dot}`} />
                    <span className="text-sm text-muted-foreground">
                      {currentPriorityConfig.label} Priority
                    </span>
                  </div>
                </div>
                <Input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setHasChanges(true);
                  }}
                  className="text-xl font-semibold h-auto py-2"
                  placeholder="Requirement Title"
                  disabled={!canEdit}
                />
                {canEdit && titleError && (
                  <p className="text-sm text-destructive-text">{titleError}</p>
                )}
              </div>
            </div>
          </DialogHeader>

          <Separator className="my-4" />

          {/* Main Content */}
          <div className="space-y-6 py-2">
            {/* Client Info */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <User className="h-4 w-4" />
                Client
              </div>
              <p className="text-base">{requirement.clientName}</p>
            </div>

            <Separator />

            {/* Description */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <FileText className="h-4 w-4" />
                Description
              </div>
              <Textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setHasChanges(true);
                }}
                className="min-h-[150px]"
                placeholder="Requirement Description"
                disabled={!canEdit}
              />
              {canEdit && descriptionError && (
                <p className="text-sm text-destructive-text">{descriptionError}</p>
              )}
            </div>

            <Separator />

            {/* Status & Priority Controls */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                {/* `aria-labelledby`, not just the label text. A <label for> does not name
                    a `button` -- button's accessible name comes from aria-labelledby,
                    aria-label, its contents, then title -- and this trigger's only content
                    is <SelectValue /> with no placeholder, which Radix renders from a
                    registry populated by the SelectItems inside SelectContent. Those mount
                    only once the select has been opened, so before first open the button
                    was empty and axe reported it, correctly, as unnamed. */}
                <label id="crd-status-label" htmlFor="crd-status" className="text-sm font-medium">
                  Status
                </label>
                <Select
                  value={status}
                  onValueChange={(value) => {
                    setStatus(value as RequirementStatus);
                    setHasChanges(true);
                  }}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="crd-status" aria-labelledby="crd-status-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="SUBMITTED">Submitted</SelectItem>
                    <SelectItem value="APPROVED">Approved</SelectItem>
                    <SelectItem
                      value="IN_PROGRESS"
                      disabled={followsWork && requirement?.status !== 'IN_PROGRESS'}
                    >
                      In Progress
                    </SelectItem>
                    <SelectItem
                      value="COMPLETED"
                      disabled={followsWork && requirement?.status !== 'COMPLETED'}
                    >
                      Completed
                    </SelectItem>
                    <SelectItem value="ARCHIVED">Archived</SelectItem>
                  </SelectContent>
                </Select>
                {followsWork && (
                  <p className="text-xs text-muted-foreground">
                    Once approved, it moves to In Progress and Completed with its functional
                    requirements.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                {/* See the note on the status select above. */}
                <label id="crd-priority-label" htmlFor="crd-priority" className="text-sm font-medium">
                  Priority
                </label>
                <Select
                  value={priority}
                  onValueChange={(value) => {
                    setPriority(value as RequirementPriority);
                    setHasChanges(true);
                  }}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="crd-priority" aria-labelledby="crd-priority-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Calendar className="h-4 w-4" />
                  Created
                </div>
                <p>{formatDate(requirement.createdAt)}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Calendar className="h-4 w-4" />
                  Last Updated
                </div>
                <p>{formatDate(requirement.updatedAt)}</p>
              </div>
            </div>
          </div>

          <Separator className="my-4" />

          <AttachmentsSection
            workspaceId={requirement.workspaceId}
            projectId={projectId}
            clientRequirementId={requirement.id}
          />

          <Separator className="my-4" />

          {/* What came of it. */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">What came of it</h3>
              {canRaiseEpic && (
                <Button asChild variant="outline" size="sm" className="order-last sm:order-none">
                  <Link href={`/epics?projectId=${projectId}&action=create&requirementId=${requirementId}`}>
                    Raise an epic
                  </Link>
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                {ledToEpics.length === 0 && ledToRequirements.length === 0
                  ? 'Nothing yet'
                  : `${ledToEpics.length} ${ledToEpics.length === 1 ? 'epic' : 'epics'} · ${ledToRequirements.length} functional ${ledToRequirements.length === 1 ? 'requirement' : 'requirements'}, ${delivered} done`}
              </p>
            </div>
            {ledToEpics.length === 0 && ledToRequirements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No epic has been raised from this requirement yet. An epic is the feature that
                delivers it; the functional requirements under it will be listed here.
              </p>
            ) : (
              <ul className="space-y-2">
                {ledToEpics.map((epic) => {
                  const under = ledToRequirements.filter((fr) => fr.epicId === epic.id);
                  return (
                    <li key={epic.id} className="rounded-md border p-3">
                      <Link
                        href={`/epics?projectId=${projectId}&epicId=${epic.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {epic.hierarchyId} · {epic.name}
                      </Link>
                      {under.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {under.map((fr) => (
                            <li key={fr.id} className="flex items-center justify-between gap-2 text-sm">
                              <Link
                                href={`/functional-requirements?projectId=${projectId}&frId=${fr.id}`}
                                className="min-w-0 truncate text-muted-foreground hover:underline"
                              >
                                {fr.hierarchyId} · {fr.title}
                              </Link>
                              <Badge variant="outline" className="shrink-0">
                                {getFunctionalRequirementStatusConfig(fr.status).label}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
                {/* Filed under this requirement but under no epic of it. */}
                {ledToRequirements
                  .filter((fr) => !ledToEpics.some((epic) => epic.id === fr.epicId))
                  .map((fr) => (
                    <li key={fr.id} className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
                      <Link
                        href={`/functional-requirements?projectId=${projectId}&frId=${fr.id}`}
                        className="min-w-0 truncate hover:underline"
                      >
                        {fr.hierarchyId} · {fr.title}
                      </Link>
                      <Badge variant="outline" className="shrink-0">
                        {getFunctionalRequirementStatusConfig(fr.status).label}
                      </Badge>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <DialogFooter className="sm:justify-between">
            {canDelete ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete this requirement"
                onClick={() => setDeleteDialogOpen(true)}
                className="text-destructive-text hover:text-destructive-text hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {canEdit ? 'Cancel' : 'Close'}
              </Button>
              {canEdit && (
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges || !isValid || updateRequirement.isPending}
                >
                  {updateRequirement.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation — escalates to a cascade prompt on the server's 409 */}
      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(next) => {
          setDeleteDialogOpen(next);
          if (!next) setDeleteBlockedBy(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteBlockedBy
                ? 'Delete linked functional requirements too?'
                : 'Delete Client Requirement?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteBlockedBy ? (
                <>
                  {deleteBlockedBy} Deleting them together removes the whole sub-tree (linked tasks
                  are kept and unlinked). This action cannot be undone.
                </>
              ) : (
                <>
                  This will permanently delete &quot;{requirement.title}&quot;. This action cannot
                  be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-row sm:justify-between sm:space-x-0">
            <AlertDialogCancel className="mt-2 sm:mt-0" disabled={deleteRequirement.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              // preventDefault: Radix closes the alert on click, which would hide
              // the in-flight state and the cascade prompt that follows a 409.
              onClick={(e) => {
                e.preventDefault();
                handleDelete(!!deleteBlockedBy);
              }}
              disabled={deleteRequirement.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteRequirement.isPending
                ? 'Deleting...'
                : deleteBlockedBy
                  ? 'Delete with linked FRs'
                  : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
