import {
  errorMessage,
  KIOSK_PAGE_PATH,
  SIGN_IMAGE_MAX_CHARS,
  type SignFormResult,
  type SignHrContact,
} from '@doc-signing/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { he } from '../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../test/fetch-stub';
import { pdfResponse } from '../test/pdf-document-stub';
import { renderRoutes } from '../test/render';
import { EMAIL_PAIR, formAnswer, formBox } from '../test/sign-form-stub';
import { padStub } from '../test/signature-pad-stub';
import { FIT_DELAY_MS } from './form/use-fit-check';
import { signRoutes } from './sign-routes';

vi.mock('../pdf/pdf-document', () => import('../test/pdf-document-stub'));
vi.mock('signature_pad', () => import('../test/signature-pad-stub'));

const text = he.sign.form;
const TOKEN = 'T'.repeat(43);
const STATE_URL = `/api/sign/${TOKEN}`;
const FORM_URL = `${STATE_URL}/form`;
const FIT_URL = `${STATE_URL}/fit`;
const RIGHT_ID = '000000018';
const HR: SignHrContact = { name: 'מחלקת משאבי אנוש', phone: '02-5555555', email: null };
const VERIFIED = { sessionExpiresAt: '2026-10-29T10:15:00.000Z' };
const scrollTo = vi.fn();
const CHOICES = (count: number) => Array.from({ length: count }, (_, i) => `אפשרות ${i + 1}`);

type Handler = (init: RequestInit) => Response;
type Rendered = ReturnType<typeof renderRoutes>;

/** Every box type, a condition, a date range and the email pair. */
const FULL_FORM = formAnswer({
  emailPrefill: 'dana@example.test',
  fields: [
    formBox('note', { label: 'הערה' }),
    formBox('story', { fieldType: 'long_text', label: 'פירוט', options: { maxLength: 20 } }),
    formBox('size', { fieldType: 'select', label: 'מידה', options: { choices: CHOICES(3) } }),
    formBox('city', { fieldType: 'select', label: 'עיר', options: { choices: CHOICES(6) } }),
    formBox('agree', {
      fieldType: 'checkbox',
      label: 'יש לי רכב',
      isRequired: false,
      options: null,
    }),
    formBox('car', { label: 'מספר רכב', showWhen: { key: 'agree', equals: 'true' } }),
    formBox('start', {
      fieldType: 'date_input',
      label: 'תאריך התחלה',
      options: { minDate: 'signing_day', maxDate: '2026-12-31' },
    }),
    formBox('initials', { fieldType: 'drawing', label: 'ראשי תיבות', options: null }),
    ...EMAIL_PAIR,
  ],
});

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

/** The end mark is seen at once: "continue" on B2 is on. */
function stubObserver() {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe() {
        this.callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
      disconnect() {}
    },
  );
}

async function typeId(user: Rendered['user']) {
  await user.type(await screen.findByRole('textbox', { name: he.sign.idCheck.field }), RIGHT_ID);
  await user.click(screen.getByRole('button', { name: he.sign.idCheck.submit }));
}

async function continueToForm(user: Rendered['user']) {
  const button = await screen.findByRole('button', { name: he.sign.document.continue });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

/** A link after the ID check and the document: the form. */
async function linkAtForm(
  form: Handler | SignFormResult = FULL_FORM,
  fit: Handler = () => jsonResponse(200, { tooLong: [] }),
) {
  const mock = stubApi({
    [`GET ${STATE_URL}`]: () => jsonResponse(200, { state: 'valid', hrContact: HR }),
    [`POST ${STATE_URL}/verify`]: () => jsonResponse(200, VERIFIED),
    [`GET ${STATE_URL}/document`]: pdfResponse,
    [`GET ${FORM_URL}`]: typeof form === 'function' ? form : () => jsonResponse(200, form),
    [`POST ${FIT_URL}`]: fit,
  });
  const rendered = renderRoutes(`/sign/${TOKEN}`, signRoutes);
  await typeId(rendered.user);
  await continueToForm(rendered.user);
  return { mock, ...rendered };
}

/** The office computer after the code, the ID check and the document. */
async function kioskAtForm(form: Handler, fit: Handler = () => jsonResponse(200, { tooLong: [] })) {
  const mock = stubApi({
    'POST /api/kiosk/code': () => jsonResponse(200, { code: 'L'.repeat(43) }),
    'POST /api/kiosk/state': () => jsonResponse(200, { state: 'valid', hrContact: HR }),
    'POST /api/kiosk/verify': () => jsonResponse(200, VERIFIED),
    'GET /api/kiosk/document': pdfResponse,
    'GET /api/kiosk/form': form,
    'POST /api/kiosk/fit': fit,
  });
  const rendered = renderRoutes(KIOSK_PAGE_PATH, signRoutes);
  await rendered.user.type(
    await screen.findByRole('textbox', { name: he.sign.kiosk.field }),
    'ABCDEFGH',
  );
  await rendered.user.click(screen.getByRole('button', { name: he.sign.kiosk.submit }));
  await typeId(rendered.user);
  await continueToForm(rendered.user);
  return { mock, ...rendered };
}

const formShown = () => screen.findByRole('heading', { level: 1, name: text.title });
const urls = (mock: ReturnType<typeof stubApi>) =>
  mock.mock.calls.map(([url]) => (typeof url === 'string' ? url : ''));
const calls = (mock: ReturnType<typeof stubApi>, url: string) =>
  mock.mock.calls.filter(([called]) => called === url);
const bodyOf = (call: unknown[] | undefined): unknown => {
  const init = call?.[1] as RequestInit | undefined;
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
};
const check = (user: Rendered['user']) =>
  user.click(screen.getByRole('button', { name: text.check }));
const helperOf = (field: HTMLElement) =>
  field.closest('.MuiFormControl-root')?.querySelector('.MuiFormHelperText-root')?.textContent;

beforeEach(() => {
  padStub.pads.length = 0;
  padStub.png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  stubObserver();
  vi.stubGlobal('scrollTo', scrollTo);
});

describe('B3 form for a link (6.4 part A)', () => {
  it('reads the form with the session cookie only, from the top, and keeps nothing in the cache', async () => {
    const { mock, queryClient } = await linkAtForm();
    expect(await formShown()).toBeVisible();
    expect(screen.getByText(text.intro)).toBeVisible();
    const formCalls = calls(mock, FORM_URL);
    expect(formCalls).toHaveLength(1);
    expect(formCalls[0]?.[1]?.method ?? 'GET').toBe('GET');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(urls(mock).some((url) => url.startsWith('/api/auth'))).toBe(false);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(screen.getByText(text.signaturePlaceholder)).toBeVisible();
  });

  it('each box with its label; a list of 3 as radio buttons, of 6 as a drop-down; filled → all good', async () => {
    const { user } = await linkAtForm();
    await formShown();
    await user.type(screen.getByRole('textbox', { name: 'הערה' }), 'שלום');
    await user.type(screen.getByRole('textbox', { name: 'פירוט' }), 'טקסט');
    const sizes = within(screen.getByRole('radiogroup', { name: 'מידה' })).getAllByRole('radio');
    expect(sizes).toHaveLength(3);
    await user.click(screen.getByRole('radio', { name: 'אפשרות 2' }));
    expect(screen.queryByRole('radiogroup', { name: 'עיר' })).toBeNull();
    await user.click(screen.getByRole('combobox', { name: 'עיר' }));
    await user.click(await screen.findByRole('option', { name: 'אפשרות 6' }));
    await user.type(screen.getByRole('textbox', { name: 'תאריך התחלה' }), '5/11/2026');
    act(() => padStub.pads[0]?.stroke());
    await user.click(screen.getByRole('radio', { name: text.email.byEmail }));
    await check(user);
    expect(await screen.findByText(text.allGood)).toBeVisible();
    // The optional checkbox says so.
    expect(screen.getByRole('checkbox', { name: `יש לי רכב ${text.optional}` })).not.toBeChecked();
  });

  it('a box with a condition appears with its value; hidden again, its answer is dropped', async () => {
    const { user } = await linkAtForm();
    await formShown();
    expect(screen.queryByRole('textbox', { name: 'מספר רכב' })).toBeNull();
    const agree = screen.getByRole('checkbox', { name: `יש לי רכב ${text.optional}` });
    await user.click(agree);
    await user.type(await screen.findByRole('textbox', { name: 'מספר רכב' }), '12-345-67');
    await user.click(agree);
    expect(screen.queryByRole('textbox', { name: 'מספר רכב' })).toBeNull();
    await user.click(agree);
    expect(await screen.findByRole('textbox', { name: 'מספר רכב' })).toHaveValue('');
  });

  it('"check" with required boxes empty: a Hebrew error next to each, the first one focused', async () => {
    const { user } = await linkAtForm();
    await formShown();
    await check(user);
    const required = errorMessage('ANSWER_REQUIRED');
    const note = screen.getByRole('textbox', { name: 'הערה' });
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(helperOf(note)).toBe(required);
    expect(note).toHaveFocus();
    expect(screen.getAllByText(required).length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText(errorMessage('EMAIL_CHOICE_REQUIRED'))).toBeVisible();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(text.toFix(7));
    // The errors follow her edits.
    await user.type(note, 'שלום');
    expect(helperOf(note)).not.toBe(required);
    expect(screen.getByText(text.toFix(6))).toBeVisible();
  });

  it('long text shows how many characters are left', async () => {
    const { user } = await linkAtForm();
    await formShown();
    expect(screen.getByText(text.charsLeft(20))).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: 'פירוט' }), 'שלום');
    expect(screen.getByText(text.charsLeft(16))).toBeVisible();
  });

  it('a date is typed as DD/MM/YYYY with its range; a day that does not exist is an error', async () => {
    const { user } = await linkAtForm();
    await formShown();
    const date = screen.getByRole('textbox', { name: 'תאריך התחלה' });
    expect(date).toHaveAttribute('placeholder', 'DD/MM/YYYY');
    expect(date).toHaveAttribute('dir', 'ltr');
    expect(helperOf(date)).toContain(text.dateBetween('29/10/2026', '31/12/2026'));
    await user.type(date, '31/02/2026');
    await check(user);
    expect(helperOf(date)).toBe(errorMessage('ANSWER_DATE_INVALID'));
    await user.clear(date);
    await user.type(date, '1/1/2026');
    expect(helperOf(date)).toBe(errorMessage('ANSWER_DATE_OUT_OF_RANGE'));
  });

  it('the email section: nothing chosen, the stored email, a bad one, then "office"', async () => {
    const { user } = await linkAtForm();
    await formShown();
    const byEmail = screen.getByRole('radio', { name: text.email.byEmail });
    const office = screen.getByRole('radio', { name: text.email.office });
    expect(byEmail).not.toBeChecked();
    expect(office).not.toBeChecked();
    const field = screen.getByRole('textbox', { name: text.email.field });
    expect(field).toHaveValue('dana@example.test');
    expect(field).toHaveAttribute('dir', 'ltr');
    await check(user);
    expect(screen.getByText(errorMessage('EMAIL_CHOICE_REQUIRED'))).toBeVisible();

    await user.clear(field);
    await user.type(field, 'not-an-email');
    expect(byEmail).toBeChecked();
    expect(screen.queryByText(errorMessage('EMAIL_CHOICE_REQUIRED'))).toBeNull();
    expect(helperOf(field)).toBe(errorMessage('INVALID_EMAIL'));

    await user.click(office);
    expect(office).toBeChecked();
    expect(byEmail).not.toBeChecked();
    expect(field).toBeDisabled();
    expect(field).toHaveValue('not-an-email');
    expect(screen.queryByText(errorMessage('INVALID_EMAIL'))).toBeNull();
  });

  it('a correction round: "תיקון נדרש" with the note as plain text, keeping its lines', async () => {
    const note = '<b>יש לתקן</b>\nאת הכתובת';
    await linkAtForm(formAnswer({ correctionNote: note }));
    await formShown();
    expect(screen.getByText(text.correction)).toBeVisible();
    const shown = screen.getByText((_, element) => element?.textContent === note);
    expect(shown).toHaveStyle({ whiteSpace: 'pre-line' });
    expect(shown.querySelector('b')).toBeNull();
  });

  it('the fit warning: after she stops typing, asked only for the box she changed', async () => {
    const fit = vi.fn((init: RequestInit) => {
      const { answers } = bodyOf([undefined, init]) as { answers: Record<string, string> };
      return jsonResponse(200, { tooLong: Object.keys(answers).filter((key) => key === 'note') });
    });
    const { mock, user } = await linkAtForm(FULL_FORM, fit);
    await formShown();
    await user.type(screen.getByRole('textbox', { name: 'הערה' }), 'טקסט ארוך');
    expect(calls(mock, FIT_URL)).toHaveLength(0);
    const warning = errorMessage('ANSWER_DOES_NOT_FIT');
    expect(await screen.findByText(warning)).toBeVisible();
    expect(calls(mock, FIT_URL)).toHaveLength(1);
    expect(bodyOf(calls(mock, FIT_URL)[0])).toEqual({ answers: { note: 'טקסט ארוך' } });

    await user.type(screen.getByRole('textbox', { name: 'פירוט' }), 'קצר');
    await waitFor(() => expect(calls(mock, FIT_URL)).toHaveLength(2), {
      timeout: FIT_DELAY_MS * 5,
    });
    expect(bodyOf(calls(mock, FIT_URL)[1])).toEqual({ answers: { story: 'קצר' } });
    // Longer than a text that didn't fit: no new call, still the warning.
    await user.type(screen.getByRole('textbox', { name: 'הערה' }), ' עוד');
    await new Promise((done) => setTimeout(done, FIT_DELAY_MS * 2));
    expect(calls(mock, FIT_URL)).toHaveLength(2);
    expect(screen.getByText(warning)).toBeVisible();
  });

  it('a drawing too large for the server is not saved: a Hebrew error at its box', async () => {
    const { user } = await linkAtForm();
    await formShown();
    padStub.png = `data:image/png;base64,${'A'.repeat(SIGN_IMAGE_MAX_CHARS)}`;
    act(() => padStub.pads[0]?.stroke());
    expect(screen.getByText(text.drawingTooLarge)).toBeVisible();
    await user.click(screen.getByRole('button', { name: text.clear }));
    expect(screen.queryByText(text.drawingTooLarge)).toBeNull();
    await check(user);
    const group = screen.getByRole('group', { name: 'ראשי תיבות' });
    expect(within(group).getByText(errorMessage('ANSWER_REQUIRED'))).toBeVisible();
  });

  it('the session ended while she filled it in: the ID again, then the form with every answer kept', async () => {
    const fit = inTurn(() => apiErrorResponse(401, 'SIGN_SESSION_EXPIRED'));
    const { mock, user } = await linkAtForm(FULL_FORM, fit);
    await formShown();
    await user.type(screen.getByRole('textbox', { name: 'הערה' }), 'שלום');
    await user.click(screen.getByRole('radio', { name: text.email.office }));
    expect(await screen.findByText(he.sign.document.sessionEnded)).toBeVisible();
    await typeId(user);
    await formShown();
    expect(screen.getByRole('textbox', { name: 'הערה' })).toHaveValue('שלום');
    expect(screen.getByRole('radio', { name: text.email.office })).toBeChecked();
    expect(calls(mock, FORM_URL)).toHaveLength(2);
    expect(calls(mock, `${STATE_URL}/verify`)).toHaveLength(2);
  });

  it('cancelled meanwhile (409): the "cancelled" page with the contact', async () => {
    await linkAtForm(() =>
      jsonResponse(409, {
        error: { code: 'SIGN_CANCELLED', message: 'x', details: { state: 'cancelled' } },
      }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.cancelled.title }),
    ).toBeVisible();
    expect(screen.getByText(HR.name)).toBeVisible();
  });
});

describe('B3 form on the office computer (6.4 part A)', () => {
  it('reads the form and checks fit with the kiosk cookie only, never a link address', async () => {
    const { mock, user } = await kioskAtForm(() => jsonResponse(200, FULL_FORM));
    await formShown();
    await user.type(screen.getByRole('textbox', { name: 'הערה' }), 'שלום');
    await waitFor(() => expect(calls(mock, '/api/kiosk/fit')).toHaveLength(1));
    expect(calls(mock, '/api/kiosk/form')).toHaveLength(1);
    expect(
      urls(mock).some((url) => url.startsWith('/api/sign') || url.startsWith('/api/auth')),
    ).toBe(false);
  });

  it('a session that ended (401): "ask the manager to open it again"', async () => {
    await kioskAtForm(() => apiErrorResponse(401, 'SIGN_SESSION_EXPIRED'));
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.kioskCodeGone.title }),
    ).toBeVisible();
  });
});
