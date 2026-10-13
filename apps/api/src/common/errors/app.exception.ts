import { type ErrorCode, errorMessage } from '@doc-signing/shared';
import { HttpException, type HttpStatus } from '@nestjs/common';
import type { ZodError } from 'zod';

/**
 * An expected error with a stable code; the filter sends it with the code's Hebrew message.
 * Example: `throw new AppException('LOCKED', HttpStatus.LOCKED)`.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: HttpStatus,
    readonly details?: Record<string, unknown>,
  ) {
    super(errorMessage(code), status);
  }
}

/**
 * Request input failed a zod schema (thrown by ZodValidationPipe) → 400. A ZodError thrown
 * anywhere else is a server bug and becomes a 500.
 */
export class RequestValidationException extends Error {
  constructor(readonly zodError: ZodError) {
    super('Request validation failed');
    this.name = 'RequestValidationException';
  }
}
