import type { AuthUser } from '@doc-signing/shared';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { Public, Roles } from '../../src/modules/auth/access.decorators.js';
import { CurrentUser } from '../../src/modules/auth/current-user.decorator.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';

const password = 'test-seed-password';
const managerEmail = 'manager@doc-signing.local';
const officerEmail = 'officer@doc-signing.local';

/** Test-only routes. The class needs a manager; methods may replace that. */
@Roles('manager')
@Controller('test-access')
class ManagerTestController {
  @Get('manager')
  manager(): { ok: true } {
    return { ok: true };
  }

  @Roles('manager', 'officer')
  @Get('shared')
  shared(@CurrentUser() user: AuthUser): { email: string } {
    return { email: user.email };
  }

  @Public()
  @Get('open')
  open(): { ok: true } {
    return { ok: true };
  }
}

@Public()
@Controller('test-access-public')
class PublicTestController {
  @Get('open')
  open(): { ok: true } {
    return { ok: true };
  }

  @Roles('manager')
  @Get('staff')
  staff(): { ok: true } {
    return { ok: true };
  }
}

/** Forgot its decorator: refused for everyone. */
@Controller('test-access-bare')
class BareTestController {
  @Get('bare')
  bare(): { ok: true } {
    return { ok: true };
  }
}

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp({
    controllers: [ManagerTestController, PublicTestController, BareTestController],
  });
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  await resetDatabase(prisma);
  await runSeed(prisma, { password });
});

afterAll(async () => {
  await app.close();
});

async function loginAs(email: string): Promise<string> {
  const response = await request(httpServer(app)).post('/api/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  const lines = response.headers['set-cookie'] as unknown as string[];
  return lines.find((line) => line.startsWith('sid='))?.split(';')[0] ?? '';
}

function call(path: string, cookie?: string) {
  const req = request(httpServer(app)).get(`/api${path}`);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

describe('global access guard', () => {
  it('gives an officer 403 on a manager-only route', async () => {
    const response = await call('/test-access/manager', await loginAs(officerEmail));
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('gives a signed-out user 401 and clears the cookie', async () => {
    for (const cookie of [undefined, 'sid=garbage']) {
      const response = await call('/test-access/manager', cookie);
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    }
    const withCookie = await call('/test-access/manager', 'sid=garbage');
    expect(String(withCookie.headers['set-cookie'])).toMatch(/^sid=;/);
  });

  it('lets a manager through on a manager route', async () => {
    const response = await call('/test-access/manager', await loginAs(managerEmail));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('lets both roles through on a shared route, with @CurrentUser', async () => {
    for (const email of [managerEmail, officerEmail]) {
      const response = await call('/test-access/shared', await loginAs(email));
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ email });
    }
  });

  it('refuses a route with no decorator with 403, even for a manager or signed out', async () => {
    for (const cookie of [await loginAs(managerEmail), undefined]) {
      const response = await call('/test-access-bare/bare', cookie);
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    }
  });

  it('allows @Public routes without a cookie', async () => {
    expect((await call('/test-access-public/open')).status).toBe(200);
    expect((await call('/health')).status).toBe(200);
  });

  it('lets a method decorator replace the class one', async () => {
    // Class @Roles('manager'), method @Public.
    expect((await call('/test-access/open')).status).toBe(200);
    // Class @Public, method @Roles('manager').
    expect((await call('/test-access-public/staff')).status).toBe(401);
    expect((await call('/test-access-public/staff', await loginAs(officerEmail))).status).toBe(403);
    expect((await call('/test-access-public/staff', await loginAs(managerEmail))).status).toBe(200);
  });

  it('still answers 404 for unknown routes', async () => {
    const response = await call('/no-such-route');
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
