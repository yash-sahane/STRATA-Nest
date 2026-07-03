import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Readable } from 'node:stream';
import { LocalStorageDriver } from './local-storage.driver';
import type { StorageDriver } from './storage.types';

/**
 * StorageService (arch §13) — the single seam domain modules use for blobs.
 * Driver is chosen by STORAGE_DRIVER (local | s3). The `local` driver is fully
 * implemented; `s3` is lazily loaded so the AWS SDK is only required when
 * actually selected (prod), keeping dev builds dependency-free.
 */
@Injectable()
export class StorageService implements StorageDriver {
  private readonly logger = new Logger('Storage');
  private readonly driver: StorageDriver;

  constructor(private readonly config: ConfigService) {
    const kind = this.config.get<string>('STORAGE_DRIVER', 'local');
    if (kind === 's3') {
      this.driver = this.loadS3Driver();
    } else {
      const root = this.config.get<string>('STORAGE_LOCAL_ROOT', './.storage');
      this.driver = new LocalStorageDriver(root);
      this.logger.log(`storage driver: local (${root})`);
    }
  }

  /**
   * Django `_upload_path`: `uploads/{workspace|_none}/{id}/{filename}`. Kept
   * identical so the storage key layout — and the resulting url — matches.
   */
  static key(workspaceId: string, id: string, filename: string): string {
    const ws = workspaceId || '_none';
    return `uploads/${ws}/${id}/${filename}`;
  }

  save(key: string, data: Buffer, contentType?: string): Promise<void> {
    return this.driver.save(key, data, contentType);
  }
  read(key: string): Promise<Buffer> {
    return this.driver.read(key);
  }
  createReadStream(key: string): Readable {
    return this.driver.createReadStream(key);
  }
  remove(key: string): Promise<void> {
    return this.driver.remove(key);
  }
  url(key: string): string {
    return this.driver.url(key);
  }

  /**
   * Lazy S3 driver. The `@aws-sdk/client-s3` dependency is not bundled in this
   * build; selecting `s3` without it fails loudly at boot (never silently falls
   * back to local). The driver interface is ready — installing the SDK + a thin
   * S3StorageDriver is the only remaining step (documented deferral).
   */
  private loadS3Driver(): StorageDriver {
    throw new Error(
      'STORAGE_DRIVER=s3 selected but the S3 driver is not built in this deployment. ' +
        'Install @aws-sdk/client-s3 and provide S3StorageDriver, or use STORAGE_DRIVER=local.',
    );
  }
}
