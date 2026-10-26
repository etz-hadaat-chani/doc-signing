import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import {
  type AccessMetadata,
  readAccessMetadata,
  resolveAccess,
} from '../../src/modules/auth/access.decorators.js';

interface Route {
  name: string;
  method: AccessMetadata;
  controller: AccessMetadata;
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
      const path = `${String(get(PATH_METADATA, controller))}/${String(get(PATH_METADATA, handler))}`;
      routes.push({
        name: `${controller.name}.${methodName} (${RequestMethod[verb]} /${path.replace(/\/+$/, '')})`,
        method: readAccessMetadata(get, handler),
        controller: readAccessMetadata(get, controller),
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
  });

  it('public routes are only health, login, the employee signing routes (3.13) and the email webhook (3.15)', () => {
    const open = routes
      .filter(({ method, controller }) => resolveAccess(method, controller).kind === 'public')
      .map(({ name }) => name)
      .sort();
    expect(open).toEqual([
      'AuthController.login (POST /auth/login)',
      'HealthController.check (GET /health)',
      'SigningController.document (GET /sign/:token/document)',
      'SigningController.fit (POST /sign/:token/fit)',
      'SigningController.form (GET /sign/:token/form)',
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
