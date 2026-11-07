import { formatApiTimestamp } from '@strata/common';
import type { UploadedFile } from '@prisma/client';

/**
 * The API's UploadedFile field order. `size` is a BigInt in Prisma → Number
 * for the JSON int. `url` is supplied by StorageService as the `file.url` value.
 * createdAt/updatedAt serialize last (NativeModelSerializer pop-and-re-add).
 */
export function uploadedFileResponse(f: UploadedFile, url: string) {
  return {
    id: String(f.id),
    name: f.name,
    mimeType: f.mimeType,
    size: Number(f.size),
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    taskId: f.taskId,
    clientRequirementId: f.clientRequirementId,
    uploadedBy: f.uploadedById ?? null,
    bucketId: f.bucket,
    url,
    createdAt: formatApiTimestamp(f.createdAt),
    updatedAt: formatApiTimestamp(f.updatedAt),
  };
}
