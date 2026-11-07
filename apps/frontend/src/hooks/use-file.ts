import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources, query } from '@/lib/api/client';
import { API_BASE, fetchWithSession, restClient } from '@/lib/api/rest-client';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

/**
 * Uploaded files: multipart upload, membership-scoped listing, and
 * inline/attachment streaming (apps/api/src/modules/files).
 *
 * A file belongs to a project and, inside it, to at most one task or client
 * requirement — its attachments. The project's Files tab lists all of them.
 */

export interface UploadedFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  workspaceId: string;
  projectId: string;
  /** The task it is attached to, or '' (see clientRequirementId). */
  taskId: string;
  /** The client requirement it is attached to, or ''. Neither: the project's own file. */
  clientRequirementId: string;
  uploadedBy: string | null;
  bucketId: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

/** Streaming endpoints. `download` sets Content-Disposition: attachment. */
export const fileDownloadUrl = (id: string) => `${API_BASE}/api/v1/files/${id}/download/`;
export const fileViewUrl = (id: string) => `${API_BASE}/api/v1/files/${id}/view/`;

/**
 * Make sure the session is live — and the file still there — before the browser
 * navigates to one of the URLs above.
 *
 * View and Download are plain navigations, which restClient never sees: with the
 * access cookie lapsed (fifteen idle minutes) View opened a tab reading
 * "Unauthorized", Download replaced this page with it, and every retry did the
 * same until something else renewed the session. Asking for the file's record
 * first goes through restClient's refresh-and-retry, and a file deleted since the
 * list loaded is reported here instead of in a tab of JSON.
 */
export async function prepareFileOpen(id: string): Promise<void> {
  await restClient.get(`/api/v1/files/${id}/`);
}

/** Which files a list holds: all of a project's, or one task's or client requirement's. */
export interface FileScope {
  workspaceId?: string;
  projectId?: string;
  taskId?: string;
  clientRequirementId?: string;
}

export function useFiles({ workspaceId, projectId, taskId, clientRequirementId }: FileScope) {
  return useQuery({
    queryKey: ['files', workspaceId, projectId, taskId ?? '', clientRequirementId ?? ''],
    queryFn: async () => {
      if (!workspaceId || !projectId) return [] as UploadedFile[];
      const filters = [query.equal('workspaceId', workspaceId), query.equal('projectId', projectId)];
      if (taskId) filters.push(query.equal('taskId', taskId));
      if (clientRequirementId) filters.push(query.equal('clientRequirementId', clientRequirementId));
      const response = await resources.listAll<UploadedFile>('files', [...filters, query.orderDesc('createdAt')]);
      return response.items as UploadedFile[];
    },
    enabled: !!workspaceId && !!projectId,
  });
}

/** Largest upload the API accepts before the request is rejected. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function useUploadFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      file: File;
      workspaceId: string;
      projectId: string;
      taskId?: string;
      clientRequirementId?: string;
    }) => {
      // Multipart, not JSON: the API reads the binary through FileInterceptor
      // and the ids from the same form body. fetch sets the boundary itself, so
      // Content-Type must NOT be supplied here.
      const form = new FormData();
      form.append('file', data.file);
      form.append('workspaceId', data.workspaceId);
      form.append('projectId', data.projectId);
      if (data.taskId) form.append('taskId', data.taskId);
      if (data.clientRequirementId) form.append('clientRequirementId', data.clientRequirementId);

      // fetchWithSession, not fetch: restClient cannot send multipart, and a bare
      // fetch never renewed a lapsed session — the upload failed with 401, as did
      // every retry. (On that 401 the body is sent a second time; FormData can be.)
      const response = await fetchWithSession(`${API_BASE}/api/v1/files/`, {
        method: 'POST',
        body: form,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message || `Upload failed (${response.status})`);
      }
      return (await response.json()) as UploadedFile;
    },
    onSuccess: (file, data) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      toast.success(data.taskId || data.clientRequirementId ? 'File attached' : 'File uploaded', { description: file.name });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to upload file', { error });
      toast.error("Couldn't upload the file", { description: message });
    },
  });
}

export function useDeleteFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fileId: string) => {
      await resources.remove('files', fileId);
      return fileId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      toast.success('File deleted');
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to delete file', { error });
      toast.error("Couldn't delete the file", { description: message });
    },
  });
}
