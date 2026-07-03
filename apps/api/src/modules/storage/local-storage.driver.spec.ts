import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageDriver } from './local-storage.driver';
import { StorageService } from './storage.service';

describe('LocalStorageDriver', () => {
  let root: string;
  let driver: LocalStorageDriver;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'lt-storage-'));
    driver = new LocalStorageDriver(root);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('save → read round-trips bytes', async () => {
    const key = StorageService.key('w1', 'f1', 'hello.txt');
    await driver.save(key, Buffer.from('hi there'));
    expect((await driver.read(key)).toString()).toBe('hi there');
  });

  it('remove is idempotent (no throw when already gone)', async () => {
    await expect(driver.remove('uploads/w1/f1/none.txt')).resolves.toBeUndefined();
  });

  it('url mirrors Django MEDIA_URL + key', () => {
    expect(driver.url('uploads/w1/f1/a.png')).toBe('media/uploads/w1/f1/a.png');
  });

  it('rejects path-traversal keys', async () => {
    await expect(driver.save('../escape.txt', Buffer.from('x'))).rejects.toThrow(/Illegal storage key/);
  });
});

describe('StorageService.key (Django _upload_path parity)', () => {
  it('uses the workspace id, or _none when empty', () => {
    expect(StorageService.key('w1', 'id1', 'a.txt')).toBe('uploads/w1/id1/a.txt');
    expect(StorageService.key('', 'id1', 'a.txt')).toBe('uploads/_none/id1/a.txt');
  });
});
