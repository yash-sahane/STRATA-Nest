import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { FilesService, type UploadPart } from './files.service';
import { StorageService } from '../storage/storage.service';

const user = { id: 'u1' } as User;
const row = {
  id: 'f1',
  name: 'a.txt',
  filePath: 'uploads/w1/f1/a.txt',
  mimeType: 'text/plain',
  size: BigInt(5),
  workspaceId: 'w1',
  projectId: '',
  uploadedById: 'u1',
  bucket: 'default',
  createdAt: new Date('2026-02-01'),
  updatedAt: new Date('2026-02-01'),
};

function build(part: UploadPart | undefined, overrides: Record<string, unknown> = {}) {
  const create = jest.fn().mockResolvedValue(row);
  const del = jest.fn().mockResolvedValue(row);
  const prisma = { uploadedFile: { create, delete: del } } as unknown as PrismaService;
  const assertMember = jest.fn().mockResolvedValue(undefined);
  // Uploading and deleting now take file:write, which the read-only MEMBER role
  // no longer holds.
  const assertPermission = jest.fn().mockResolvedValue(undefined);
  const access = {
    accessibleWorkspaceIds: jest.fn().mockResolvedValue(['w1']),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    assertMember,
    assertPermission,
    ...overrides,
  } as never;
  const save = jest.fn().mockResolvedValue(undefined);
  const storage = { save, url: (k: string) => `media/${k}` } as unknown as StorageService;
  return { svc: new FilesService(prisma, access, storage), create, save, assertMember, assertPermission, del };
}

describe('FilesService.create (multipart upload)', () => {
  it('rejects a request without a file part', async () => {
    const { svc } = build(undefined);
    await expect(svc.create(user, undefined, {})).rejects.toThrow(BadRequestException);
  });

  it('claims the metadata row BEFORE writing the blob, and rolls it back if the write fails', async () => {
    // The blob used to be written first, so re-posting a known id and filename
    // overwrote another user's file and the duplicate-insert 400 hid it.
    const part: UploadPart = { originalname: 'a.txt', buffer: Buffer.from('hello'), size: 5 };
    const { svc, create, save, del } = build(part);
    save.mockRejectedValueOnce(new Error('disk full'));
    await expect(svc.create(user, part, { workspaceId: 'w1' })).rejects.toThrow('disk full');
    expect(create).toHaveBeenCalledTimes(1);
    // the id is server-generated, so the rollback targets whatever was claimed
    const claimed = (create.mock.calls[0][0] as { data: { id: string } }).data.id;
    expect(del).toHaveBeenCalledWith({ where: { id: claimed } });
  });

  it('ignores a client-supplied id, so the storage key cannot be aimed at an existing file', async () => {
    const part: UploadPart = { originalname: 'a.txt', buffer: Buffer.from('hello'), size: 5 };
    const { svc, create } = build(part);
    await svc.create(user, part, { workspaceId: 'w1', id: 'victims-file-id' });
    const { data } = create.mock.calls[0][0] as { data: { id: string; filePath: string } };
    expect(data.id).not.toBe('victims-file-id');
    expect(data.filePath).not.toContain('victims-file-id');
  });

  it('takes file:write to upload', async () => {
    const part: UploadPart = { originalname: 'a.txt', buffer: Buffer.from('hello'), size: 5 };
    const { svc, assertPermission } = build(part);
    await svc.create(user, part, { workspaceId: 'w1' });
    expect(assertPermission).toHaveBeenCalledWith(user, 'w1', 'file:write');
  });

  it('saves the blob then persists the metadata row with the storage key', async () => {
    const part: UploadPart = { originalname: 'a.txt', buffer: Buffer.from('hello'), mimetype: 'text/plain', size: 5 };
    const { svc, create, save } = build(part);
    const res = await svc.create(user, part, { workspaceId: 'w1' });

    // blob saved under the fixed upload key layout (id segment is server-generated)
    expect(save).toHaveBeenCalledTimes(1);
    const [key, buf, mime] = save.mock.calls[0];
    expect(key).toMatch(/^uploads\/w1\/[A-Za-z0-9_-]+\/a\.txt$/);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(mime).toBe('text/plain');
    expect(create).toHaveBeenCalledTimes(1);
    // response mapper: size is a Number, uploadedBy present, and `url` is the
    // route that SERVES the file. It used to be the storage driver's
    // `media/<key>` path, which nothing serves — every file row advertised a link
    // that 404s, and this assertion pinned it.
    expect(res).toMatchObject({ id: 'f1', size: 5, uploadedBy: 'u1', bucketId: 'default', url: '/api/v1/files/f1/view/' });
  });

  it('checks membership of the TARGET workspace before writing anything', async () => {
    const part: UploadPart = { originalname: 'a.txt', buffer: Buffer.from('hello'), size: 5 };
    const denied = jest.fn().mockRejectedValue(new ForbiddenException());
    const { svc, create, save } = build(part, { assertMember: denied });

    // 'w9' is another tenant's workspace — the upload must not reach storage.
    await expect(svc.create(user, part, { workspaceId: 'w9' })).rejects.toThrow(ForbiddenException);
    expect(denied).toHaveBeenCalledWith(user, 'w9');
    expect(save).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a global (workspace-less) upload from a non-admin', async () => {
    const part: UploadPart = { originalname: 'a.txt', buffer: Buffer.from('hello'), size: 5 };
    const { svc, save } = build(part);

    // workspaceId '' lands in every user's file list, so it is admin-only.
    await expect(svc.create(user, part, {})).rejects.toThrow(ForbiddenException);
    expect(save).not.toHaveBeenCalled();
  });

  it('allows a platform admin to upload a global file', async () => {
    const part: UploadPart = { originalname: 'a.txt', buffer: Buffer.from('hello'), size: 5 };
    const { svc, save, assertMember } = build(part, {
      isPlatformAdmin: jest.fn().mockReturnValue(true),
    });

    await svc.create(user, part, {});
    expect(assertMember).not.toHaveBeenCalled();
    expect(save.mock.calls[0][0]).toMatch(/^uploads\/_none\//);
  });
});
