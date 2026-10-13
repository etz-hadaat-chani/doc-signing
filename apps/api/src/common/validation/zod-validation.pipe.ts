import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { RequestValidationException } from '../errors/app.exception.js';

/**
 * Validates request input with a shared zod schema and returns the parsed value (so transforms,
 * e.g. normalizeIdNumber, apply). Failure → 400 VALIDATION_FAILED with the field names.
 * Usage: `@Body(new ZodValidationPipe(loginSchema)) body: LoginInput`.
 */
@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) throw new RequestValidationException(result.error);
    return result.data;
  }
}
