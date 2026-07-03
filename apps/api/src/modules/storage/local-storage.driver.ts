import { createReadStream, promises as fs } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { StorageDriver } from './storage.types';

/**
 * Filesystem driver. Keys are stored under `root` (STORAGE_LOCAL_ROOT); the
 * public URL mirrors Django `MEDIA_URL + key` (= `media/<key>`) so the `url`
 * field is byte-identical. Keys are confined to `root` (path-traversal guard).
 */
export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor(root: string, private readonly mediaUrl = 'media/') {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    const full = resolve(join(this.root, key));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Illegal storage key: ${key}`);
    }
    return full;
  }

  async save(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, data);
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(this.pathFor(key));
  }

  createReadStream(key: string): Readable {
    return createReadStream(this.pathFor(key));
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.pathFor(key), { force: true });
  }

  url(key: string): string {
    return `${this.mediaUrl}${key}`;
  }
}
