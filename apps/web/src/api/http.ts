import { apiErrorSchema } from '@doc-signing/shared';
import type { ZodType } from 'zod';
import { ApiRequestError } from './api-error';

export interface RequestOptions<T> {
  /** Checks the answer; a 204 / empty answer is checked as `undefined` (use `z.undefined()`). */
  schema: ZodType<T>;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Sent as JSON; a FormData (file upload) is sent as it is, as multipart. */
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * The one way the web app calls the API (staff and signing areas alike). The session is the
 * browser's httpOnly cookie, sent by the browser itself: no token is ever read or added here.
 * Every failure becomes an ApiRequestError. A later CSRF header (7.2) goes here, in one place.
 */
export async function request<T>(path: `/api/${string}`, options: RequestOptions<T>): Promise<T> {
  const { schema, method = 'GET', body, signal } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  const isForm = body instanceof FormData;
  // For a FormData the browser sets the multipart Content-Type with its boundary.
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined || isForm ? body : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiRequestError({ kind: 'network' });
  }

  const payload = await readJson(response);
  if (!response.ok) throw toError(response, payload);

  const parsed = schema.safeParse(payload.ok ? payload.value : undefined);
  if (!payload.ok || !parsed.success) {
    throw new ApiRequestError({ kind: 'unexpected', status: response.status });
  }
  return parsed.data;
}

/**
 * A file the API sends (a PDF), as bytes, with the same session and error handling as request():
 * a failure answered in our JSON format becomes the same ApiRequestError.
 */
export async function requestBytes(
  path: `/api/${string}`,
  options: { signal?: AbortSignal } = {},
): Promise<ArrayBuffer> {
  const { signal } = options;
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiRequestError({ kind: 'network' });
  }
  if (!response.ok) throw toError(response, await readJson(response));
  try {
    return await response.arrayBuffer();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiRequestError({ kind: 'network' });
  }
}

type JsonResult = { ok: true; value: unknown } | { ok: false };

/** An empty body reads as `undefined`; a body that isn't JSON is "not ours". */
async function readJson(response: Response): Promise<JsonResult> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ok: false };
  }
  if (text === '') return { ok: true, value: undefined };
  if (!response.headers.get('Content-Type')?.includes('application/json')) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function toError(response: Response, payload: JsonResult): ApiRequestError {
  const parsed = payload.ok ? apiErrorSchema.safeParse(payload.value) : null;
  if (!parsed?.success) {
    return new ApiRequestError({ kind: 'unexpected', status: response.status });
  }
  return new ApiRequestError({
    kind: 'api',
    status: response.status,
    code: parsed.data.error.code,
    details: parsed.data.error.details,
    retryAfterSeconds: retryAfter(response),
  });
}

function retryAfter(response: Response): number | undefined {
  const seconds = Number(response.headers.get('Retry-After'));
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined;
}
