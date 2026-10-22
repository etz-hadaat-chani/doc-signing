import { randomBytes } from 'node:crypto';
import {
  type ApiError,
  type ErrorCode,
  errorMessage,
  type FieldError,
  isErrorCode,
} from '@doc-signing/shared';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';
import { AppException, RequestValidationException } from './app.exception.js';
import { redactForLog } from './redact.js';

interface Mapped {
  status: number;
  code: ErrorCode;
  details?: Record<string, unknown>;
}

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  423: 'LOCKED',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
};

function fromStatus(status: number): Mapped {
  const code = CODE_BY_STATUS[status] ?? (status < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR');
  return { status, code };
}

/** body-parser errors (malformed JSON, body too large) carry a 4xx `status` and `expose`. */
function clientErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const { status, expose } = exception as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true
    ? status
    : undefined;
}

function fieldErrors(error: RequestValidationException): FieldError[] {
  return error.zodError.issues.map(({ path, message }) => {
    const code: ErrorCode = isErrorCode(message) ? message : 'INVALID_VALUE';
    return { field: path.map(String).join('.'), code, message: errorMessage(code) };
  });
}

function map(exception: unknown): Mapped | undefined {
  if (exception instanceof AppException) {
    return { status: exception.getStatus(), code: exception.code, details: exception.details };
  }
  if (exception instanceof RequestValidationException) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_FAILED',
      details: { fields: fieldErrors(exception) },
    };
  }
  if (exception instanceof HttpException) return fromStatus(exception.getStatus());

  const clientStatus = clientErrorStatus(exception);
  if (clientStatus !== undefined) return fromStatus(clientStatus);

  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      // With the pg adapter Prisma names only the index, not the fields. A service that must
      // say which field clashed checks first and throws its own AppException.
      case 'P2002':
        return { status: HttpStatus.CONFLICT, code: 'CONFLICT' };
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND' };
      case 'P2003':
        return { status: HttpStatus.CONFLICT, code: 'RELATED_RECORD_CONFLICT' };
    }
  }
  return undefined;
}

/**
 * Turns every error into `{ error: { code, message, details? } }` with a Hebrew message.
 * Unexpected errors become 500 with a reference id; the stack goes only to the server log,
 * keyed by that id, with ID numbers, tokens and passwords redacted. Request bodies and headers
 * are never logged.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    let mapped = map(exception);
    if (!mapped || mapped.status >= 500) {
      const referenceId = randomBytes(4).toString('hex');
      mapped = {
        status: mapped?.status ?? HttpStatus.INTERNAL_SERVER_ERROR,
        code: mapped?.code ?? 'INTERNAL_ERROR',
        details: { referenceId },
      };
      this.logServerError(referenceId, request, exception);
    }

    const body: ApiError = {
      error: {
        code: mapped.code,
        message: errorMessage(mapped.code),
        ...(mapped.details && { details: mapped.details }),
      },
    };
    const retryAfter = mapped.details?.retryAfter;
    if (mapped.status === 429 && typeof retryAfter === 'number') {
      response.setHeader('Retry-After', String(retryAfter));
    }
    response.status(mapped.status).json(body);
  }

  private logServerError(referenceId: string, request: Request, exception: unknown): void {
    // Only name, message and stack: the raw object (pg `detail`, Prisma `meta`) can hold values.
    // The route's pattern when it matched (`/api/sign/:token/submit`): never the link token or
    // an id. Else the path without its query string: `?q=` can hold a name or an ID number typed
    // without its leading zero, which redactForLog would not catch. redactForLog stays as a net.
    const pattern = (request.route as { path?: unknown } | undefined)?.path;
    const path =
      typeof pattern === 'string'
        ? `${request.baseUrl}${pattern}`
        : (request.originalUrl.split('?')[0] ?? '');
    const description =
      exception instanceof Error
        ? (exception.stack ?? `${exception.name}: ${exception.message}`)
        : `Non-error thrown: ${typeof exception}`;
    this.logger.error(
      redactForLog(`[ref ${referenceId}] ${request.method} ${path}\n${description}`),
    );
  }
}
