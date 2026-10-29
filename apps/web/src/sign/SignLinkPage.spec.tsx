import type { SignHrContact } from '@doc-signing/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { he } from '../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../test/fetch-stub';
import { renderRoutes } from '../test/render';
import { signRoutes } from './sign-routes';

/** A request's JSON body (the stub's `init`), or null. */
const bodyOf = (init?: RequestInit): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;

const TOKEN = 'T'.repeat(43);
const STATE_URL = `/api/sign/${TOKEN}`;
const HR: SignHrContact = {
  name: 'מחלקת משאבי אנוש',
  phone: '02-5555555',
  email: 'hr@example.test',
};

function stateAnswer(state: string, hrContact: SignHrContact = HR) {
  return { [`GET ${STATE_URL}`]: () => jsonResponse(200, { state, hrContact }) };
}

function open(path = `/sign/${TOKEN}`) {
  return renderRoutes(path, signRoutes);
}

const contactRegion = () => screen.getByRole('region', { name: he.sign.hrContact.title });

describe('/sign/:token, link states (6.1, B5)', () => {
  it.each(['signed', 'cancelled', 'expired', 'locked'] as const)(
    '%s: its title, its text and the HR contact',
    async (state) => {
      stubApi(stateAnswer(state));
      open();
      const message = he.sign.messages[state];
      expect(await screen.findByRole('heading', { level: 1, name: message.title })).toBeVisible();
      expect(screen.getByText(message.text)).toBeVisible();
      const contact = contactRegion();
      expect(within(contact).getByText(HR.name)).toBeVisible();
      expect(within(contact).getByText(HR.phone ?? '')).toHaveAttribute('dir', 'ltr');
      expect(within(contact).getByText(HR.email ?? '')).toHaveAttribute('dir', 'ltr');
    },
  );

  it('the HR contact without a phone', async () => {
    stubApi(stateAnswer('expired', { ...HR, phone: null }));
    open();
    await screen.findByRole('heading', { level: 1, name: he.sign.messages.expired.title });
    expect(
      within(contactRegion()).queryByText(`${he.sign.hrContact.phone}:`, { exact: false }),
    ).toBeNull();
    expect(within(contactRegion()).getByText(HR.email ?? '')).toBeVisible();
  });

  it('the HR contact without an email', async () => {
    stubApi(stateAnswer('locked', { ...HR, email: null }));
    open();
    await screen.findByRole('heading', { level: 1, name: he.sign.messages.locked.title });
    expect(within(contactRegion()).getByText(HR.phone ?? '')).toBeVisible();
    expect(
      within(contactRegion()).queryByText(`${he.sign.hrContact.email}:`, { exact: false }),
    ).toBeNull();
  });

  it('an unknown link (404): "the link is not valid", without a contact', async () => {
    stubApi({ [`GET ${STATE_URL}`]: () => apiErrorResponse(404, 'SIGN_LINK_NOT_FOUND') });
    open();
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.notFound.title }),
    ).toBeVisible();
    expect(screen.getByText(he.sign.messages.notFound.text)).toBeVisible();
    expect(screen.queryByRole('region', { name: he.sign.hrContact.title })).toBeNull();
  });

  it('no connection: the network screen, and "try again" asks once more', async () => {
    let calls = 0;
    stubApi({
      [`GET ${STATE_URL}`]: () => {
        calls += 1;
        if (calls === 1) throw new TypeError('offline');
        return jsonResponse(200, { state: 'signed', hrContact: HR });
      },
    });
    const { user } = open();
    expect(await screen.findByText(he.feedback.networkTitle)).toBeVisible();
    await user.click(screen.getByRole('button', { name: he.feedback.retry }));
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.signed.title }),
    ).toBeVisible();
    expect(calls).toBe(2);
  });

  it('/sign alone and a longer path: "not valid", no request', async () => {
    const mock = stubApi({});
    open('/sign');
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.notFound.title }),
    ).toBeVisible();
    expect(mock).not.toHaveBeenCalled();
  });

  it('the page shows the organization, and no staff menu', async () => {
    stubApi(stateAnswer('cancelled'));
    open();
    await screen.findByRole('heading', { level: 1, name: he.sign.messages.cancelled.title });
    expect(screen.getByText(he.app.organization)).toBeVisible();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('/sign/:token, the ID check (6.2, B1)', () => {
  const text = he.sign.idCheck;
  const VERIFY_URL = `${STATE_URL}/verify`;
  // Valid check digits (made up): the right one and a wrong one.
  const RIGHT_ID = '000000018';
  const WRONG_ID = '000000026';
  const VERIFIED = { sessionExpiresAt: '2026-10-29T10:15:00.000Z' };

  function openValid(verify: (init: RequestInit) => Response) {
    const mock = stubApi({ ...stateAnswer('valid'), [`POST ${VERIFY_URL}`]: verify });
    return { mock, ...open() };
  }

  const idField = () => screen.findByRole('textbox', { name: text.field });
  const continueButton = () => screen.getByRole('button', { name: text.submit });

  async function typeAndContinue(user: ReturnType<typeof open>['user'], idNumber: string) {
    const field = await idField();
    await user.clear(field);
    if (idNumber !== '') await user.type(field, idNumber);
    await user.click(continueButton());
  }

  /** Every request address and body: the ID number only ever in the verify body. */
  function checkCalls(mock: ReturnType<typeof stubApi>, typed: string[]) {
    for (const [url, init] of mock.mock.calls) {
      const address = typeof url === 'string' ? url : '';
      for (const id of typed) expect(address).not.toContain(id);
      if (address === VERIFY_URL) {
        expect(Object.keys(bodyOf(init) as object)).toEqual(['idNumber']);
      }
      expect(address.startsWith('/api/auth')).toBe(false);
    }
  }

  const mismatch = (attemptsLeft: number) =>
    jsonResponse(401, {
      error: { code: 'SIGN_ID_MISMATCH', message: 'x', details: { attemptsLeft } },
    });

  const refusal = (status: number, code: string, state: string) =>
    jsonResponse(status, { error: { code, message: 'x', details: { state } } });

  it('one numeric field, no autocomplete, at most 9, LTR; a POST form without an action', async () => {
    openValid(() => jsonResponse(200, VERIFIED));
    const field = await idField();
    expect(field).toHaveAttribute('inputmode', 'numeric');
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('maxlength', '9');
    expect(field).toHaveAttribute('dir', 'ltr');
    expect(field).not.toHaveAttribute('name');
    const form = screen.getByRole('form', { name: text.title });
    expect(form).toHaveAttribute('method', 'post');
    expect(form).not.toHaveAttribute('action');
    expect(screen.getByText(text.intro)).toBeVisible();
  });

  it('empty, or a wrong check digit: an error here, no request; letters are not typed', async () => {
    const { mock, user } = openValid(() => jsonResponse(200, VERIFIED));
    await typeAndContinue(user, '');
    expect(await idField()).toHaveAccessibleDescription(text.required);
    await typeAndContinue(user, '12a3456789');
    expect(await idField()).toHaveValue('123456789');
    expect(await idField()).toHaveAccessibleDescription(text.invalid);
    expect(mock.mock.calls.map(([url]) => url)).toEqual([STATE_URL]);
  });

  it('wrong 1–4: 4, 3, 2, 1 attempts left, the field empty and focused; the 5th: locked', async () => {
    let wrong = 0;
    const { mock, user } = openValid(() => {
      wrong += 1;
      return wrong === 5 ? refusal(423, 'SIGN_LOCKED', 'locked') : mismatch(5 - wrong);
    });
    for (const left of [4, 3, 2, 1]) {
      await typeAndContinue(user, WRONG_ID);
      const field = await idField();
      await waitFor(() => expect(field).toHaveAccessibleDescription(text.mismatch(left)));
      expect(field).toHaveValue('');
      expect(field).toHaveFocus();
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('alert')).toHaveTextContent(text.mismatch(left));
    }
    expect(text.mismatch(1)).toContain('ניסיון אחד');
    await typeAndContinue(user, WRONG_ID);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.locked.title }),
    ).toBeVisible();
    expect(within(contactRegion()).getByText(HR.name)).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
    checkCalls(mock, [WRONG_ID]);
    expect(screen.queryByText(WRONG_ID)).toBeNull();
  });

  it('the correct number: the next step, the field gone, the number only in the body', async () => {
    const { mock, user } = openValid(() => jsonResponse(200, VERIFIED));
    await typeAndContinue(user, RIGHT_ID);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.verified.title }),
    ).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
    const sent = mock.mock.calls
      .filter(([url]) => url === VERIFY_URL)
      .map(([, init]) => [init?.method, bodyOf(init)]);
    expect(sent).toEqual([['POST', { idNumber: RIGHT_ID }]]);
    checkCalls(mock, [RIGHT_ID]);
  });

  it('signed meanwhile (409): the "already signed" page', async () => {
    const { user } = openValid(() => refusal(409, 'SIGN_ALREADY_SIGNED', 'signed'));
    await typeAndContinue(user, RIGHT_ID);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.signed.title }),
    ).toBeVisible();
  });

  it('a 400 from the server: the field error; no connection: its line, field empty', async () => {
    let call = 0;
    const { user } = openValid(() => {
      call += 1;
      if (call === 2) throw new TypeError('offline');
      return apiErrorResponse(400, 'INVALID_ID_NUMBER');
    });
    await typeAndContinue(user, RIGHT_ID);
    const field = await idField();
    await waitFor(() => expect(field).toHaveAccessibleDescription(text.invalid));
    await typeAndContinue(user, RIGHT_ID);
    await waitFor(() => expect(field).not.toHaveAccessibleDescription(text.invalid));
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
  });

  it('429: "wait", the button waits out Retry-After', async () => {
    const { user } = openValid(() =>
      apiErrorResponse(429, 'SIGN_TOO_MANY_REQUESTS', { 'Retry-After': '1' }),
    );
    await typeAndContinue(user, RIGHT_ID);
    const field = await idField();
    await waitFor(() => expect(field).toHaveAccessibleDescription(text.wait(1)));
    expect(continueButton()).toBeDisabled();
    await waitFor(() => expect(continueButton()).toBeEnabled(), { timeout: 2500 });
    expect(text.wait(3)).toContain('3 דקות');
  });

  it('429: the wait timer is cleared when the page closes', async () => {
    const clear = vi.spyOn(window, 'clearTimeout');
    const { user } = openValid(() =>
      apiErrorResponse(429, 'SIGN_TOO_MANY_REQUESTS', { 'Retry-After': '600' }),
    );
    await typeAndContinue(user, RIGHT_ID);
    await waitFor(() => expect(continueButton()).toBeDisabled());
    clear.mockClear();
    cleanup();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});
