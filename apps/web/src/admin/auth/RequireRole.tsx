import type { UserRole } from '@doc-signing/shared';
import type { ReactNode } from 'react';
import { NoPermissionPage } from '../pages/NoPermissionPage';
import { useAuthUser } from './session';

/**
 * A page for some roles only: anyone else sees "no permission" (e.g. a typed address). This is
 * only for a clear screen; the API refuses the data itself (403).
 */
export function RequireRole({
  roles,
  children,
}: {
  roles: readonly UserRole[];
  children: ReactNode;
}) {
  const user = useAuthUser();
  return roles.includes(user.role) ? children : <NoPermissionPage />;
}
