import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isSigningPath } from '../app/area';
import { he } from '../i18n/he';
import { stubApi } from '../test/fetch-stub';
import { renderRoutes } from '../test/render';
import { signRoutes } from './sign-routes';

describe('signing area', () => {
  it.each([
    ['/sign/abc', true],
    ['/sign', true],
    ['/signature', false],
    ['/', false],
    ['/login', false],
  ])('%s belongs to the signing area: %s', (pathname, expected) => {
    expect(isSigningPath(pathname)).toBe(expected);
  });

  it('never calls the staff session (no /api/auth/*)', async () => {
    const fetchMock = stubApi({});
    renderRoutes('/sign/abc', signRoutes);

    await screen.findByRole('heading', { level: 1, name: he.sign.placeholderTitle });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
