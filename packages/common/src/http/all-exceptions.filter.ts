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
};

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
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] | Record<string, unknown> = 'Internal server error';
    let type = (exception as { constructor?: { name?: string } })?.constructor?.name ?? 'Error';

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
      }
      // Default the type to the canonical name for this status, unless pinned above.
      if (type === exception.constructor.name || type === 'Error') {
        type = ERROR_TYPE_BY_STATUS[status] ?? exception.constructor.name;
      }
    } else if (isPrismaKnownRequestError(exception) && PRISMA_ERROR_STATUS[exception.code]) {
      const mapped = PRISMA_ERROR_STATUS[exception.code];
      status = mapped.status;
      message = mapped.message;
      type = ERROR_TYPE_BY_STATUS[status] ?? 'ValidationError';
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
      },
    };

    res.status(status).json(envelope);
  }
}
