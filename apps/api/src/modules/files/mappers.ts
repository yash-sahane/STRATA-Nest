import { toDjangoIso } from '@lt/common';
import type { UploadedFile } from '@prisma/client';

/**
 * Django UploadedFileSerializer order. `size` is a BigInt in Prisma → Number
 * for the JSON int. `url` is supplied by StorageService (file.url parity).
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
    uploadedBy: f.uploadedById ?? null,
    bucketId: f.bucket,
    url,
    createdAt: toDjangoIso(f.createdAt),
    updatedAt: toDjangoIso(f.updatedAt),
  };
}
