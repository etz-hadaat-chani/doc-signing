import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { securityHeadersMiddleware, storageOriginOf, webCsp } from './security-headers';

describe('webCsp', () => {
  it('the built app: scripts, fonts, workers only from our own host; images also from storage', () => {
    expect(webCsp({ dev: false, storageOrigin: 'http://localhost:9000' }).split('; ')).toEqual([
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: http://localhost:9000",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self'",
      "frame-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ]);
  });

  it('the dev server only adds inline scripts (React fast refresh); no storage origin → none', () => {
    const csp = webCsp({ dev: true, storageOrigin: null });
    expect(csp).toContain("script-src 'self' 'unsafe-inline';");
    expect(csp).toContain("img-src 'self' data: blob:;");
    expect(csp).not.toMatch(/https?:/);
  });
});

describe('storageOriginOf', () => {
  it('keeps only the origin; unset or broken gives null', () => {
    expect(storageOriginOf('http://localhost:9000/some/path')).toBe('http://localhost:9000');
    expect(storageOriginOf('https://s3.il-central-1.amazonaws.com')).toBe(
      'https://s3.il-central-1.amazonaws.com',
    );
    expect(storageOriginOf(undefined)).toBeNull();
    expect(storageOriginOf('not a url')).toBeNull();
  });
});

/** A fake answer that records its headers; `writeHead` like Node's, which the page path wraps. */
function fakeResponse() {
  const headers = new Map<string, string>();
  const response = {
    setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value),
    writeHead: vi.fn(() => response),
  };
  return { headers, response: response as unknown as ServerResponse };
}

function run(url: string, accept: string) {
  const { headers, response } = fakeResponse();
  const next = vi.fn();
  securityHeadersMiddleware('CSP')({ url, headers: { accept } } as IncomingMessage, response, next);
  return { headers, response, next };
}

describe('securityHeadersMiddleware', () => {
  it('a page (/kiosk, /sign/…): the headers, and no-store set when it is written', () => {
    for (const url of ['/kiosk?done', '/sign/abc', '/']) {
      const { headers, response, next } = run(url, 'text/html,application/xhtml+xml');
      expect(next).toHaveBeenCalledOnce();
      expect(headers.get('content-security-policy')).toBe('CSP');
      expect(headers.get('x-content-type-options')).toBe('nosniff');
      expect(headers.get('x-frame-options')).toBe('DENY');
      expect(headers.get('referrer-policy')).toBe('no-referrer');
      // Vite sets its own Cache-Control first; ours goes on at write time and wins.
      headers.set('cache-control', 'no-cache');
      response.writeHead(200);
      expect(headers.get('cache-control')).toBe('no-store');
    }
  });

  it('a script or style file: the headers, its cache left alone', () => {
    const { headers, response } = run('/src/main.tsx', '*/*');
    expect(headers.get('content-security-policy')).toBe('CSP');
    response.writeHead(200);
    expect(headers.has('cache-control')).toBe(false);
  });

  it('the API (proxied) keeps its own headers', () => {
    const { headers, next } = run('/api/rounds', 'application/json');
    expect(next).toHaveBeenCalledOnce();
    expect(headers.size).toBe(0);
  });
});
