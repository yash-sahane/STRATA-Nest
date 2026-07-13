import { BadRequestException } from '@nestjs/common';
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

function build(part: UploadPart | undefined) {
  const create = jest.fn().mockResolvedValue(row);
  const prisma = { uploadedFile: { create } } as unknown as PrismaService;
  const access = { accessibleWorkspaceIds: jest.fn().mockResolvedValue(['w1']) } as never;
  const save = jest.fn().mockResolvedValue(undefined);
  const storage = { save, url: (k: string) => `media/${k}` } as unknown as StorageService;
  return { svc: new FilesService(prisma, access, storage), create, save };
}

describe('FilesService.create (multipart upload)', () => {
  it('rejects a request without a file part', async () => {
    const { svc } = build(undefined);
    await expect(svc.create(user, undefined, {})).rejects.toThrow(BadRequestException);
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
    // response mapper: size is a Number, uploadedBy present, url from storage
    expect(res).toMatchObject({ id: 'f1', size: 5, uploadedBy: 'u1', bucketId: 'default', url: 'media/uploads/w1/f1/a.txt' });
  });
});
