import { errorMessage, KIOSK_PAGE_PATH } from '@doc-signing/shared';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isSigningPath } from '../app/area';
import { he } from '../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../test/fetch-stub';
import { renderRoutes } from '../test/render';
import { signRoutes } from './sign-routes';

/** A request's JSON body (the stub's `init`), or null. */
const bodyOf = (init?: RequestInit): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;

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

  it('never calls the staff session (no /api/auth/*): only the link state', async () => {
    const fetchMock = stubApi({
      'GET /api/sign/abc': () =>
        jsonResponse(200, {
          state: 'signed',
          hrContact: { name: 'משאבי אנוש', phone: null, email: 'hr@example.test' },
        }),
    });
    renderRoutes('/sign/abc', signRoutes);

    await screen.findByRole('heading', { level: 1, name: he.sign.messages.signed.title });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/sign/abc']);
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
    expect(screen.getByRole('textbox', { name: he.sign.idCheck.field })).toBeVisible();
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
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.signed.title }),
    ).toBeVisible();
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

describe('/kiosk, the ID check (6.2, B1 on the office computer)', () => {
  const LONG = 'L'.repeat(43);
  const HR = { name: 'משאבי אנוש', phone: '02-5555555', email: null };
  const RIGHT_ID = '000000018';
  const id = he.sign.idCheck;

  /** The code accepted, then each verify answered by `verify` in turn. */
  async function atIdCheck(verify: () => Response) {
    const mock = stubApi({
      'POST /api/kiosk/code': () => jsonResponse(200, { code: LONG }),
      'POST /api/kiosk/state': () => jsonResponse(200, { state: 'valid', hrContact: HR }),
      'POST /api/kiosk/verify': verify,
    });
    const rendered = renderRoutes(KIOSK_PAGE_PATH, signRoutes);
    await rendered.user.type(
      await screen.findByRole('textbox', { name: he.sign.kiosk.field }),
      'ABCDEFGH',
    );
    await rendered.user.click(screen.getByRole('button', { name: he.sign.kiosk.submit }));
    const field = await screen.findByRole('textbox', { name: id.field });
    const send = async () => {
      await rendered.user.type(field, RIGHT_ID);
      await rendered.user.click(screen.getByRole('button', { name: id.submit }));
    };
    return { mock, field, send };
  }

  it('the long code and the number in the POST body; correct → the next step', async () => {
    const { mock, send } = await atIdCheck(() =>
      jsonResponse(200, { sessionExpiresAt: '2026-10-29T10:15:00.000Z' }),
    );
    await send();
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.verified.title }),
    ).toBeVisible();
    const verifyBodies = mock.mock.calls
      .filter(([url]) => url === '/api/kiosk/verify')
      .map(([, init]) => bodyOf(init));
    expect(verifyBodies).toEqual([{ code: LONG, idNumber: RIGHT_ID }]);
    for (const [url] of mock.mock.calls) {
      const address = typeof url === 'string' ? url : '';
      expect(address).not.toContain(RIGHT_ID);
      expect(address).not.toContain(LONG);
    }
  });

  it("the kiosk's own attempts (D2) show like a link's; its 423: ask for a new code", async () => {
    let wrong = 0;
    const { field, send } = await atIdCheck(() => {
      wrong += 1;
      if (wrong === 2) return apiErrorResponse(423, 'SIGN_LOCKED');
      return jsonResponse(401, {
        error: { code: 'SIGN_ID_MISMATCH', message: 'x', details: { attemptsLeft: 1 } },
      });
    });
    await send();
    await waitFor(() => expect(field).toHaveAccessibleDescription(id.mismatch(1)));
    await send();
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.kioskLocked.title }),
    ).toBeVisible();
    expect(screen.getByText(he.sign.messages.kioskLocked.text)).toBeVisible();
    expect(screen.getByText(HR.phone)).toBeVisible();
    expect(screen.getByRole('button', { name: he.sign.kiosk.again })).toBeVisible();
  });

  it('an ended code at the ID step: "ask the manager to open it again"', async () => {
    const { send } = await atIdCheck(() => apiErrorResponse(404, 'KIOSK_CODE_NOT_FOUND'));
    await send();
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: he.sign.messages.kioskCodeGone.title,
      }),
    ).toBeVisible();
  });

  it('a staff user signed in meanwhile: the API text under the field', async () => {
    const { field, send } = await atIdCheck(() => apiErrorResponse(409, 'KIOSK_STAFF_SIGNED_IN'));
    await send();
    await waitFor(() =>
      expect(field).toHaveAccessibleDescription(errorMessage('KIOSK_STAFF_SIGNED_IN')),
    );
  });
});
