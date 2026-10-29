/**
 * The web app has two separate areas, each its own bundle, router and data cache:
 * - signing (`/sign/...` and the office computer's `/kiosk`, employees, phase 6): never loads
 *   staff code or uses the staff session;
 * - staff (everything else): login and the management screens.
 * This runs before either bundle loads, so it imports nothing (the kiosk path is
 * `KIOSK_PAGE_PATH` of the shared package; sign-routes.spec checks they agree).
 */
export function isSigningPath(pathname: string): boolean {
  if (pathname === '/kiosk') return true;
  return pathname === '/sign' || pathname.startsWith('/sign/');
}
