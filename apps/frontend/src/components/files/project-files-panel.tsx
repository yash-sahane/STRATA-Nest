'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/providers/confirm-provider';
import { useAuth } from '@/components/providers/auth-provider';
import { useHasPermissionIn } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { formatDate } from '@/lib/utils';
import {
  useFiles,
  useUploadFile,
  useDeleteFile,
  fileDownloadUrl,
  fileViewUrl,
  prepareFileOpen,
  MAX_UPLOAD_BYTES,
  type FileScope,
  type UploadedFile,
} from '@/hooks/use-file';
import { useTasks } from '@/hooks/use-task';
import { useClientRequirements } from '@/hooks/use-client-requirement';
import { Download, Eye, FileText, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import { useFilesRealtime } from '@/hooks/use-realtime';
import { toast } from 'sonner';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * The types the API serves `inline` — FilesController.INLINE_SAFE, matched the way
 * it matches them (parameters dropped, lower-cased). Every other type is sent as a
 * download whatever the URL asks for, so this used to offer "View" on any image or
 * text file — an SVG, an HTML page, a .tiff — and that "View" downloaded it.
 */
const VIEWABLE = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'application/pdf',
  'text/plain',
  'text/csv',
]);
const isViewable = (mimeType: string) =>
  VIEWABLE.has((mimeType || '').split(';')[0].trim().toLowerCase());

/**
 * View (in a new tab) or Download, once the session is known to be live — see
 * prepareFileOpen. The tab for View is opened inside the click and pointed at the
 * file afterwards: one opened after an await is a popup, and blocked as one.
 */
async function openFile(
  event: React.MouseEvent<HTMLAnchorElement>,
  file: UploadedFile,
  mode: 'view' | 'download'
) {
  event.preventDefault();
  const tab = mode === 'view' ? window.open('', '_blank') : null;
  try {
    await prepareFileOpen(file.id);
  } catch (error) {
    tab?.close();
    toast.error(`Couldn't open ${file.name}`, {
      description: error instanceof Error ? error.message : undefined,
    });
    return;
  }
  if (mode === 'download') {
    // Content-Disposition: attachment — the browser downloads and stays here.
    window.location.assign(fileDownloadUrl(file.id));
  } else if (tab) {
    // What rel="noreferrer" did for the plain link: the file's tab gets no handle
    // back to this one.
    tab.opener = null;
    tab.location.href = fileViewUrl(file.id);
  } else {
    // The blank tab itself was blocked; asking again is all that is left.
    window.open(fileViewUrl(file.id), '_blank', 'noopener,noreferrer');
  }
}

/**
 * One list of files: what it holds, who may add to it and remove from it, and the
 * upload and delete flows. The project's Files tab and the Attachments of a task or
 * a client requirement are this list over a different scope.
 */
function useFileList(scope: FileScope) {
  const { workspaceId, projectId, taskId, clientRequirementId } = scope;
  // Uploads and deletes by anybody else show without a reload.
  useFilesRealtime(workspaceId);
  const listing = useFiles(scope);
  // The same two rules FilesService applies, resolved in the PROJECT's workspace
  // (a project opened by link need not be in the selected one). Both used to be
  // props defaulting to `true` that no caller passed, so a read-only member was
  // shown Upload, and everyone was shown Delete on files that were not theirs.
  const { user } = useAuth();
  const canUpload = useHasPermissionIn(workspaceId, Permission.UPLOAD_FILE).allowed;
  const canManageProject = useHasPermissionIn(workspaceId, Permission.EDIT_PROJECT).allowed;
  // Deleting takes file:write, and somebody else's file takes project:update too.
  const canDeleteFile = (file: UploadedFile) =>
    canUpload && (canManageProject || (!!user && file.uploadedBy === user.id));
  const upload = useUploadFile();
  const remove = useDeleteFile();
  const confirm = useConfirm();

  const handleFiles = async (picked: File[]) => {
    if (!workspaceId || !projectId) return;
    for (const file of picked) {
      // Checked here as well as server-side so the user is told before a
      // 20 MB body is pushed over the wire and rejected.
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error('File is too large', { description: `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.` });
        continue;
      }
      await upload
        .mutateAsync({ file, workspaceId, projectId, taskId, clientRequirementId })
        .catch(() => undefined);
    }
  };

  const handleDelete = async (file: UploadedFile) => {
    const ok = await confirm({
      title: `Delete ${file.name}?`,
      description: 'The file is removed from storage permanently. This cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (ok) await remove.mutateAsync(file.id).catch(() => undefined);
  };

  return {
    ...listing,
    files: listing.data ?? [],
    ready: !!workspaceId && !!projectId,
    canUpload,
    canDeleteFile,
    upload,
    remove,
    handleFiles,
    handleDelete,
  };
}

type FileListState = ReturnType<typeof useFileList>;

/** The hidden picker and the button that opens it. */
function UploadButton({
  id,
  label,
  pending,
  disabled,
  onFiles,
  size,
  variant,
}: {
  id: string;
  label: string;
  pending: boolean;
  disabled: boolean;
  onFiles: (files: File[]) => Promise<void>;
  size?: 'sm';
  variant?: 'outline';
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={async (e) => {
          const input = e.currentTarget;
          await onFiles(Array.from(input.files ?? []));
          // Cleared, so picking the same file again is still a change.
          input.value = '';
        }}
      />
      <Button size={size} variant={variant} onClick={() => inputRef.current?.click()} disabled={pending || disabled}>
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Uploading
          </>
        ) : (
          <>
            <Upload className="h-4 w-4" />
            {label}
          </>
        )}
      </Button>
    </>
  );
}

/** The rows: name, size and date, then View (when a browser can show it), Download and Delete. */
function FileRows({ list, describe }: { list: FileListState; describe?: (file: UploadedFile) => React.ReactNode }) {
  return (
    <ul className="flex flex-col gap-2">
      {list.files.map((file) => (
        <li
          key={file.id}
          className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
              <FileText className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" title={file.name}>
                {file.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(file.size)} · {formatDate(file.createdAt)}
              </p>
              {describe?.(file)}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {/* Both are still real links — the address can be copied, middle-clicked —
                but a plain click checks the session first (openFile). */}
            {isViewable(file.mimeType) && (
              <Button size="sm" variant="ghost" asChild>
                <a
                  href={fileViewUrl(file.id)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => void openFile(event, file, 'view')}
                >
                  <Eye className="h-4 w-4" />
                  View
                </a>
              </Button>
            )}
            <Button size="sm" variant="outline" asChild>
              <a href={fileDownloadUrl(file.id)} onClick={(event) => void openFile(event, file, 'download')}>
                <Download className="h-4 w-4" />
                Download
              </a>
            </Button>
            {list.canDeleteFile(file) && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete ${file.name}`}
                disabled={list.remove.isPending}
                onClick={() => list.handleDelete(file)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

interface ProjectFilesPanelProps {
  workspaceId?: string;
  projectId?: string;
}

/**
 * Every file in the project — its own, and what is attached to its tasks and
 * client requirements, each saying where it is attached and linking there.
 */
export function ProjectFilesPanel({ workspaceId, projectId }: ProjectFilesPanelProps) {
  const list = useFileList({ workspaceId, projectId });
  // Only to name what a file is attached to, so only fetched when one is.
  const { data: tasks = [] } = useTasks(list.files.some((f) => f.taskId) ? projectId : undefined);
  const { data: requirements = [] } = useClientRequirements(
    list.files.some((f) => f.clientRequirementId) ? projectId : undefined
  );

  const attachedTo = (file: UploadedFile) => {
    if (file.taskId) {
      const task = tasks.find((t) => t.id === file.taskId);
      return (
        <p className="truncate text-xs text-muted-foreground">
          On task{' '}
          <Link href={`/tasks?projectId=${projectId}&taskId=${file.taskId}`} className="underline-offset-4 hover:underline">
            {task ? `${task.hierarchyId} · ${task.title}` : 'open the task'}
          </Link>
        </p>
      );
    }
    if (file.clientRequirementId) {
      const requirement = requirements.find((r) => r.id === file.clientRequirementId);
      return (
        <p className="truncate text-xs text-muted-foreground">
          On client requirement{' '}
          <Link
            href={`/requirements?projectId=${projectId}&crId=${file.clientRequirementId}`}
            className="underline-offset-4 hover:underline"
          >
            {requirement ? requirement.title : 'open the requirement'}
          </Link>
        </p>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">Files</CardTitle>
          <CardDescription>
            Documents and assets for this project, including those attached to its tasks and client requirements
          </CardDescription>
        </div>
        {list.canUpload && (
          <div>
            <UploadButton
              id="project-file-upload"
              label="Upload"
              pending={list.upload.isPending}
              disabled={!list.ready}
              onFiles={list.handleFiles}
            />
          </div>
        )}
      </CardHeader>
      <CardContent>
        {list.isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState
            title="Couldn't load files"
            description="The files for this project could not be fetched."
            onRetry={() => list.refetch()}
          />
        ) : list.files.length === 0 ? (
          <EmptyState
            icon={Paperclip}
            title="No files yet"
            description={
              list.canUpload
                ? 'Upload specs, designs or any document the team needs alongside this project.'
                : 'Nothing has been attached to this project yet.'
            }
          />
        ) : (
          <FileRows list={list} describe={attachedTo} />
        )}
      </CardContent>
    </Card>
  );
}

interface AttachmentsSectionProps {
  workspaceId?: string;
  projectId?: string;
  /** The task, or the client requirement, whose attachments these are. */
  taskId?: string;
  clientRequirementId?: string;
}

/** The Attachments of one task or one client requirement, inside its dialog. */
export function AttachmentsSection({ workspaceId, projectId, taskId, clientRequirementId }: AttachmentsSectionProps) {
  const list = useFileList({ workspaceId, projectId, taskId, clientRequirementId });
  const pickerId = React.useId();
  const forWhat = taskId
    ? 'Screenshots, logs or documents for this task.'
    : "The client's brief, sign-offs or any document behind this requirement.";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Paperclip className="h-4 w-4" />
          Attachments
          {list.files.length > 0 && <span className="text-muted-foreground">({list.files.length})</span>}
        </h3>
        {list.canUpload && (
          <UploadButton
            id={`attach-${pickerId}`}
            label="Attach files"
            size="sm"
            variant="outline"
            pending={list.upload.isPending}
            disabled={!list.ready}
            onFiles={list.handleFiles}
          />
        )}
      </div>
      {list.isLoading ? (
        <Skeleton className="h-14 w-full" />
      ) : list.isError ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the attachments.</p>
          <Button size="sm" variant="outline" onClick={() => list.refetch()}>
            Try again
          </Button>
        </div>
      ) : list.files.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {list.canUpload ? `Nothing attached yet. ${forWhat}` : 'Nothing attached.'}
        </p>
      ) : (
        <FileRows list={list} />
      )}
    </div>
  );
}
