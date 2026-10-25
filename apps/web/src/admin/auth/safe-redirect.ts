/** Where RequireAuth keeps the page the user wanted (router state, never the URL). */
export interface LoginRedirectState {
  from?: unknown;
}

/**
 * The remembered page, only if it is a page of the management area: a path on this site (not
 * `//other.site` or a full URL), and not the login or signing pages. Anything else → `/`.
 */
export function safeRedirectPath(from: unknown): string {
  if (typeof from !== 'string') return '/';
  if (!from.startsWith('/') || from.startsWith('//') || from.includes('\\')) return '/';
  const path = from.split(/[?#]/)[0] ?? '';
  if (path === '/login' || path.startsWith('/login/') || path.startsWith('/sign/')) return '/';
  return from;
}
