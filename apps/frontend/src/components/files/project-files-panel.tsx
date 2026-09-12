'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/providers/confirm-provider';
import { toast } from '@/hooks/use-toast';
import {
  useProjectFiles,
  useUploadFile,
  useDeleteFile,
  fileDownloadUrl,
  fileViewUrl,
  MAX_UPLOAD_BYTES,
  type UploadedFile,
} from '@/hooks/use-file';
import { Download, Eye, FileText, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import { format } from 'date-fns';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Only these open usefully in a browser tab; everything else downloads. */
const INLINE = /^(image\/|application\/pdf$|text\/)/;

interface ProjectFilesPanelProps {
  workspaceId?: string;
  projectId?: string;
  canUpload?: boolean;
  canDelete?: boolean;
}

export function ProjectFilesPanel({
  workspaceId,
  projectId,
  canUpload = true,
  canDelete = true,
}: ProjectFilesPanelProps) {
  const { data: files = [], isLoading, isError, refetch } = useProjectFiles(workspaceId, projectId);
  const upload = useUploadFile();
  const remove = useDeleteFile();
  const confirm = useConfirm();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleFiles = async (list: FileList | null) => {
    if (!list?.length || !workspaceId || !projectId) return;
    for (const file of Array.from(list)) {
      // Checked here as well as server-side so the user is told before a
      // 20 MB body is pushed over the wire and rejected.
      if (file.size > MAX_UPLOAD_BYTES) {
        toast({
          title: 'File is too large',
          description: `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
          variant: 'destructive',
        });
        continue;
      }
      await upload.mutateAsync({ file, workspaceId, projectId }).catch(() => undefined);
    }
    if (inputRef.current) inputRef.current.value = '';
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

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">Files</CardTitle>
          <CardDescription>Documents and assets attached to this project</CardDescription>
        </div>
        {canUpload && (
          <div>
            <input
              ref={inputRef}
              id="project-file-upload"
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button
              onClick={() => inputRef.current?.click()}
              disabled={upload.isPending || !workspaceId || !projectId}
            >
              {upload.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Upload
                </>
              )}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title="Couldn't load files"
            description="The files for this project could not be fetched."
            onRetry={() => refetch()}
          />
        ) : files.length === 0 ? (
          <EmptyState
            icon={Paperclip}
            title="No files yet"
            description={
              canUpload
                ? 'Upload specs, designs or any document the team needs alongside this project.'
                : 'Nothing has been attached to this project yet.'
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {files.map((file) => (
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
                      {formatBytes(file.size)} · {format(new Date(file.createdAt), 'MMM d, yyyy')}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  {INLINE.test(file.mimeType) && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={fileViewUrl(file.id)} target="_blank" rel="noreferrer">
                        <Eye className="h-4 w-4" />
                        View
                      </a>
                    </Button>
                  )}
                  <Button size="sm" variant="outline" asChild>
                    <a href={fileDownloadUrl(file.id)}>
                      <Download className="h-4 w-4" />
                      Download
                    </a>
                  </Button>
                  {canDelete && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${file.name}`}
                      disabled={remove.isPending}
                      onClick={() => handleDelete(file)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
