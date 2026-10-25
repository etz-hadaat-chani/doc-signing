import { vi } from 'vitest';

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** An error answer in the API's format, with its real Hebrew message left to the app. */
export function apiErrorResponse(
  status: number,
  code: string,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(status, { error: { code, message: 'x' } }, headers);
}

type Handler = (init: RequestInit) => Response | Promise<Response>;

/**
 * Replaces fetch with a route table: keys are "METHOD /api/path". Any other call answers 404
 * in the API's format. Returns the mock, so tests can check the calls.
 */
export function stubApi(routes: Record<string, Handler>) {
  const mock = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const handler = routes[`${init.method ?? 'GET'} ${url}`];
    return Promise.resolve(handler ? handler(init) : apiErrorResponse(404, 'NOT_FOUND'));
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
