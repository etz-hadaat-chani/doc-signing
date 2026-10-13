import { randomUUID } from 'node:crypto';
import { type ErrorCode, errorMessage, idNumberSchema } from '@doc-signing/shared';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpStatus,
  type INestApplication,
  Logger,
  Post,
} from '@nestjs/common';
import request, { type Response } from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppException } from '../../src/common/errors/app.exception.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { ZodValidationPipe } from '../../src/common/validation/zod-validation.pipe.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';

const bodySchema = z.object({ idNumber: idNumberSchema, name: z.string().min(1) });

/** Test-only routes, one per kind of error. */
@Controller('test-errors')
class ErrorsTestController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException('English text that must not reach the client');
  }

  @Get('locked')
  locked(): never {
    throw new AppException('LOCKED', HttpStatus.LOCKED);
  }

  @Post('validate')
  validate(@Body(new ZodValidationPipe(bodySchema)) body: z.output<typeof bodySchema>) {
    return body;
  }

  @Post('json')
  json(@Body() body: unknown) {
    return body;
  }

  @Post('unique')
  async unique(): Promise<void> {
    await this.prisma.department.create({ data: { code: 15, name: 'א' } });
    await this.prisma.department.create({ data: { code: 15, name: 'ב' } });
  }

  @Post('not-found')
  async notFound(): Promise<void> {
    await this.prisma.department.update({ where: { id: randomUUID() }, data: { name: 'x' } });
  }

  @Post('foreign-key')
  async foreignKey(): Promise<void> {
    await this.prisma.employee.create({
      data: {
        employeeNumber: '1001',
        idNumber: '000000018',
        firstName: 'ישראל',
        lastName: 'ישראלי',
        departmentId: randomUUID(),
        emailStatus: 'missing',
      },
    });
  }

  @Get('crash')
  crash(): never {
    throw new Error('SELECT * FROM employees WHERE id_number = 123456782');
  }
}

let app: INestApplication;
let prisma: PrismaService;
const loggedErrors: string[] = [];

beforeAll(async () => {
  app = await createTestApp({ controllers: [ErrorsTestController] });
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  await resetDatabase(prisma);
  loggedErrors.length = 0;
  vi.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
    loggedErrors.push(String(message));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await app.close();
});

/** Status, the standard shape, and the Hebrew message for the code. */
function expectError(response: Response, status: number, code: ErrorCode): void {
  expect(response.status).toBe(status);
  expect(Object.keys(response.body as object)).toEqual(['error']);
  const { error } = response.body as { error: Record<string, unknown> };
  expect(error.code).toBe(code);
  expect(error.message).toBe(errorMessage(code));
  expect(Object.keys(error).every((key) => ['code', 'message', 'details'].includes(key))).toBe(
    true,
  );
}

describe('error format', () => {
  it('Nest HTTP error keeps its status, without its English text', async () => {
    const response = await request(httpServer(app)).get('/api/test-errors/forbidden');
    expectError(response, 403, 'FORBIDDEN');
    expect(response.text).not.toContain('English');
  });

  it('AppException sends its own code', async () => {
    expectError(await request(httpServer(app)).get('/api/test-errors/locked'), 423, 'LOCKED');
  });

  it('unknown route → 404', async () => {
    expectError(await request(httpServer(app)).get('/api/no-such-route'), 404, 'NOT_FOUND');
  });

  it('malformed JSON → 400', async () => {
    const response = await request(httpServer(app))
      .post('/api/test-errors/json')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expectError(response, 400, 'BAD_REQUEST');
  });

  it('zod validation → 400 with field names, never the values sent', async () => {
    const response = await request(httpServer(app))
      .post('/api/test-errors/validate')
      .send({ idNumber: '123456789', name: '' });
    expectError(response, 400, 'VALIDATION_FAILED');
    expect((response.body as { error: { details: unknown } }).error.details).toEqual({
      fields: [
        {
          field: 'idNumber',
          code: 'INVALID_ID_NUMBER',
          message: errorMessage('INVALID_ID_NUMBER'),
        },
        { field: 'name', code: 'INVALID_VALUE', message: errorMessage('INVALID_VALUE') },
      ],
    });
    expect(response.text).not.toContain('123456789');
  });

  it('zod validation passes the parsed value on', async () => {
    const response = await request(httpServer(app))
      .post('/api/test-errors/validate')
      .send({ idNumber: 18, name: 'דנה' });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ idNumber: '000000018', name: 'דנה' });
  });

  it('Prisma unique violation (P2002) → 409', async () => {
    const response = await request(httpServer(app)).post('/api/test-errors/unique');
    expectError(response, 409, 'CONFLICT');
    expect(response.text).not.toMatch(/departments_code_key|duplicate key/);
  });

  it('Prisma record not found (P2025) → 404', async () => {
    expectError(
      await request(httpServer(app)).post('/api/test-errors/not-found'),
      404,
      'NOT_FOUND',
    );
  });

  it('Prisma foreign key (P2003) → 409', async () => {
    const response = await request(httpServer(app)).post('/api/test-errors/foreign-key');
    expectError(response, 409, 'RELATED_RECORD_CONFLICT');
  });

  it('anything else → 500 with a reference id, no stack or SQL; logged with redaction', async () => {
    const response = await request(httpServer(app)).get('/api/test-errors/crash');
    expectError(response, 500, 'INTERNAL_ERROR');

    const { details } = (response.body as { error: { details: { referenceId: string } } }).error;
    expect(Object.keys(details)).toEqual(['referenceId']);
    expect(details.referenceId).toMatch(/^[0-9a-f]{8}$/);
    for (const leak of ['stack', 'SELECT', '123456782', ' at ', '.ts']) {
      expect(response.text).not.toContain(leak);
    }

    expect(loggedErrors).toHaveLength(1);
    const [logged = ''] = loggedErrors;
    expect(logged).toContain(`[ref ${details.referenceId}]`);
    expect(logged).toContain('GET /api/test-errors/crash');
    expect(logged).toContain('SELECT * FROM employees');
    expect(logged).toMatch(/\n\s+at /); // the stack is in the log
    expect(logged).not.toContain('123456782');
  });

  it('4xx errors are not logged', async () => {
    await request(httpServer(app)).get('/api/test-errors/forbidden');
    expect(loggedErrors).toEqual([]);
  });
});
