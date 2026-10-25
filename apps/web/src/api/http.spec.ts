import { ERROR_MESSAGES } from '@doc-signing/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { he } from '../i18n/he';
import { apiErrorResponse, jsonResponse } from '../test/fetch-stub';
import { ApiRequestError } from './api-error';
import { request } from './http';

function stubFetch(answer: () => Response | Promise<Response>) {
  const mock = vi.fn<typeof fetch>(() => Promise.resolve(answer()));
  vi.stubGlobal('fetch', mock);
  return mock;
}

async function failure(promise: Promise<unknown>): Promise<ApiRequestError> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiRequestError);
  return error as ApiRequestError;
}

const nameSchema = z.object({ name: z.string() });

describe('request', () => {
  it('returns the checked JSON answer', async () => {
    stubFetch(() => jsonResponse(200, { name: 'דנה' }));
    await expect(request('/api/x', { schema: nameSchema })).resolves.toEqual({ name: 'דנה' });
  });

  it('sends the cookie only the browser way: same-origin, no Authorization header', async () => {
    const mock = stubFetch(() => jsonResponse(200, { name: 'a' }));
    await request('/api/x', { schema: nameSchema, method: 'POST', body: { a: 1 } });

    const init = mock.mock.calls[0]?.[1];
    expect(init?.credentials).toBe('same-origin');
    expect(init?.body).toBe('{"a":1}');
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
  });

  it('reads an empty 204 answer as undefined', async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    await expect(
      request('/api/x', { schema: z.undefined(), method: 'POST' }),
    ).resolves.toBeUndefined();
  });

  it('turns our error format into kind "api" with our own Hebrew text', async () => {
    stubFetch(() => apiErrorResponse(401, 'INVALID_CREDENTIALS'));
    const error = await failure(request('/api/x', { schema: nameSchema }));

    expect(error).toMatchObject({ kind: 'api', status: 401, code: 'INVALID_CREDENTIALS' });
    expect(error.message).toBe(ERROR_MESSAGES.INVALID_CREDENTIALS);
  });

  it('reads Retry-After on a 429', async () => {
    stubFetch(() => apiErrorResponse(429, 'TOO_MANY_REQUESTS', { 'Retry-After': '120' }));
    const error = await failure(request('/api/x', { schema: nameSchema }));
    expect(error.retryAfterSeconds).toBe(120);
  });

  it('keeps the reference id of a server error', async () => {
    stubFetch(() =>
      jsonResponse(500, {
        error: { code: 'INTERNAL_ERROR', message: 'x', details: { referenceId: 'ab12cd34' } },
      }),
    );
    const error = await failure(request('/api/x', { schema: nameSchema }));
    expect(error.referenceId).toBe('ab12cd34');
  });

  it('treats an HTML page (e.g. a filter block, 418) as "unexpected"', async () => {
    stubFetch(
      () =>
        new Response('<html>badwords</html>', {
          status: 418,
          headers: { 'Content-Type': 'text/html' },
        }),
    );
    const error = await failure(request('/api/x', { schema: nameSchema }));

    expect(error).toMatchObject({ kind: 'unexpected', status: 418, code: null });
    expect(error.message).toBe(he.feedback.unexpectedText);
  });

  it('treats a 200 answer of the wrong shape as "unexpected"', async () => {
    stubFetch(() => jsonResponse(200, { other: 1 }));
    const error = await failure(request('/api/x', { schema: nameSchema }));
    expect(error.kind).toBe('unexpected');
  });

  it('turns a failed fetch into kind "network"', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const error = await failure(request('/api/x', { schema: nameSchema }));

    expect(error).toMatchObject({ kind: 'network', status: null });
    expect(error.message).toBe(he.feedback.networkText);
  });
});
