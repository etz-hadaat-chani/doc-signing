import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppModule } from '../../src/app.module.js';
import {
  type AccessMetadata,
  readAccessMetadata,
  resolveAccess,
} from '../../src/modules/auth/access.decorators.js';
import { ZodValidationPipe } from '../../src/common/validation/zod-validation.pipe.js';

interface Route {
  name: string;
  verb: string;
  /** With the leading slash, without `/api` (e.g. `/sign/:token/verify`). */
  path: string;
  method: AccessMetadata;
  controller: AccessMetadata;
  /** Every `@Query()` argument: its pipes. */
  queries: unknown[][];
}

const get = (key: string, target: object): unknown => Reflect.getMetadata(key, target) as unknown;

/** Every route handler of the real AppModule, with its access metadata. */
async function listRoutes(): Promise<{ routes: Route[]; close: () => Promise<void> }> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, DiscoveryModule],
  }).compile();
  const scanner = moduleRef.get(MetadataScanner);
  const routes: Route[] = [];
  for (const wrapper of moduleRef.get(DiscoveryService).getControllers()) {
    const controller = wrapper.metatype as Type | null;
    if (!controller) continue;
    const prototype = controller.prototype as Record<string, unknown>;
    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[methodName];
      if (typeof handler !== 'function') continue;
      const verb = get(METHOD_METADATA, handler);
      if (typeof verb !== 'number') continue;
      const joined = `${String(get(PATH_METADATA, controller))}/${String(get(PATH_METADATA, handler))}`;
      const path = `/${joined.replace(/\/+$/, '')}`;
      const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, methodName) ??
        {}) as Record<string, { pipes?: unknown[] }>;
      const queries = Object.entries(args)
        .filter(([key]) => key.split(':')[0] === String(RouteParamtypes.QUERY))
        .map(([, arg]) => arg.pipes ?? []);
      routes.push({
        name: `${controller.name}.${methodName} (${RequestMethod[verb]} ${path})`,
        verb: RequestMethod[verb] ?? String(verb),
        path,
        method: readAccessMetadata(get, handler),
        controller: readAccessMetadata(get, controller),
        queries,
      });
    }
  }
  return { routes, close: () => moduleRef.close() };
}

/** Why a route's access setup is wrong, or null when it is fine. */
function problem({ method, controller }: Route): string | null {
  for (const level of [method, controller]) {
    if (level.isPublic !== undefined && level.roles !== undefined) {
      return 'both @Public and @Roles on one level';
    }
    if (Array.isArray(level.roles) && level.roles.length === 0) return 'empty @Roles';
  }
  return resolveAccess(method, controller).kind === 'none' ? 'neither @Public nor @Roles' : null;
}

let routes: Route[];
let close: () => Promise<void>;

beforeAll(async () => {
  ({ routes, close } = await listRoutes());
});

afterAll(async () => {
  await close();
});

describe('every route declares who may call it', () => {
  it('finds the routes (the scan itself works)', () => {
    const names = routes.map(({ name }) => name);
    expect(names).toContain('HealthController.check (GET /health)');
    expect(names).toContain('AuthController.login (POST /auth/login)');
    expect(names).toContain('AuthController.me (GET /auth/me)');
    expect(names).toContain('UsersController.update (PATCH /users/:id)');
    expect(names).toContain('EmployeesController.update (PATCH /employees/:id)');
    expect(names).toContain('DepartmentsController.list (GET /departments)');
    expect(names).toContain('ImportController.preview (POST /employees/import/preview)');
    expect(names).toContain('ImportController.commit (POST /employees/import/:batchId/commit)');
    expect(names).toContain('AssignmentsController.unlock (POST /assignments/:id/unlock)');
    expect(names).toContain('RoundsController.cancel (POST /rounds/:id/cancel)');
    expect(names).toContain(
      'ManualAssignmentsController.manualSign (POST /assignments/:id/manual-sign)',
    );
    expect(names).toContain('ManualHandlingController.send (POST /manual-handling/send)');
    expect(names).toContain('ManualAssignmentsController.openKiosk (POST /assignments/:id/kiosk)');
    expect(names).toContain('ApprovalsController.list (GET /approvals)');
    expect(names).toContain(
      'ApprovalAssignmentsController.responses (GET /assignments/:id/responses)',
    );
    expect(names).toContain(
      'ApprovalAssignmentsController.approve (POST /assignments/:id/approve)',
    );
    expect(names).toContain(
      'ApprovalAssignmentsController.returnForCorrection (POST /assignments/:id/return)',
    );
    expect(names).toContain(
      'ApprovalAssignmentsController.sendAgain (POST /assignments/:id/send-again)',
    );
    expect(names).toContain('RoundFilesController.export (GET /rounds/:id/export)');
    expect(names).toContain('RoundFilesController.download (GET /rounds/:id/download)');
    expect(names).toContain(
      'AssignmentDocumentController.document (GET /assignments/:id/document)',
    );
  });

  it('public routes are only health, login, the employee signing routes (3.13), the office kiosk (3.16) and the email webhook (3.15)', () => {
    const open = routes
      .filter(({ method, controller }) => resolveAccess(method, controller).kind === 'public')
      .map(({ name }) => name)
      .sort();
    expect(open).toEqual([
      'AuthController.login (POST /auth/login)',
      'HealthController.check (GET /health)',
      'KioskSigningController.document (GET /kiosk/document)',
      'KioskSigningController.enterCode (POST /kiosk/code)',
      'KioskSigningController.fit (POST /kiosk/fit)',
      'KioskSigningController.form (GET /kiosk/form)',
      'KioskSigningController.preview (POST /kiosk/preview)',
      'KioskSigningController.state (POST /kiosk/state)',
      'KioskSigningController.submit (POST /kiosk/submit)',
      'KioskSigningController.verify (POST /kiosk/verify)',
      'SigningController.document (GET /sign/:token/document)',
      'SigningController.fit (POST /sign/:token/fit)',
      'SigningController.form (GET /sign/:token/form)',
      'SigningController.preview (POST /sign/:token/preview)',
      'SigningController.state (GET /sign/:token)',
      'SigningController.submit (POST /sign/:token/submit)',
      'SigningController.verify (POST /sign/:token/verify)',
      'WebhooksController.email (POST /webhooks/email)',
    ]);
  });

  it('has @Public or @Roles on every route', () => {
    const bad = routes.flatMap((route) => {
      const reason = problem(route);
      return reason ? [`${route.name}: ${reason}`] : [];
    });
    expect(bad).toEqual([]);
  });
});

/** The public routes by kind: health, login, the employee's link, the office kiosk, the webhook. */
const PUBLIC_PATH = /^\/(health|auth\/login|sign(\/.*)?|kiosk(\/.*)?|webhooks\/email)$/;

describe('public routes (7.2)', () => {
  it('only health, login, /sign/*, /kiosk/* and the email webhook are public', () => {
    const open = routes.filter(
      ({ method, controller }) => resolveAccess(method, controller).kind === 'public',
    );
    expect(open.filter(({ path }) => !PUBLIC_PATH.test(path)).map(({ name }) => name)).toEqual([]);
  });

  it('every /sign and /kiosk route is public (no staff route under them)', () => {
    const staff = routes.filter(
      ({ path, method, controller }) =>
        /^\/(sign|kiosk)(\/|$)/.test(path) && resolveAccess(method, controller).kind !== 'public',
    );
    expect(staff.map(({ name }) => name)).toEqual([]);
  });
});

/**
 * The officer is read-only (CLAUDE.md section 6): a route that is not GET and allows the officer
 * must be a read sent as POST (search text in the body, never the URL) or the officer's own
 * session.
 */
const OFFICER_NON_GET = [
  // Ends the officer's own session.
  'AuthController.logout (POST /auth/logout)',
  // Reads: the search text goes in the body, never in the URL.
  'EmployeesController.search (POST /employees/search)',
  'RoundsReadController.search (POST /rounds/:id/assignments/search)',
];

describe('roles (7.2)', () => {
  it('every staff route names only manager / officer', () => {
    const bad = routes.flatMap((route) => {
      const access = resolveAccess(route.method, route.controller);
      if (access.kind !== 'roles') return [];
      const unknown = access.roles.filter((role) => role !== 'manager' && role !== 'officer');
      return unknown.length > 0 ? [`${route.name}: ${unknown.join(', ')}`] : [];
    });
    expect(bad).toEqual([]);
  });

  it('the officer changes nothing: non-GET officer routes are only the listed reads', () => {
    const officerChanges = routes
      .filter((route) => {
        const access = resolveAccess(route.method, route.controller);
        return route.verb !== 'GET' && access.kind === 'roles' && access.roles.includes('officer');
      })
      .map(({ name }) => name)
      .sort();
    expect(officerChanges).toEqual([...OFFICER_NON_GET].sort());
  });
});

/**
 * Every query parameter any route accepts (3.11 / 7.2: search text, which may be an ID number,
 * never goes in a URL; it goes in a POST body). A new one is added here on purpose.
 */
const QUERY_KEYS = new Set([
  'page',
  'pageSize',
  'dept',
  'emailStatus',
  'active',
  'roundId',
  'kind',
  'includeArchived',
  'employeeId',
  'linkExpiryDays',
  'status',
  'approval',
  'returned',
]);

/** The zod schema a ZodValidationPipe checks with (a private field, read here only). */
function schemaOf(pipe: unknown): z.ZodType | undefined {
  if (!(pipe instanceof ZodValidationPipe)) return undefined;
  const schema: unknown = Reflect.get(pipe, 'schema');
  return schema instanceof z.ZodType ? schema : undefined;
}

/** The zod object schema among a query argument's pipes, if any. */
function objectSchemaOf(pipes: unknown[]): z.ZodObject | undefined {
  for (const pipe of pipes) {
    const schema = schemaOf(pipe);
    if (schema instanceof z.ZodObject) return schema;
  }
  return undefined;
}

describe('query strings (7.2): no search text in a URL', () => {
  const withQuery = () => routes.filter(({ queries }) => queries.length > 0);

  it('finds the routes that read a query string (the scan itself works)', () => {
    const names = withQuery().map(({ name }) => name);
    expect(names).toContain('EmployeesController.list (GET /employees)');
    expect(names).toContain('RoundFilesController.export (GET /rounds/:id/export)');
    expect(names.length).toBeGreaterThanOrEqual(13);
  });

  it('every @Query() is checked by a zod object schema', () => {
    const bad = withQuery().flatMap((route) =>
      route.queries.flatMap((pipes) => (objectSchemaOf(pipes) ? [] : [route.name])),
    );
    expect(bad).toEqual([]);
  });

  it('accepts only the listed parameters: no q, search or name', () => {
    const bad = withQuery().flatMap((route) =>
      route.queries.flatMap((pipes) =>
        Object.keys(objectSchemaOf(pipes)?.shape ?? {})
          .filter((key) => !QUERY_KEYS.has(key))
          .map((key) => `${route.name}: ${key}`),
      ),
    );
    expect(bad).toEqual([]);
  });

  it('GET /api/employees takes no search text (the last one, 3.2); POST /employees/search does', () => {
    const list = withQuery().find(
      ({ name }) => name === 'EmployeesController.list (GET /employees)',
    );
    const shape = objectSchemaOf(list?.queries[0] ?? [])?.shape ?? {};
    expect(Object.keys(shape)).not.toContain('q');
    expect(Object.keys(shape).length).toBeGreaterThan(0);
    expect(routes.map(({ name }) => name)).toContain(
      'EmployeesController.search (POST /employees/search)',
    );
  });
});
