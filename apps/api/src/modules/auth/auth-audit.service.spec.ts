import type { PinoLogger } from 'nestjs-pino';
import { AuthAuditService } from './auth-audit.service';

function fakeLogger() {
  const calls: Array<[string, Record<string, unknown>, string]> = [];
  const logger = {
    setContext: () => undefined,
    info: (obj: Record<string, unknown>, msg: string) => calls.push(['info', obj, msg]),
    warn: (obj: Record<string, unknown>, msg: string) => calls.push(['warn', obj, msg]),
  } as unknown as PinoLogger;
  return { logger, calls };
}

describe('AuthAuditService — structured events', () => {
  it('logs login success as info and failure as warn', () => {
    const { logger, calls } = fakeLogger();
    const svc = new AuthAuditService(logger);
    svc.loginSuccess('u1', 'a@b.com');
    svc.loginFailure('a@b.com');
    expect(calls[0]).toEqual([
      'info',
      { event: 'auth.login.success', userId: 'u1', email: 'a@b.com' },
      'auth.login.success',
    ]);
    expect(calls[1][0]).toBe('warn');
    expect(calls[1][1]).toMatchObject({ event: 'auth.login.failure', email: 'a@b.com' });
  });

  it('logs refresh rotation/rejection and reset lifecycle', () => {
    const { logger, calls } = fakeLogger();
    const svc = new AuthAuditService(logger);
    svc.refreshRotated('u1');
    svc.refreshRejected('revoked_or_unknown_jti');
    svc.passwordResetRequested('a@b.com');
    svc.passwordResetCompleted('u1');
    expect(calls.map((c) => c[1].event)).toEqual([
      'auth.refresh.rotated',
      'auth.refresh.rejected',
      'auth.password_reset.requested',
      'auth.password_reset.completed',
    ]);
    expect(calls[1][0]).toBe('warn');
  });
});
