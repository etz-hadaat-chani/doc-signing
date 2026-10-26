import { type AuthUser, authUserSchema, type LoginInput } from '@doc-signing/shared';
import { z } from 'zod';
import { isApiRequestError } from '../../api/api-error';
import { request, requestBytes, type RequestOptions } from '../../api/http';

/** Every staff query key starts with 'staff', so a logout or an expired session clears them all. */
export const staffKeys = {
  all: ['staff'] as const,
  me: ['staff', 'me'] as const,
};

export type StaffAccessEvent = 'unauthorized' | 'forbidden';
type Listener = (event: StaffAccessEvent) => void;

const listeners = new Set<Listener>();

/** Called on every 401 (session gone) and 403 (role changed?) of a staff request. */
export function onStaffAccessEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * request() for the management screens: a 401 or 403 is also reported to the session, which
 * sends the user to the login page or re-checks the role. Phase 5 calls go through here.
 */
export async function staffRequest<T>(
  path: `/api/${string}`,
  options: RequestOptions<T>,
): Promise<T> {
  return reportAccess(() => request(path, options));
}

/** requestBytes() (a PDF) for the management screens, with the same 401 / 403 reporting. */
export function staffRequestBytes(
  path: `/api/${string}`,
  options: { signal?: AbortSignal } = {},
): Promise<ArrayBuffer> {
  return reportAccess(() => requestBytes(path, options));
}

async function reportAccess<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (isApiRequestError(error) && (error.status === 401 || error.status === 403)) {
      const event = error.status === 401 ? 'unauthorized' : 'forbidden';
      listeners.forEach((listener) => listener(event));
    }
    throw error;
  }
}

/** The signed-in user, or null when nobody is (a 401 here is an answer, not an error). */
export async function fetchCurrentUser(signal?: AbortSignal): Promise<AuthUser | null> {
  try {
    return await request('/api/auth/me', { schema: authUserSchema, signal });
  } catch (error) {
    if (isApiRequestError(error) && error.status === 401) return null;
    throw error;
  }
}

/** A wrong password is a 401 too, so login uses the plain request(). */
export function login(input: LoginInput): Promise<AuthUser> {
  return request('/api/auth/login', { method: 'POST', body: input, schema: authUserSchema });
}

export function logout(): Promise<undefined> {
  return request('/api/auth/logout', { method: 'POST', schema: z.undefined() });
}
