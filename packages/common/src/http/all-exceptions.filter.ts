import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorEnvelope } from '@strata/shared';

/**
 * Maps HTTP status → the exception-class-style name used in the versioned error
 * envelope's `type` field. 401 defaults to `NotAuthenticated`;
 * endpoints that mean `AuthenticationFailed`/`InvalidToken` set it explicitly.
 */
const ERROR_TYPE_BY_STATUS: Record<number, string> = {
  400: 'ValidationError',
  401: 'NotAuthenticated',
  403: 'PermissionDenied',
  404: 'NotFound',
  405: 'MethodNotAllowed',
  406: 'NotAcceptable',
  415: 'UnsupportedMediaType',
  429: 'Throttled',
  500: 'APIException',
  503: 'ServiceUnavailable',
};

/**
 * Prisma's "the database is not there right now" codes: cannot reach it (P1001),
 * timed out (P1002, P1008), it closed the connection (P1017 — what a running API
 * gets when Postgres goes away), no pooled connection in time (P2024).
 */
const PRISMA_UNAVAILABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

/**
 * A backing service — the database or Redis — that cannot be reached right now.
 *
 * These reached the client as a bare 500 "Internal server error", which reads as
 * a fault in the request and gives nothing to wait on. They are transient: the
 * same request works once the service is back. So they are a 503 with
 * Retry-After, which rest-client.ts and the query retry policy already honour.
 */
function isBackingServiceUnavailable(exception: unknown): boolean {
  const e = exception as { constructor?: { name?: string }; code?: unknown; message?: unknown };
  const cls = e?.constructor?.name;
  if (cls === 'PrismaClientInitializationError') return true;
  if (
    (cls === 'PrismaClientKnownRequestError' || cls === 'PrismaClientUnknownRequestError') &&
    typeof e.code === 'string' &&
    PRISMA_UNAVAILABLE_CODES.has(e.code)
  ) {
    return true;
  }
  // ioredis: a command that outlived commandTimeout, ran out of retries, or was
  // issued on a connection that has gone.
  if (cls === 'MaxRetriesPerRequestError') return true;
  const message = typeof e?.message === 'string' ? e.message : '';
  return /^(Command timed out|Connection is closed|Stream isn't writeable)/.test(message);
}

/**
 * Prisma known-request error codes worth mapping to a 4xx instead of a raw 500:
 * a unique-constraint violation (e.g. a duplicate create) is a client input
 * error, not a server fault, and must not leak a bare "Internal server error"
 * 500. Message text is intentionally generic; only the status class (4xx, not
 * 500) and "don't leak DB column/table names" are guaranteed here.
 */
const PRISMA_ERROR_STATUS: Record<string, { status: number; message: string }> = {
  P2002: { status: 400, message: 'A record with these values already exists.' },
  P2003: { status: 400, message: 'Invalid reference to a related record.' },
  P2025: { status: 404, message: 'Not found.' },
};

function isPrismaKnownRequestError(exception: unknown): exception is { code: string } {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    (exception as { constructor?: { name?: string } }).constructor?.name === 'PrismaClientKnownRequestError' &&
    typeof (exception as { code?: unknown }).code === 'string'
  );
}

/**
 * Global exception filter enforcing the versioned error envelope:
 *
 *   { "error": { "message": <string|list|dict>, "code": <httpStatus>, "type": <string> } }
 *
 * The frontend `rest-client.ts` unwraps `data.error.message`, so the shape must
 * not change under /api/v1.
 */
/** body-parser's oversized-payload error, which is a plain Error subclass. */
function isBodyTooLarge(exception: unknown): boolean {
  const e = exception as { type?: unknown; status?: unknown; statusCode?: unknown };
  return (
    e?.type === 'entity.too.large' || e?.status === 413 || e?.statusCode === 413
  );
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] | Record<string, unknown> = 'Internal server error';
    let type = (exception as { constructor?: { name?: string } })?.constructor?.name ?? 'Error';
    let fields: string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const b = body as Record<string, unknown>;
        message = (b.message ?? b.detail ?? b) as typeof message;
        // Allow a caller to pin an exact error 'type' via the exception payload.
        if (typeof b.type === 'string') type = b.type;
        // And to name the fields it is about — a lost-update refusal does, so a
        // form can show the other person's values in just those fields.
        if (Array.isArray(b.fields) && b.fields.every((f) => typeof f === 'string')) {
          fields = b.fields as string[];
        }
      }
      // Default the type to the canonical name for this status, unless pinned above.
      if (type === exception.constructor.name || type === 'Error') {
        type = ERROR_TYPE_BY_STATUS[status] ?? exception.constructor.name;
      }
    } else if (isBodyTooLarge(exception)) {
      // body-parser rejects an oversized payload with a plain Error carrying
      // `type: 'entity.too.large'` — not an HttpException, so without this it
      // reached the client as a bare 500 with nothing to act on.
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      message = 'That upload is too large. Please choose a smaller file.';
      type = ERROR_TYPE_BY_STATUS[status] ?? 'PayloadTooLarge';
    } else if (isPrismaKnownRequestError(exception) && PRISMA_ERROR_STATUS[exception.code]) {
      const mapped = PRISMA_ERROR_STATUS[exception.code];
      status = mapped.status;
      message = mapped.message;
      type = ERROR_TYPE_BY_STATUS[status] ?? 'ValidationError';
    } else if (isBackingServiceUnavailable(exception)) {
      // Logged as a warning, once per request, without the stack: the cause is
      // the outage, not this code path.
      const e = exception as { code?: unknown; message?: unknown };
      const lastLine = String(e?.message ?? '').trim().split('\n').pop() ?? '';
      this.logger.warn(
        `Backing service unavailable: ${[typeof e?.code === 'string' ? e.code : '', lastLine].filter(Boolean).join(' ')}`,
      );
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'The service is temporarily unavailable. Please try again in a moment.';
      type = ERROR_TYPE_BY_STATUS[status];
      res.setHeader('Retry-After', '5');
    } else {
      // Unknown/unexpected error — log the stack, never leak internals to the client.
      this.logger.error(exception);
      type = ERROR_TYPE_BY_STATUS[status] ?? type;
    }

    const envelope: ApiErrorEnvelope = {
      error: {
        message: Array.isArray(message) || typeof message === 'object' ? message : String(message),
        code: status,
        type,
        ...(fields ? { fields } : {}),
      },
    };

    res.status(status).json(envelope);
  }
}
