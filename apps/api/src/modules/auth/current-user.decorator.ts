import type { AuthUser } from '@doc-signing/shared';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthRequest } from './session.guard.js';

/**
 * The signed-in staff user, in a route behind the session check:
 * `me(@CurrentUser() user: AuthUser)`. Throws if used on a route without it (a server bug).
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const auth = context.switchToHttp().getRequest<AuthRequest>().auth;
  if (!auth) throw new Error('CurrentUser used on a route without a session check');
  return auth.user satisfies AuthUser;
});
