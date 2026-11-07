import type { ConfigService } from '@nestjs/config';
import { EmailKind, type EmailJob } from '@strata/shared';
import { EmailProcessor } from './email.processor';

const cfg = (values: Record<string, unknown>): ConfigService =>
  ({ get: (k: string, d?: unknown) => (k in values ? values[k] : d) }) as never;

const job: EmailJob = { kind: EmailKind.PasswordReset, to: 'a@b.com', subject: 'reset', text: 'link' };

describe('EmailProcessor.handle', () => {
  it('logs (delivered=log) when no RESEND_API_KEY is configured', async () => {
    const proc = new EmailProcessor(cfg({ RESEND_API_KEY: '' }));
    await expect(proc.handle({ data: job })).resolves.toEqual({ delivered: 'log' });
  });

  /** Swap in a stub transport. The real SDK is a dependency now, so a test that
   *  let `loadResend` run would make a live API call. */
  const withTransport = (
    send: jest.Mock,
    loaded: boolean = true,
  ): EmailProcessor => {
    const proc = new EmailProcessor(cfg({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'x@y.com' }));
    (proc as unknown as { loadResend: () => Promise<unknown> }).loadResend = async () =>
      loaded ? { emails: { send } } : null;
    return proc;
  };

  it('logs (delivered=log) when a key is set but the Resend SDK is not installed', async () => {
    const proc = withTransport(jest.fn(), false);
    await expect(proc.handle({ data: job })).resolves.toEqual({ delivered: 'log' });
  });

  it('logs without calling the provider when EMAIL_FROM is a placeholder no provider accepts', async () => {
    const send = jest.fn();
    const proc = new EmailProcessor(cfg({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'noreply@example.com' }));
    (proc as unknown as { loadResend: () => Promise<unknown> }).loadResend = async () => ({ emails: { send } });
    await expect(proc.handle({ data: job })).resolves.toEqual({ delivered: 'log' });
    expect(send).not.toHaveBeenCalled();
  });

  it('reports delivered=resend when the transport accepts the message', async () => {
    const send = jest.fn().mockResolvedValue({ data: { id: 'e1' }, error: null });
    const proc = withTransport(send);
    await expect(proc.handle({ data: job })).resolves.toEqual({ delivered: 'resend' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'x@y.com', to: job.to }));
  });

  it('THROWS when the transport resolves with an error, so BullMQ can retry', async () => {
    // Resend resolves with { error } rather than rejecting; an unchecked call
    // reported a refused send (e.g. an unverified sending domain) as delivered.
    const send = jest.fn().mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'The example.com domain is not verified.' },
    });
    const proc = withTransport(send);
    await expect(proc.handle({ data: job })).rejects.toThrow(/not verified/);
  });

  /** A processor whose worker connection is a Redis double. */
  const withRedis = (send: jest.Mock) => {
    const proc = withTransport(send);
    const set = jest.fn().mockResolvedValue('OK');
    (proc as unknown as { worker: unknown }).worker = { client: Promise.resolve({ set }) };
    const recorded = () =>
      set.mock.calls.map(([key, value]) => [key, JSON.parse(String(value))] as const);
    return { proc, recorded };
  };

  // The API answers "email sent" from what it knows, and all it knew was that
  // a key was set. A refusal of the SENDER has to reach it.
  it('records it when the provider refuses the sender, so the API stops promising mail', async () => {
    const send = jest.fn().mockResolvedValue({
      data: null,
      error: { name: 'validation_error', statusCode: 403, message: 'The acme.io domain is not verified.' },
    });
    const { proc, recorded } = withRedis(send);
    await expect(proc.handle({ data: job })).rejects.toThrow(/not verified/);
    const [[key, health]] = recorded();
    expect(key).toBe('strata:email:health');
    expect(health).toMatchObject({ ok: false, reason: 'The acme.io domain is not verified.' });
  });

  it('does not read one bad recipient as "this installation cannot send"', async () => {
    const send = jest.fn().mockResolvedValue({
      data: null,
      error: { name: 'validation_error', statusCode: 422, message: 'Invalid `to` field.' },
    });
    const { proc, recorded } = withRedis(send);
    await expect(proc.handle({ data: job })).rejects.toThrow(/Invalid/);
    expect(recorded()).toEqual([]);
  });

  it('records a delivery, which is what clears an earlier refusal', async () => {
    const { proc, recorded } = withRedis(jest.fn().mockResolvedValue({ data: { id: 'e1' }, error: null }));
    await proc.handle({ data: job });
    expect(recorded()[0][1]).toMatchObject({ ok: true });
  });
});
