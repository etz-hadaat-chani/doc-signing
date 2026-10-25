/**
 * The web app has two separate areas, each its own bundle, router and data cache:
 * - signing (`/sign/...`, employees, phase 6): never loads staff code or uses the staff session;
 * - staff (everything else): login and the management screens.
 */
export function isSigningPath(pathname: string): boolean {
  return pathname === '/sign' || pathname.startsWith('/sign/');
}
