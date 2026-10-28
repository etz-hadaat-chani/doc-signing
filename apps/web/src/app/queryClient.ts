import { focusManager, QueryClient } from '@tanstack/react-query';
import { isApiRequestError } from '../api/api-error';

/** At most 2 more tries, only when retrying can help: no answer, or a server error (5xx). */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiRequestError(error) && error.status !== null && error.status < 500) return false;
  return failureCount < 2;
}

/**
 * "Window focus" for `refetchOnWindowFocus`: the tab became visible again, or the window got the
 * focus back (TanStack Query listens to `visibilitychange` only, so coming back from another
 * window or DevTools, with the tab visible all along, counted as nothing). Queries whose fetch
 * writes an audit row set `refetchOnWindowFocus: false`.
 */
export function listenForWindowFocus(): void {
  focusManager.setEventListener((handleFocus) => {
    if (typeof window === 'undefined') return undefined;
    const onChange = () => handleFocus();
    window.addEventListener('visibilitychange', onChange, false);
    window.addEventListener('focus', onChange, false);
    return () => {
      window.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('focus', onChange);
    };
  });
}

/**
 * One per app area (staff, signing). No polling by default: every request extends the staff
 * session's 30-minute idle timer, so polling would keep a forgotten session open.
 */
export function createQueryClient(): QueryClient {
  listenForWindowFocus();
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry },
      mutations: { retry: false },
    },
  });
}
