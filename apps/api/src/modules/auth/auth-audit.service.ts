import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

/**
 * Structured authentication audit log. Every event
 * carries the request correlation id automatically (pino stores the per-request
 * logger in AsyncLocalStorage), so an audit line ties back to its HTTP request
 * log (ip, url, status). Failures log at WARN so they're easy to alert on.
 */
@Injectable()
export class AuthAuditService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext('AuthAudit');
  }

  private emit(event: string, data: Record<string, unknown>, level: 'info' | 'warn' = 'info'): void {
    this.logger[level]({ event, ...data }, event);
  }

  loginSuccess(userId: string, email: string): void {
    this.emit('auth.login.success', { userId, email });
  }
  loginFailure(email: string): void {
    this.emit('auth.login.failure', { email }, 'warn');
  }
  refreshRotated(userId: string): void {
    this.emit('auth.refresh.rotated', { userId });
  }
  refreshRejected(reason: string): void {
    this.emit('auth.refresh.rejected', { reason }, 'warn');
  }
  logout(userId: string): void {
    this.emit('auth.logout', { userId });
  }
  passwordChanged(userId: string): void {
    this.emit('auth.password.changed', { userId });
  }
  passwordResetRequested(email: string): void {
    this.emit('auth.password_reset.requested', { email });
  }
  passwordResetCompleted(userId: string): void {
    this.emit('auth.password_reset.completed', { userId });
  }
}
