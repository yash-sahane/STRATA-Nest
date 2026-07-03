import type { ConfigService } from '@nestjs/config';
import { EmailKind, type EmailJob } from '@lt/shared';
import { EmailProcessor } from './email.processor';

const cfg = (values: Record<string, unknown>): ConfigService =>
  ({ get: (k: string, d?: unknown) => (k in values ? values[k] : d) }) as never;

const job: EmailJob = { kind: EmailKind.PasswordReset, to: 'a@b.com', subject: 'reset', text: 'link' };

describe('EmailProcessor.handle', () => {
  it('logs (delivered=log) when no RESEND_API_KEY is configured', async () => {
    const proc = new EmailProcessor(cfg({ RESEND_API_KEY: '' }));
    await expect(proc.handle({ data: job })).resolves.toEqual({ delivered: 'log' });
  });

  it('logs (delivered=log) when a key is set but the Resend SDK is not installed', async () => {
    const proc = new EmailProcessor(cfg({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'x@y.com' }));
    // resend is not a dependency in this build → loadResend returns null → log.
    await expect(proc.handle({ data: job })).resolves.toEqual({ delivered: 'log' });
  });
});
