import type { Readable } from 'node:stream';

/**
 * Storage abstraction (arch §13). Domain modules depend ONLY on this interface,
 * never on fs or an AWS SDK directly — swapping local↔S3 is a config change.
 */
export interface StorageDriver {
  /** Persist bytes at `key`. */
  save(key: string, data: Buffer, contentType?: string): Promise<void>;
  /** Whole-object read (used where a Buffer is convenient). */
  read(key: string): Promise<Buffer>;
  /** Streaming read (used by the download/view/preview endpoints). */
  createReadStream(key: string): Readable;
  /** Remove the object; must not throw if it is already gone. */
  remove(key: string): Promise<void>;
  /** Public URL as the frontend expects it (Django `file.url` parity). */
  url(key: string): string;
}
