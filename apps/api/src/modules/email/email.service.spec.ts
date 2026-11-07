import type { ConfigService } from '@nestjs/config';
import { EmailKind, type EmailJob } from '@strata/shared';
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

describe('EmailService.delivers', () => {
  const withKey = (transport: string, key: string, from = 'noreply@mail.acme.io'): ConfigService =>
    ({
      get: (k: string, d?: unknown) =>
        k === 'EMAIL_TRANSPORT'
          ? transport
          : k === 'RESEND_API_KEY'
            ? key
            : k === 'EMAIL_FROM'
              ? from
              : d,
    }) as never;

  it('is true only when a mail can actually leave: the queue, with a provider key', () => {
    expect(new EmailService(withKey('queue', 're_live')).delivers).toBe(true);
    // No key: the worker logs the subject and drops the body.
    expect(new EmailService(withKey('queue', '')).delivers).toBe(false);
    // Inline only ever logs.
    expect(new EmailService(withKey('inline', 're_live')).delivers).toBe(false);
  });

  // A key is not delivery. This is the configuration .env.example ships: a key
  // pasted in, the sender left on the placeholder. Every message was refused,
  // and the API went on answering "email sent" — including for the only copy
  // of a new account's password.
  it('is false while the sender is a placeholder no provider could verify', () => {
    for (const from of ['noreply@example.com', 'STRATA <noreply@example.org>', 'me@localhost', '']) {
      const svc = new EmailService(withKey('queue', 're_live', from));
      expect(svc.delivers).toBe(false);
      expect(svc.undeliverableBecause).toMatch(/placeholder/);
    }
    expect(new EmailService(withKey('queue', 're_live', 'Team <hello@acme.io>')).delivers).toBe(true);
  });

  /** A queue double whose Redis holds whatever the worker last recorded. */
  const withHealth = (stored: string | null) => {
    const svc = new EmailService(withKey('queue', 're_live'));
    const add = jest.fn().mockResolvedValue(undefined);
    (svc as unknown as { queue: unknown }).queue = {
      add,
      client: Promise.resolve({ get: jest.fn().mockResolvedValue(stored) }),
    };
    return { svc, add };
  };

  // The domain is real but the provider refuses it. Only the worker hears that.
  it('is false once the worker has recorded the provider refusing us', async () => {
    const { svc, add } = withHealth(
      JSON.stringify({ ok: false, reason: 'The acme.io domain is not verified.', at: 'now' }),
    );
    await svc.enqueue(job);
    // The mail is still queued — a later one succeeding is how this clears...
    expect(add).toHaveBeenCalled();
    // ...but the caller is no longer told it will arrive.
    expect(svc.delivers).toBe(false);
    expect(svc.undeliverableBecause).toMatch(/acme\.io domain is not verified/);
  });

  it('is true again once a message has gone through', async () => {
    const { svc } = withHealth(JSON.stringify({ ok: true, at: 'now' }));
    await svc.enqueue(job);
    expect(svc.delivers).toBe(true);
    expect(svc.undeliverableBecause).toBeNull();
  });

  it('believes nothing bad of a provider it has not heard about', async () => {
    const { svc } = withHealth(null);
    await svc.enqueue(job);
    expect(svc.delivers).toBe(true);
  });
});

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
        jobId: 'welcome_a@b.com', // ':' sanitized — BullMQ forbids it in a custom id
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
      }),
    );
  });

  it('sanitizes ":" out of the job id (BullMQ rejects it) for colon-heavy keys', async () => {
    const svc = new EmailService(cfg('queue'));
    const add = jest.fn().mockResolvedValue(undefined);
    (svc as unknown as { queue: { add: jest.Mock } }).queue = { add };
    const resetJob: EmailJob = {
      kind: EmailKind.PasswordReset,
      to: 'u@x.com',
      subject: 'Reset',
      text: 'link',
      idempotencyKey: 'reset:u@x.com:http://localhost:3000/reset?token=abc',
    };
    await svc.enqueue(resetJob);
    const opts = add.mock.calls[0][2] as { jobId: string };
    expect(opts.jobId).not.toContain(':');
    expect(opts.jobId).toBe('reset_u@x.com_http_//localhost_3000/reset?token=abc');
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
