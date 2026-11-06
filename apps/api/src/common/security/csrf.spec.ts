import { describe, expect, it } from 'vitest';
import { isCsrfAllowed } from './csrf.js';

const APP = 'http://localhost:5173';
const allowed = (method: string, fetchSite?: string, origin?: string) =>
  isCsrfAllowed({ method, fetchSite, origin }, APP);

describe('isCsrfAllowed', () => {
  it('reads always pass, from anywhere', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(allowed(method, 'cross-site', 'https://other.example')).toBe(true);
    }
  });

  it('a change with Sec-Fetch-Site passes only from our own origin', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(allowed(method, 'same-origin')).toBe(true);
      expect(allowed(method, 'same-site')).toBe(false);
      expect(allowed(method, 'cross-site')).toBe(false);
      expect(allowed(method, 'none')).toBe(false);
    }
    // Sec-Fetch-Site decides when both are sent (e.g. the Swagger page on the API's own port).
    expect(allowed('POST', 'same-origin', 'http://localhost:3000')).toBe(true);
    expect(allowed('POST', 'cross-site', APP)).toBe(false);
  });

  it('without Sec-Fetch-Site, the Origin must be exactly the app', () => {
    expect(allowed('POST', undefined, APP)).toBe(true);
    for (const origin of [
      'null',
      'http://localhost:5174',
      'https://localhost:5173',
      'http://evil.localhost:5173',
      'http://localhost',
      'http://localhost:5173.evil.example',
      '',
    ]) {
      expect(allowed('POST', undefined, origin)).toBe(false);
    }
  });

  it('neither header (not a browser page): passes', () => {
    expect(allowed('POST')).toBe(true);
  });
});
