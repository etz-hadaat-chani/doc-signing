import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './safe-redirect';

describe('safeRedirectPath', () => {
  it.each(['/', '/rounds/1', '/employees?page=2', '/templates#top'])('keeps %s', (path) => {
    expect(safeRedirectPath(path)).toBe(path);
  });

  it.each([
    undefined,
    null,
    42,
    '',
    'rounds',
    '//evil.example',
    '/\\evil.example',
    'https://evil.example/',
    'javascript:alert(1)',
    '/login',
    '/login?x=1',
    '/sign/abc',
  ])('refuses %s', (value) => {
    expect(safeRedirectPath(value)).toBe('/');
  });
});
