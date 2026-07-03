import type { ConfigService } from '@nestjs/config';
import { EmailKind, type EmailJob } from '@lt/shared';
import { EmailService } from './email.service';

const cfg = (transport: string): ConfigService =>
  ({ get: (k: string, d?: unknown) => (k === 'EMAIL_TRANSPORT' ? transport : d) }) as never;

const job: EmailJob = {
  kind: EmailKind.Welcome,
  to: 'a@b.com',
  subject: 'hi',
  text: 'body',
  idempotencyKey: 'welcome:a@b.com',
};

describe('EmailService', () => {
  it('inline transport logs and never touches a queue', async () => {
    const svc = new EmailService(cfg('inline'));
    svc.onModuleInit();
    await expect(svc.enqueue(job)).resolves.toBeUndefined();
  });

  it('queue transport adds a job keyed by idempotencyKey with retries/backoff', async () => {
    const svc = new EmailService(cfg('queue'));
    const add = jest.fn().mockResolvedValue(undefined);
    // Inject a fake queue instead of standing up Redis.
    (svc as unknown as { queue: { add: jest.Mock } }).queue = { add };

    await svc.enqueue(job);

    expect(add).toHaveBeenCalledWith(
      'send-email',
      job,
      expect.objectContaining({
        jobId: 'welcome:a@b.com',
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      }),
    );
  });

  it('falls back to logging if the queue add throws (never breaks the request)', async () => {
    const svc = new EmailService(cfg('queue'));
    (svc as unknown as { queue: { add: jest.Mock } }).queue = {
      add: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    await expect(svc.enqueue(job)).resolves.toBeUndefined();
  });

  it('send() returns an optimistic queued result for the HTTP endpoints', async () => {
    const svc = new EmailService(cfg('queue'));
    (svc as unknown as { queue: { add: jest.Mock } }).queue = { add: jest.fn().mockResolvedValue(undefined) };
    await expect(svc.send(job)).resolves.toEqual({ success: true, backend: 'queue', sent: true, queued: true });
  });

  it('send() reports the inline backend when not queued', async () => {
    const svc = new EmailService(cfg('inline'));
    svc.onModuleInit();
    await expect(svc.send(job)).resolves.toEqual({ success: true, backend: 'inline', sent: true, queued: false });
  });
});
