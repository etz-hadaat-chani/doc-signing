import { KIOSK_PAGE_PATH, type SignHrContact } from '@doc-signing/shared';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { he } from '../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../test/fetch-stub';
import { loadPdf, pdfResponse, pdfStub } from '../test/pdf-document-stub';
import { renderRoutes } from '../test/render';
import { formAnswer } from '../test/sign-form-stub';
import { signRoutes } from './sign-routes';

vi.mock('../pdf/pdf-document', () => import('../test/pdf-document-stub'));
vi.mock('signature_pad', () => import('../test/signature-pad-stub'));

const text = he.sign.document;
const TOKEN = 'T'.repeat(43);
const STATE_URL = `/api/sign/${TOKEN}`;
const DOCUMENT_URL = `${STATE_URL}/document`;
const KIOSK_DOCUMENT_URL = '/api/kiosk/document';
const LONG = 'L'.repeat(43);
const RIGHT_ID = '000000018';
const HR: SignHrContact = { name: 'מחלקת משאבי אנוש', phone: '02-5555555', email: null };
const VERIFIED = { sessionExpiresAt: '2026-10-29T10:15:00.000Z' };

type Handler = (init: RequestInit) => Response;

/** The answers in turn; the last one repeats. */
function inTurn(...answers: (() => Response)[]): Handler {
  let call = 0;
  return () => {
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    if (!answer) throw new Error('no answer');
    return answer();
  };
}

/** A stand-in IntersectionObserver: `reachEnd()` reports the end mark as seen. */
const observers: IntersectionObserverCallback[] = [];
function stubObserver(seenAtOnce = false) {
  observers.length = 0;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private readonly callback: IntersectionObserverCallback) {
        observers.push(callback);
      }
      observe() {
        if (seenAtOnce) this.report();
      }
      disconnect() {}
      report() {
        this.callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
    },
  );
}
const reachEnd = () =>
  observers.forEach((callback) =>
    callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver),
  );

/** A link after the correct ID number; `document` answers `GET …/document`. */
async function linkAtDocument(
  document: Handler,
  verify: Handler = () => jsonResponse(200, VERIFIED),
) {
  const mock = stubApi({
    [`GET ${STATE_URL}`]: () => jsonResponse(200, { state: 'valid', hrContact: HR }),
    [`POST ${STATE_URL}/verify`]: verify,
    [`GET ${DOCUMENT_URL}`]: document,
    [`GET ${STATE_URL}/form`]: () => jsonResponse(200, formAnswer()),
  });
  const rendered = renderRoutes(`/sign/${TOKEN}`, signRoutes);
  await typeId(rendered.user);
  return { mock, ...rendered };
}

/** The office computer after the code and the correct ID number. */
async function kioskAtDocument(document: Handler) {
  const mock = stubApi({
    'POST /api/kiosk/code': () => jsonResponse(200, { code: LONG }),
    'POST /api/kiosk/state': () => jsonResponse(200, { state: 'valid', hrContact: HR }),
    'POST /api/kiosk/verify': () => jsonResponse(200, VERIFIED),
    [`GET ${KIOSK_DOCUMENT_URL}`]: document,
    'GET /api/kiosk/form': () => jsonResponse(200, formAnswer()),
  });
  const rendered = renderRoutes(KIOSK_PAGE_PATH, signRoutes);
  await rendered.user.type(
    await screen.findByRole('textbox', { name: he.sign.kiosk.field }),
    'ABCDEFGH',
  );
  await rendered.user.click(screen.getByRole('button', { name: he.sign.kiosk.submit }));
  await typeId(rendered.user);
  return { mock, ...rendered };
}

async function typeId(user: ReturnType<typeof renderRoutes>['user']) {
  await user.type(await screen.findByRole('textbox', { name: he.sign.idCheck.field }), RIGHT_ID);
  await user.click(screen.getByRole('button', { name: he.sign.idCheck.submit }));
}

const documentShown = () => screen.findByRole('heading', { level: 1, name: text.title });
const continueButton = () => screen.findByRole('button', { name: text.continue });
const urls = (mock: ReturnType<typeof stubApi>) =>
  mock.mock.calls.map(([url]) => (typeof url === 'string' ? url : ''));

beforeEach(() => {
  pdfStub.pages = 3;
  pdfStub.destroy.mockClear();
  loadPdf.mockClear();
  stubObserver();
  vi.stubGlobal('scrollTo', vi.fn());
});

describe('B2 for a link (6.3)', () => {
  it('after the correct ID: the title, the line about the next screen and every page', async () => {
    const { mock, queryClient } = await linkAtDocument(pdfResponse);
    expect(await documentShown()).toBeVisible();
    expect(screen.getByText(text.fillLater)).toBeVisible();
    for (const page of [1, 2, 3])
      expect(await screen.findByText(text.pageLabel(page, 3))).toBeVisible();
    expect(screen.getByRole('region', { name: text.label })).toHaveAttribute('dir', 'ltr');
    const documentCalls = mock.mock.calls.filter(([url]) => url === DOCUMENT_URL);
    expect(documentCalls).toHaveLength(1);
    expect(documentCalls[0]?.[1]?.method ?? 'GET').toBe('GET');
    expect(documentCalls[0]?.[1]?.body).toBeUndefined();
    expect(urls(mock).some((url) => url.startsWith('/api/auth'))).toBe(false);
    // Plain state only: nothing in the data cache.
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('"continue" stays off with its reason until the end is seen, then leads to the form', async () => {
    const { user } = await linkAtDocument(pdfResponse);
    const button = await continueButton();
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(text.scrollHint);
    reachEnd();
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByText(text.scrollHint)).toBeNull();
    await user.click(button);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.form.title }),
    ).toBeVisible();
  });

  it('a short document that fits on the screen: "continue" is on at once', async () => {
    pdfStub.pages = 1;
    stubObserver(true);
    await linkAtDocument(pdfResponse);
    await waitFor(async () => expect(await continueButton()).toBeEnabled());
  });

  it('the session ended (401): the ID number again with a notice, then the document', async () => {
    const { mock, user } = await linkAtDocument(
      inTurn(() => apiErrorResponse(401, 'SIGN_SESSION_EXPIRED'), pdfResponse),
    );
    expect(await screen.findByText(text.sessionEnded)).toBeVisible();
    await typeId(user);
    expect(await documentShown()).toBeVisible();
    expect(await screen.findByText(text.pageLabel(3, 3))).toBeVisible();
    expect(urls(mock).filter((url) => url === DOCUMENT_URL)).toHaveLength(2);
  });

  it.each([
    [409, 'SIGN_ALREADY_SIGNED', { state: 'signed' }, he.sign.messages.signed.title],
    [423, 'SIGN_LOCKED', undefined, he.sign.messages.locked.title],
    [404, 'SIGN_LINK_NOT_FOUND', undefined, he.sign.messages.notFound.title],
  ])('%i: the B5 page', async (status, code, details, title) => {
    await linkAtDocument(() => jsonResponse(status, { error: { code, message: 'x', details } }));
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeVisible();
    if (status !== 404) expect(screen.getByText(HR.name)).toBeVisible();
  });

  it('too many requests (429): the wait line, "try again" off until Retry-After', async () => {
    const { user } = await linkAtDocument(
      inTurn(
        () => apiErrorResponse(429, 'SIGN_TOO_MANY_REQUESTS', { 'Retry-After': '1' }),
        pdfResponse,
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(text.wait(1));
    const retry = screen.getByRole('button', { name: text.retry });
    expect(retry).toBeDisabled();
    await waitFor(() => expect(retry).toBeEnabled(), { timeout: 3000 });
    await user.click(retry);
    expect(await documentShown()).toBeVisible();
  });

  it('no connection: its message and "try again" asks again', async () => {
    let call = 0;
    const mock = stubApi({
      [`GET ${STATE_URL}`]: () => jsonResponse(200, { state: 'valid', hrContact: HR }),
      [`POST ${STATE_URL}/verify`]: () => jsonResponse(200, VERIFIED),
    });
    const base = mock.getMockImplementation();
    mock.mockImplementation((input, init) => {
      if (input === DOCUMENT_URL) {
        call += 1;
        return call === 1
          ? Promise.reject(new TypeError('offline'))
          : Promise.resolve(pdfResponse());
      }
      if (!base) throw new Error('no stub');
      return base(input, init);
    });
    const { user } = renderRoutes(`/sign/${TOKEN}`, signRoutes);
    await typeId(user);
    expect(await screen.findByRole('heading', { name: he.feedback.networkTitle })).toBeVisible();
    await user.click(screen.getByRole('button', { name: he.feedback.retry }));
    expect(await documentShown()).toBeVisible();
  });

  it('pdf.js could not read it: the general error and "try again"', async () => {
    loadPdf.mockRejectedValueOnce(new Error('bad pdf'));
    await linkAtDocument(pdfResponse);
    expect(await screen.findByRole('heading', { name: he.feedback.crashTitle })).toBeVisible();
    expect(screen.getByRole('button', { name: he.feedback.retry })).toBeVisible();
  });

  it('nothing is kept after the screen closes: pdf.js document destroyed', async () => {
    await linkAtDocument(pdfResponse);
    await screen.findByText(text.pageLabel(3, 3));
    expect(pdfStub.destroy).not.toHaveBeenCalled();
    cleanup();
    expect(pdfStub.destroy).toHaveBeenCalledTimes(1);
  });

  it('closed while loading: the request is aborted', async () => {
    let signal: AbortSignal | null | undefined;
    await linkAtDocument((init) => {
      signal = init.signal;
      return pdfResponse();
    });
    await waitFor(() => expect(signal).toBeDefined());
    cleanup();
    expect(signal?.aborted).toBe(true);
  });
});

describe('B2 on the office computer (6.3)', () => {
  it('the document with the kiosk cookie only: no code in the call', async () => {
    const { mock } = await kioskAtDocument(pdfResponse);
    expect(await documentShown()).toBeVisible();
    expect(await screen.findByText(text.pageLabel(3, 3))).toBeVisible();
    const call = mock.mock.calls.find(([url]) => url === KIOSK_DOCUMENT_URL);
    expect(call?.[1]?.body).toBeUndefined();
    for (const url of urls(mock)) {
      expect(url).not.toContain(LONG);
      expect(url.startsWith('/api/auth')).toBe(false);
    }
    expect(urls(mock).includes(DOCUMENT_URL)).toBe(false);
  });

  it('a session that ended (401): "ask the manager to open it again"', async () => {
    await kioskAtDocument(() => apiErrorResponse(401, 'SIGN_SESSION_EXPIRED'));
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.kioskCodeGone.title }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: he.sign.kiosk.again })).toBeVisible();
  });

  it('signed meanwhile (409): the "already signed" page', async () => {
    await kioskAtDocument(() =>
      jsonResponse(409, {
        error: { code: 'SIGN_ALREADY_SIGNED', message: 'x', details: { state: 'signed' } },
      }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.signed.title }),
    ).toBeVisible();
  });

  it('"continue" after the end leads to the form step', async () => {
    const { user } = await kioskAtDocument(pdfResponse);
    const button = await continueButton();
    expect(button).toBeDisabled();
    reachEnd();
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.form.title }),
    ).toBeVisible();
  });
});
