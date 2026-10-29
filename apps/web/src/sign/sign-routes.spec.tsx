import { errorMessage, KIOSK_PAGE_PATH } from '@doc-signing/shared';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isSigningPath } from '../app/area';
import { he } from '../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../test/fetch-stub';
import { renderRoutes } from '../test/render';
import { signRoutes } from './sign-routes';

describe('signing area', () => {
  it.each([
    ['/sign/abc', true],
    ['/sign', true],
    ['/signature', false],
    ['/', false],
    ['/login', false],
    ['/kiosk', true],
    ['/kiosk/x', false],
    ['/kioskx', false],
  ])('%s belongs to the signing area: %s', (pathname, expected) => {
    expect(isSigningPath(pathname)).toBe(expected);
  });

  it('never calls the staff session (no /api/auth/*)', async () => {
    const fetchMock = stubApi({});
    renderRoutes('/sign/abc', signRoutes);

    await screen.findByRole('heading', { level: 1, name: he.sign.placeholderTitle });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the kiosk path is the shared one', () => {
    expect(isSigningPath(KIOSK_PAGE_PATH)).toBe(true);
  });
});

describe('/kiosk (the office computer, 5.7)', () => {
  const text = he.sign.kiosk;
  const LONG = 'L'.repeat(43);
  const HR = { name: 'משאבי אנוש', phone: '02-5555555', email: null };

  const bodies = (mock: ReturnType<typeof stubApi>, url: string) =>
    mock.mock.calls
      .filter(([called]) => called === url)
      .map(([, init]) =>
        typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      );

  async function typeCode(code: string) {
    const rendered = renderRoutes(KIOSK_PAGE_PATH, signRoutes);
    const field = await screen.findByRole('textbox', { name: text.field });
    if (code !== '') await rendered.user.type(field, code);
    await rendered.user.click(screen.getByRole('button', { name: text.submit }));
    return rendered;
  }

  it('the code in a POST body, then the state with the long code; nothing in the address', async () => {
    const mock = stubApi({
      'POST /api/kiosk/code': () => jsonResponse(200, { code: LONG }),
      'POST /api/kiosk/state': () => jsonResponse(200, { state: 'valid', hrContact: HR }),
    });
    await typeCode('abcd-efgh');
    expect(await screen.findByText(text.accepted)).toBeVisible();
    expect(screen.getByText(text.nextStep)).toBeVisible();
    expect(bodies(mock, '/api/kiosk/code')).toEqual([{ code: 'ABCDEFGH' }]);
    expect(bodies(mock, '/api/kiosk/state')).toEqual([{ code: LONG }]);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/');
    expect(screen.queryByText(LONG)).toBeNull();
    const called = mock.mock.calls.map(([url]) => (typeof url === 'string' ? url : ''));
    expect(called.some((url) => url.startsWith('/api/auth'))).toBe(false);
  });

  it('a signed document: its line and whom to ask', async () => {
    stubApi({
      'POST /api/kiosk/code': () => jsonResponse(200, { code: LONG }),
      'POST /api/kiosk/state': () => jsonResponse(200, { state: 'signed', hrContact: HR }),
    });
    await typeCode('ABCDEFGH');
    expect(await screen.findByText(text.states.signed)).toBeVisible();
    expect(screen.getByText(HR.phone)).toBeVisible();
  });

  it('a wrong code, a signed-in staff user, too many tries: each in Hebrew', async () => {
    const answers = [
      [apiErrorResponse(404, 'KIOSK_CODE_NOT_FOUND'), text.wrong],
      [apiErrorResponse(409, 'KIOSK_STAFF_SIGNED_IN'), errorMessage('KIOSK_STAFF_SIGNED_IN')],
      [apiErrorResponse(429, 'SIGN_TOO_MANY_REQUESTS'), errorMessage('SIGN_TOO_MANY_REQUESTS')],
    ] as const;
    for (const [answer, shown] of answers) {
      stubApi({ 'POST /api/kiosk/code': () => answer.clone() });
      await typeCode('ABCDEFGH');
      expect(await screen.findByRole('alert')).toHaveTextContent(shown);
      cleanup();
    }
  });

  it('an empty or badly shaped code is refused here, without a request', async () => {
    const mock = stubApi({});
    await typeCode('');
    expect(await screen.findByText(text.required)).toBeVisible();
    cleanup();
    await typeCode('ABC1');
    expect(await screen.findByText(text.shape)).toBeVisible();
    await waitFor(() => expect(mock).not.toHaveBeenCalled());
  });
});
