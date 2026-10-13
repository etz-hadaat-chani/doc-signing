import type { UserRole } from '@doc-signing/shared';
import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'access:public';
export const ROLES_KEY = 'access:roles';

/**
 * No staff session needed (class or method). It means "no staff session", not "no checks":
 * later, /api/sign/* checks the link token, ID number and signing session, and
 * /api/webhooks/email checks the provider's signature.
 */
export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(PUBLIC_KEY, true);

/** A staff session with one of these roles is needed (class or method). */
export const Roles = (...roles: [UserRole, ...UserRole[]]): ClassDecorator & MethodDecorator =>
  SetMetadata(ROLES_KEY, roles);

export type Access =
  { kind: 'public' } | { kind: 'roles'; roles: readonly UserRole[] } | { kind: 'none' };

/** The access metadata on one target (a handler or a controller class); undefined = absent. */
export interface AccessMetadata {
  isPublic: unknown;
  roles: unknown;
}

/** Reads a target's access metadata with a getter such as `reflector.get`. */
export function readAccessMetadata(
  get: (key: string, target: object) => unknown,
  target: object,
): AccessMetadata {
  return { isPublic: get(PUBLIC_KEY, target), roles: get(ROLES_KEY, target) };
}

function atLevel({ isPublic, roles }: AccessMetadata): Access | undefined {
  // Both on one level is a bug (the route-access test fails on it); the stricter one wins.
  if (Array.isArray(roles)) return { kind: 'roles', roles: roles as UserRole[] };
  if (isPublic === true) return { kind: 'public' };
  return undefined;
}

/**
 * The access rule of a route. A decorator on the method replaces the class's as a whole
 * (class @Roles + method @Public = public). Neither anywhere → `none`, which the guard refuses.
 */
export function resolveAccess(method: AccessMetadata, controller: AccessMetadata): Access {
  return atLevel(method) ?? atLevel(controller) ?? { kind: 'none' };
}
