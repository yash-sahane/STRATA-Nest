import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources, query } from '@/lib/api/client';
import { API_BASE } from '@/lib/api/rest-client';
import { toast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';

/**
 * Uploaded files.
 *
 * The API has carried a complete files module for a long time — multipart
 * upload, membership-scoped listing, and inline/attachment streaming backed by
 * a StorageService with local and S3 drivers — but nothing on the client ever
 * called it, so there was no way to attach anything to anything.
 */

export interface UploadedFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  workspaceId: string;
  projectId: string;
  uploadedBy: string | null;
  bucketId: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

/** Streaming endpoints. `download` sets Content-Disposition: attachment. */
export const fileDownloadUrl = (id: string) => `${API_BASE}/api/v1/files/${id}/download/`;
export const fileViewUrl = (id: string) => `${API_BASE}/api/v1/files/${id}/view/`;

export function useProjectFiles(workspaceId?: string, projectId?: string) {
  return useQuery({
    queryKey: ['files', workspaceId, projectId],
    queryFn: async () => {
      if (!workspaceId || !projectId) return [] as UploadedFile[];
      const response = await resources.listAll<UploadedFile>('files', [
        query.equal('workspaceId', workspaceId),
        query.equal('projectId', projectId),
        query.orderDesc('createdAt'),
      ]);
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
    mutationFn: async (data: { file: File; workspaceId: string; projectId: string }) => {
      // Multipart, not JSON: the API reads the binary through FileInterceptor
      // and the ids from the same form body. fetch sets the boundary itself, so
      // Content-Type must NOT be supplied here.
      const form = new FormData();
      form.append('file', data.file);
      form.append('workspaceId', data.workspaceId);
      form.append('projectId', data.projectId);

      const response = await fetch(`${API_BASE}/api/v1/files/`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message || `Upload failed (${response.status})`);
      }
      return (await response.json()) as UploadedFile;
    },
    onSuccess: (file) => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      toast({ title: 'File uploaded', description: file.name });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to upload file', { error });
      toast({ title: "Couldn't upload the file", description: message, variant: 'destructive' });
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
      toast({ title: 'File deleted' });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to delete file', { error });
      toast({ title: "Couldn't delete the file", description: message, variant: 'destructive' });
    },
  });
}
