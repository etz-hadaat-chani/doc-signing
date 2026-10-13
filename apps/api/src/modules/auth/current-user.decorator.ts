import type { AuthUser } from '@doc-signing/shared';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthRequest } from './auth-request.js';

/**
 * The signed-in staff user, on a @Roles route (AccessGuard sets it):
 * `me(@CurrentUser() user: AuthUser)`. Throws if used on a route without a session (a server bug).
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const auth = context.switchToHttp().getRequest<AuthRequest>().auth;
  if (!auth) throw new Error('CurrentUser used on a route without a session check');
  return auth.user satisfies AuthUser;
});
