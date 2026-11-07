import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:'; // marks app-level encrypted values

/**
 * App-level encryption for integration access tokens at rest. AES-256-GCM
 * with a key derived (sha256) from INTEGRATION_TOKEN_ENC_KEY, so any non-empty
 * secret yields a valid 32-byte key. Ciphertext = `enc:v1:` + base64(iv|tag|ct),
 * so plaintext is NEVER what lands in the column. Decryption is only performed
 * server-side when a token is actually needed (provider calls); it is never
 * serialized back to clients (write-only field).
 */
@Injectable()
export class TokenCipher {
  private readonly logger = new Logger('TokenCipher');
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.get<string>('INTEGRATION_TOKEN_ENC_KEY', '') ?? '';
    const isProd = config.get<string>('NODE_ENV') === 'production';
    if (!secret) {
      if (isProd) {
        // Fail closed — never encrypt production tokens with a predictable key
        // (env validation already blocks this; this is defense in depth).
        throw new Error('INTEGRATION_TOKEN_ENC_KEY is required in production (token encryption at rest, D4).');
      }
      this.logger.warn(
        'INTEGRATION_TOKEN_ENC_KEY is empty — using a derived dev key. Set a real secret in production.',
      );
    }
    // sha256 → 32 bytes regardless of input length.
    this.key = createHash('sha256').update(secret || 'lt-integration-dev-key').digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
  }

  /**
   * The secret, in the clear. A value not in this format is not one this app
   * wrote: it is refused like one that cannot be decrypted — never handed back
   * as if it were the secret.
   */
  decrypt(value: string): string {
    if (!value.startsWith(PREFIX)) throw new Error('Not an encrypted secret.');
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }
}
