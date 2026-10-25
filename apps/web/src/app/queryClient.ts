import { QueryClient } from '@tanstack/react-query';
import { isApiRequestError } from '../api/api-error';

/** At most 2 more tries, only when retrying can help: no answer, or a server error (5xx). */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiRequestError(error) && error.status !== null && error.status < 500) return false;
  return failureCount < 2;
}

/**
 * One per app area (staff, signing). No polling by default: every request extends the staff
 * session's 30-minute idle timer, so polling would keep a forgotten session open.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry },
      mutations: { retry: false },
    },
  });
}
