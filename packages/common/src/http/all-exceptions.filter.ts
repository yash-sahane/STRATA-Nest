import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorEnvelope } from '@lt/shared';

/**
 * Maps HTTP status → the DRF exception class name Django emits in the `type`
 * field, so the error envelope's `type` matches Django for the common cases
 * (CURRENT_SYSTEM_AUDIT.md §4.5). 401 defaults to `NotAuthenticated`; endpoints
 * that mean `AuthenticationFailed`/`InvalidToken` set it explicitly.
 */
const DRF_TYPE_BY_STATUS: Record<number, string> = {
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
 * Global exception filter reproducing the FROZEN Django error envelope
 * (CURRENT_SYSTEM_AUDIT.md §4.5; ADR-0003):
 *
 *   { "error": { "message": <string|list|dict>, "code": <httpStatus>, "type": <DRFExceptionName> } }
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
        // Allow a caller to pin an exact DRF type via the exception payload.
        if (typeof b.type === 'string') type = b.type;
      }
      // Default the type to the DRF name for this status (parity), unless pinned above.
      if (type === exception.constructor.name || type === 'Error') {
        type = DRF_TYPE_BY_STATUS[status] ?? exception.constructor.name;
      }
    } else {
      // Unknown/unexpected error — log the stack, never leak internals to the client.
      this.logger.error(exception);
      type = DRF_TYPE_BY_STATUS[status] ?? type;
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
