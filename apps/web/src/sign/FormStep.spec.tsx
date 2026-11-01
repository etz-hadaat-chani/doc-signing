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
import { pdfResponse, pdfStub } from '../test/pdf-document-stub';
import { renderRoutes } from '../test/render';
import { EMAIL_PAIR, formAnswer, formBox } from '../test/sign-form-stub';
import { padStub } from '../test/signature-pad-stub';
import { FIT_DELAY_MS } from './form/use-fit-check';
import { replacePage } from './page-navigation';
import { signRoutes } from './sign-routes';

vi.mock('../pdf/pdf-document', () => import('../test/pdf-document-stub'));
vi.mock('signature_pad', () => import('../test/signature-pad-stub'));
vi.mock('./page-navigation', () => ({ replacePage: vi.fn() }));

const text = he.sign.form;
const previewText = he.sign.preview;
const TOKEN = 'T'.repeat(43);
const STATE_URL = `/api/sign/${TOKEN}`;
const FORM_URL = `${STATE_URL}/form`;
const FIT_URL = `${STATE_URL}/fit`;
const SUBMIT_URL = `${STATE_URL}/submit`;
const PREVIEW_URL = `${STATE_URL}/preview`;
const SIGNED = () =>
  jsonResponse(201, {
    state: 'signed',
    signedAt: '2026-10-29T10:05:00.000Z',
    reference: '3F9A-1C2B-7D40',
  });
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
  submit: Handler = SIGNED,
  preview: Handler = pdfResponse,
) {
  const mock = stubApi({
    [`GET ${STATE_URL}`]: () => jsonResponse(200, { state: 'valid', hrContact: HR }),
    [`POST ${STATE_URL}/verify`]: () => jsonResponse(200, VERIFIED),
    [`GET ${STATE_URL}/document`]: pdfResponse,
    [`GET ${FORM_URL}`]: typeof form === 'function' ? form : () => jsonResponse(200, form),
    [`POST ${FIT_URL}`]: fit,
    [`POST ${SUBMIT_URL}`]: submit,
    [`POST ${PREVIEW_URL}`]: preview,
  });
  const rendered = renderRoutes(`/sign/${TOKEN}`, signRoutes);
  await typeId(rendered.user);
  await continueToForm(rendered.user);
  return { mock, ...rendered };
}

/** The office computer after the code, the ID check and the document. */
async function kioskAtForm(
  form: Handler,
  fit: Handler = () => jsonResponse(200, { tooLong: [] }),
  submit: Handler = SIGNED,
  preview: Handler = pdfResponse,
) {
  const mock = stubApi({
    'POST /api/kiosk/code': () => jsonResponse(200, { code: 'L'.repeat(43) }),
    'POST /api/kiosk/state': () => jsonResponse(200, { state: 'valid', hrContact: HR }),
    'POST /api/kiosk/verify': () => jsonResponse(200, VERIFIED),
    'GET /api/kiosk/document': pdfResponse,
    'GET /api/kiosk/form': form,
    'POST /api/kiosk/fit': fit,
    'POST /api/kiosk/submit': submit,
    'POST /api/kiosk/preview': preview,
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
/** "המשך לתצוגה לפני חתימה" on B3. */
const press = (user: Rendered['user']) =>
  user.click(screen.getByRole('button', { name: text.submit.button }));
const previewShown = () => screen.findByRole('heading', { level: 1, name: previewText.title });
/** On B3a: ticks the reading statement and presses "אישור וחתימה". */
async function tickAndConfirm(user: Rendered['user']) {
  await previewShown();
  await user.click(screen.getByRole('checkbox', { name: previewText.ack }));
  await user.click(screen.getByRole('button', { name: previewText.confirm }));
}
const doneShown = () => screen.findByRole('heading', { level: 1, name: he.sign.done.title });
const drawingGroup = () => screen.getByRole('group', { name: 'ראשי תיבות' });
const signatureGroup = () => screen.getByRole('group', { name: text.signature.title });
/** The big pad (the last one made: a new ID check makes it again). */
const signaturePad = () =>
  padStub.pads.findLast((pad) => pad.canvas.getAttribute('aria-label') === text.signature.area);
/** Signs with the mouse on the big pad. */
function sign() {
  act(() => signaturePad()?.stroke());
}
const helperOf = (field: HTMLElement) =>
  field.closest('.MuiFormControl-root')?.querySelector('.MuiFormHelperText-root')?.textContent;

beforeEach(() => {
  padStub.pads.length = 0;
  pdfStub.destroy.mockClear();
  vi.mocked(replacePage).mockClear();
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
    expect(screen.getByText(text.signature.everywhere)).toBeVisible();
  });

  it('each box with its label; a list of 3 as radio buttons, of 6 as a drop-down; filled → signed', async () => {
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
    // The optional checkbox says so.
    expect(screen.getByRole('checkbox', { name: `יש לי רכב ${text.optional}` })).not.toBeChecked();
    sign();
    await press(user);
    await tickAndConfirm(user);
    expect(await doneShown()).toBeVisible();
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

  it('the B3 button with required boxes empty: a Hebrew error next to each, the first one focused', async () => {
    const { mock, user } = await linkAtForm();
    await formShown();
    await user.click(screen.getByRole('radio', { name: text.email.office }));
    await press(user);
    const required = errorMessage('ANSWER_REQUIRED');
    const note = screen.getByRole('textbox', { name: 'הערה' });
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(helperOf(note)).toBe(required);
    expect(note).toHaveFocus();
    expect(screen.getAllByText(required).length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText(errorMessage('SIGNATURE_EMPTY'))).toBeVisible();
    // The reading statement is on B3a now (6.5): not asked here.
    expect(screen.queryByText(errorMessage('SIGN_ACK_REQUIRED'))).toBeNull();
    expect(screen.queryByRole('checkbox', { name: previewText.ack })).toBeNull();
    expect(screen.getByText(text.toFix(7))).toBeVisible();
    expect(calls(mock, PREVIEW_URL)).toHaveLength(0);
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
    await user.click(screen.getByRole('radio', { name: text.email.office }));
    await press(user);
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
    // No choice yet: the B3 button is off, and says why.
    const button = screen.getByRole('button', { name: text.submit.button });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(text.submit.chooseFirst);
    await user.click(office);
    await user.click(byEmail);
    expect(button).toBeEnabled();
    await press(user);

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
    await user.click(within(drawingGroup()).getByRole('button', { name: text.clear }));
    expect(screen.queryByText(text.drawingTooLarge)).toBeNull();
    await user.click(screen.getByRole('radio', { name: text.email.office }));
    await press(user);
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

/** Fills every required box of `FULL_FORM` (no signature, no tick). */
async function fillAll(user: Rendered['user']) {
  await formShown();
  await user.type(screen.getByRole('textbox', { name: 'הערה' }), 'שלום');
  await user.type(screen.getByRole('textbox', { name: 'פירוט' }), 'טקסט');
  await user.click(screen.getByRole('radio', { name: 'אפשרות 2' }));
  await user.click(screen.getByRole('combobox', { name: 'עיר' }));
  await user.click(await screen.findByRole('option', { name: 'אפשרות 6' }));
  await user.type(screen.getByRole('textbox', { name: 'תאריך התחלה' }), '5/11/2026');
  act(() => padStub.pads[0]?.stroke());
}

/** Every canvas reads as blank (too little ink), as a real canvas would before she draws. */
function blankCanvases() {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const data = new Uint8ClampedArray(this.width * this.height * 4);
    return { scale: vi.fn(), getImageData: () => ({ data }) } as unknown as RenderingContext;
  });
}

const errorAnswer = (status: number, code: string, details: object) => () =>
  jsonResponse(status, { error: { code, message: 'x', details } });

/** Office chosen and signed, then the B3 button, then on B3a the statement and "אישור וחתימה". */
async function officeSignPress(user: Rendered['user']) {
  await user.click(screen.getByRole('radio', { name: text.email.office }));
  sign();
  await press(user);
  await tickAndConfirm(user);
}

describe('B3 signature and the button for a link (6.4 part B)', () => {
  it('2 minutes before the session ends: a calm line, not an alert (here: the end already near)', async () => {
    await linkAtForm();
    await formShown();
    const warning = screen.getByText(he.sign.sessionWarning.link);
    expect(warning.closest('[role="status"]')).not.toBeNull();
    expect(warning.closest('[role="alert"]')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the large pad (≥ 500 × 200), the one-signature line, and "ניקוי" empties it', async () => {
    const { user } = await linkAtForm();
    await formShown();
    const canvas = within(signatureGroup()).getByRole('img', { name: text.signature.area });
    expect(canvas).toHaveStyle({ height: '224px', maxWidth: '560px', width: '100%' });
    expect(within(signatureGroup()).getByText(text.signature.everywhere)).toBeVisible();
    const pad = signaturePad();
    act(() => pad?.stroke());
    await user.click(within(signatureGroup()).getByRole('button', { name: text.clear }));
    expect(pad?.clear).toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: text.email.office }));
    await press(user);
    expect(within(signatureGroup()).getByText(errorMessage('SIGNATURE_EMPTY'))).toBeVisible();
  });

  it('too little ink in the signature or a drawing: a Hebrew error at that pad, nothing sent', async () => {
    const canvases = blankCanvases();
    const { mock, user } = await linkAtForm();
    await fillAll(user);
    await user.click(screen.getByRole('radio', { name: text.email.office }));
    sign();
    await press(user);
    expect(within(signatureGroup()).getByText(errorMessage('SIGNATURE_EMPTY'))).toBeVisible();
    expect(within(drawingGroup()).getByText(errorMessage('DRAWING_EMPTY'))).toBeVisible();
    expect(within(drawingGroup()).getByRole('button', { name: text.clear })).toHaveFocus();
    expect(calls(mock, PREVIEW_URL)).toHaveLength(0);
    canvases.mockRestore();
  });

  it('a signature larger than the server takes is not saved: a Hebrew error at the pad', async () => {
    const { mock, user } = await linkAtForm();
    await fillAll(user);
    padStub.png = `data:image/png;base64,${'A'.repeat(SIGN_IMAGE_MAX_CHARS)}`;
    act(() => signaturePad()?.stroke());
    expect(within(signatureGroup()).getByText(text.signature.tooLarge)).toBeVisible();
    await user.click(screen.getByRole('radio', { name: text.email.office }));
    await press(user);
    expect(calls(mock, PREVIEW_URL)).toHaveLength(0);
  });

  it('the body: the signature, the shown answers only, the email for "email"; signed with the same body + the statement', async () => {
    const { mock, user, queryClient } = await linkAtForm();
    await fillAll(user);
    const agree = screen.getByRole('checkbox', { name: `יש לי רכב ${text.optional}` });
    await user.click(agree);
    await user.type(await screen.findByRole('textbox', { name: 'מספר רכב' }), '12-345-67');
    await user.click(agree);
    await user.click(screen.getByRole('radio', { name: text.email.byEmail }));
    sign();
    await press(user);
    await tickAndConfirm(user);
    expect(await doneShown()).toBeVisible();
    const previewed = {
      signatureImage: padStub.png,
      emailChoice: 'email',
      email: 'dana@example.test',
      answers: {
        note: 'שלום',
        story: 'טקסט',
        size: 'אפשרות 2',
        city: 'אפשרות 6',
        start: '2026-11-05',
      },
      drawings: { initials: padStub.png },
    };
    expect(calls(mock, PREVIEW_URL)).toHaveLength(1);
    expect(calls(mock, PREVIEW_URL)[0]?.[1]?.method).toBe('POST');
    expect(bodyOf(calls(mock, PREVIEW_URL)[0])).toEqual(previewed);
    expect(calls(mock, SUBMIT_URL)).toHaveLength(1);
    expect(calls(mock, SUBMIT_URL)[0]?.[1]?.method).toBe('POST');
    expect(bodyOf(calls(mock, SUBMIT_URL)[0])).toEqual({ ...previewed, acknowledged: true });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it("B4 for a link: signed, the copy to the link's address, the contact; her answers gone", async () => {
    const { user } = await linkAtForm();
    await fillAll(user);
    await user.click(screen.getByRole('radio', { name: text.email.byEmail }));
    sign();
    await press(user);
    await tickAndConfirm(user);
    expect(await doneShown()).toBeVisible();
    expect(screen.getByText(he.sign.done.linkCopy)).toBeVisible();
    expect(screen.getByText(HR.name)).toBeVisible();
    expect(document.body.textContent).not.toContain('dana@example.test');
    expect(document.body.textContent).not.toContain('שלום');
    expect(screen.queryByRole('img', { name: text.signature.area })).toBeNull();
    expect(screen.queryByRole('region', { name: previewText.label })).toBeNull();
  });

  it('"office" and double clicks: one preview, one signature, no address in either', async () => {
    let answer: (response: Response) => void = () => {};
    const submit = () => new Promise<Response>((done) => (answer = done));
    const { mock, user } = await linkAtForm(FULL_FORM, undefined, submit as unknown as Handler);
    await fillAll(user);
    await user.click(screen.getByRole('radio', { name: text.email.office }));
    sign();
    await user.dblClick(screen.getByRole('button', { name: text.submit.button }));
    await previewShown();
    expect(calls(mock, PREVIEW_URL)).toHaveLength(1);
    await user.click(screen.getByRole('checkbox', { name: previewText.ack }));
    await user.dblClick(screen.getByRole('button', { name: previewText.confirm }));
    expect(screen.getByRole('button', { name: previewText.sending })).toBeDisabled();
    expect(calls(mock, SUBMIT_URL)).toHaveLength(1);
    const body = bodyOf(calls(mock, SUBMIT_URL)[0]) as Record<string, unknown>;
    expect(body.emailChoice).toBe('office');
    expect(body).not.toHaveProperty('email');
    expect(bodyOf(calls(mock, PREVIEW_URL)[0])).not.toHaveProperty('email');
    act(() => answer(SIGNED()));
    expect(await doneShown()).toBeVisible();
  });

  it("the preview's 400s land at their box or pad on B3: the first scrolled to and focused", async () => {
    const preview = inTurn(
      errorAnswer(400, 'VALIDATION_FAILED', {
        fields: [{ field: 'answers.story', code: 'ANSWER_TOO_LONG', message: 'x' }],
      }),
      errorAnswer(400, 'ANSWER_DOES_NOT_FIT', { key: 'note' }),
      errorAnswer(400, 'DRAWING_IMAGE_INVALID', { key: 'initials' }),
      () => apiErrorResponse(400, 'SIGNATURE_IMAGE_INVALID'),
      pdfResponse,
    );
    const { user } = await linkAtForm(FULL_FORM, undefined, SIGNED, preview);
    await fillAll(user);
    await user.click(screen.getByRole('radio', { name: text.email.office }));
    sign();
    await press(user);
    const story = screen.getByRole('textbox', { name: 'פירוט' });
    await waitFor(() => expect(helperOf(story)).toBe(errorMessage('ANSWER_TOO_LONG')));
    expect(story).toHaveFocus();
    // Her edit clears the server's error at that box.
    await user.type(story, 'א');
    expect(helperOf(story)).not.toBe(errorMessage('ANSWER_TOO_LONG'));
    await press(user);
    const note = screen.getByRole('textbox', { name: 'הערה' });
    await waitFor(() => expect(helperOf(note)).toBe(errorMessage('ANSWER_DOES_NOT_FIT')));
    expect(note).toHaveFocus();
    await user.type(note, 'א');
    await press(user);
    expect(
      await within(drawingGroup()).findByText(errorMessage('DRAWING_IMAGE_INVALID')),
    ).toBeVisible();
    act(() => padStub.pads[0]?.stroke());
    await press(user);
    expect(
      await within(signatureGroup()).findByText(errorMessage('SIGNATURE_IMAGE_INVALID')),
    ).toBeVisible();
    sign();
    await press(user);
    await tickAndConfirm(user);
    expect(await doneShown()).toBeVisible();
  });

  it('the session ended at "אישור וחתימה": the ID again, B3 with everything kept; she presses again', async () => {
    const submit = inTurn(() => apiErrorResponse(401, 'SIGN_SESSION_EXPIRED'), SIGNED);
    const { mock, user } = await linkAtForm(FULL_FORM, undefined, submit);
    await fillAll(user);
    await officeSignPress(user);
    expect(await screen.findByText(he.sign.document.sessionEnded)).toBeVisible();
    await typeId(user);
    await formShown();
    expect(calls(mock, SUBMIT_URL)).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'הערה' })).toHaveValue('שלום');
    expect(screen.getByRole('radio', { name: text.email.office })).toBeChecked();
    await press(user);
    await tickAndConfirm(user);
    expect(await doneShown()).toBeVisible();
    // The same body again: the signature was kept too.
    const [first, second] = calls(mock, SUBMIT_URL).map(bodyOf);
    expect(second).toEqual(first);
    expect((second as { signatureImage: string }).signatureImage).toBe(padStub.png);
    expect(calls(mock, PREVIEW_URL)).toHaveLength(2);
  });

  it('already signed (409, e.g. a second tab): B4 without promising a copy', async () => {
    const submit = errorAnswer(409, 'SIGN_ALREADY_SIGNED', { state: 'signed' });
    const { user } = await linkAtForm(FULL_FORM, undefined, submit);
    await fillAll(user);
    await officeSignPress(user);
    expect(await doneShown()).toBeVisible();
    expect(screen.queryByText(he.sign.done.linkCopy)).toBeNull();
  });

  it('cancelled meanwhile (409): the B5 page', async () => {
    const submit = errorAnswer(409, 'SIGN_CANCELLED', { state: 'cancelled' });
    const { user } = await linkAtForm(FULL_FORM, undefined, submit);
    await fillAll(user);
    await officeSignPress(user);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.cancelled.title }),
    ).toBeVisible();
  });

  it('429: "wait N minutes" and the button off until then; the statement stays ticked', async () => {
    const submit = () => apiErrorResponse(429, 'SIGN_TOO_MANY_REQUESTS', { 'Retry-After': '120' });
    const { user } = await linkAtForm(FULL_FORM, undefined, submit);
    await fillAll(user);
    await officeSignPress(user);
    expect(await screen.findByText(he.sign.document.wait(2))).toBeVisible();
    expect(screen.getByRole('button', { name: previewText.confirm })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: previewText.ack })).toBeChecked();
  });

  it('no connection: an error with "try again"; it sends again', async () => {
    const submit = inTurn(() => {
      throw new TypeError('Failed to fetch');
    }, SIGNED);
    const { mock, user } = await linkAtForm(FULL_FORM, undefined, submit);
    await fillAll(user);
    await officeSignPress(user);
    const alert = (await screen.findByText(he.feedback.networkText)).closest<HTMLElement>(
      '[role="alert"]',
    );
    if (!alert) throw new Error('no alert');
    expect(screen.getByRole('checkbox', { name: previewText.ack })).toBeChecked();
    await user.click(within(alert).getByRole('button', { name: previewText.retry }));
    expect(await doneShown()).toBeVisible();
    expect(calls(mock, SUBMIT_URL)).toHaveLength(2);
  });
});

describe('B3a: the preview before signing (6.5)', () => {
  /** A link with every box filled, "office", signed, at B3a. */
  async function linkAtPreview(...args: Parameters<typeof linkAtForm>) {
    const rendered = await linkAtForm(...args);
    await fillAll(rendered.user);
    await rendered.user.click(screen.getByRole('radio', { name: text.email.office }));
    sign();
    await press(rendered.user);
    await previewShown();
    return rendered;
  }

  it('B3a: the title, the line, every page in the wide card, the session warning; nothing cached', async () => {
    const { mock, queryClient } = await linkAtPreview();
    expect(screen.getByText(previewText.intro)).toBeVisible();
    const region = screen.getByRole('region', { name: previewText.label });
    expect(region).toHaveAttribute('dir', 'ltr');
    expect(await within(region).findAllByRole('figure')).toHaveLength(pdfStub.pages);
    expect(screen.getByText(he.sign.sessionWarning.link)).toBeVisible();
    expect(screen.getByRole('main')).toHaveStyle({ maxWidth: '960px' });
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    expect(calls(mock, SUBMIT_URL)).toHaveLength(0);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(urls(mock).some((url) => url.startsWith('/api/auth'))).toBe(false);
    expect(urls(mock).some((url) => url.startsWith('blob:'))).toBe(false);
  });

  it('the reading statement is required on B3a: its error at the box, focused, nothing sent', async () => {
    const { mock, user } = await linkAtPreview();
    await user.click(screen.getByRole('button', { name: previewText.confirm }));
    const ack = screen.getByRole('checkbox', { name: previewText.ack });
    expect(ack).toHaveAttribute('aria-invalid', 'true');
    expect(ack).toHaveFocus();
    expect(screen.getByText(errorMessage('SIGN_ACK_REQUIRED'))).toBeVisible();
    expect(calls(mock, SUBMIT_URL)).toHaveLength(0);
    await user.click(ack);
    expect(screen.queryByText(errorMessage('SIGN_ACK_REQUIRED'))).toBeNull();
  });

  it('"חזרה לתיקון": B3 from the top with everything kept; a changed answer goes into the next preview', async () => {
    const { mock, user } = await linkAtPreview();
    await user.click(screen.getByRole('checkbox', { name: previewText.ack }));
    const [back] = screen.getAllByRole('button', { name: previewText.back });
    if (!back) throw new Error('no back button');
    scrollTo.mockClear();
    await user.click(back);
    await formShown();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    // pdf.js's copy of the preview is freed with the screen.
    expect(pdfStub.destroy).toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: previewText.label })).toBeNull();
    expect(screen.getByRole('main')).not.toHaveStyle({ maxWidth: '960px' });
    expect(calls(mock, FORM_URL)).toHaveLength(1);
    const note = screen.getByRole('textbox', { name: 'הערה' });
    expect(note).toHaveValue('שלום');
    expect(screen.getByRole('radio', { name: text.email.office })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'אפשרות 2' })).toBeChecked();

    await user.type(note, ' רב');
    await press(user);
    await previewShown();
    // A new preview: the statement is ticked again for what she now sees.
    expect(screen.getByRole('checkbox', { name: previewText.ack })).not.toBeChecked();
    const bodies = calls(mock, PREVIEW_URL).map(bodyOf) as {
      answers: { note: string };
      signatureImage: string;
      drawings: Record<string, string>;
    }[];
    expect(bodies.map(({ answers }) => answers.note)).toEqual(['שלום', 'שלום רב']);
    // The signature and the drawing were kept across B3a and back.
    expect(bodies[1]?.signatureImage).toBe(padStub.png);
    expect(bodies[1]?.drawings).toEqual({ initials: padStub.png });
    await tickAndConfirm(user);
    expect(await doneShown()).toBeVisible();
    expect((bodyOf(calls(mock, SUBMIT_URL)[0]) as { answers: { note: string } }).answers.note).toBe(
      'שלום רב',
    );
  });

  it('a 400 at signing (the day changed, say): back on B3 with the error at its box, focused', async () => {
    const submit = inTurn(
      errorAnswer(400, 'VALIDATION_FAILED', {
        fields: [{ field: 'answers.start', code: 'ANSWER_DATE_OUT_OF_RANGE', message: 'x' }],
      }),
      SIGNED,
    );
    const { user } = await linkAtPreview(FULL_FORM, undefined, submit);
    await tickAndConfirm(user);
    await formShown();
    const date = screen.getByRole('textbox', { name: 'תאריך התחלה' });
    await waitFor(() => expect(helperOf(date)).toBe(errorMessage('ANSWER_DATE_OUT_OF_RANGE')));
    expect(date).toHaveFocus();
    expect(screen.getByText(text.toFix(1))).toBeVisible();
  });

  it('the session ended at the preview: the ID again, then B3 with everything kept', async () => {
    const preview = inTurn(() => apiErrorResponse(401, 'SIGN_SESSION_EXPIRED'), pdfResponse);
    const { mock, user } = await linkAtForm(FULL_FORM, undefined, SIGNED, preview);
    await fillAll(user);
    await user.click(screen.getByRole('radio', { name: text.email.office }));
    sign();
    await press(user);
    expect(await screen.findByText(he.sign.document.sessionEnded)).toBeVisible();
    await typeId(user);
    await formShown();
    expect(screen.getByRole('textbox', { name: 'הערה' })).toHaveValue('שלום');
    await press(user);
    await previewShown();
    const [first, second] = calls(mock, PREVIEW_URL).map(bodyOf);
    expect(second).toEqual(first);
  });

  it('the preview refused (409 signed meanwhile): B4 without the copy line', async () => {
    const { user } = await linkAtForm(
      FULL_FORM,
      undefined,
      SIGNED,
      errorAnswer(409, 'SIGN_ALREADY_SIGNED', { state: 'signed' }),
    );
    await fillAll(user);
    await user.click(screen.getByRole('radio', { name: text.email.office }));
    sign();
    await press(user);
    expect(await doneShown()).toBeVisible();
    expect(screen.queryByText(he.sign.done.linkCopy)).toBeNull();
  });

  it('the office computer: the preview through /api/kiosk/preview only', async () => {
    const { mock, user } = await kioskAtForm(() => jsonResponse(200, FULL_FORM));
    await fillAll(user);
    await user.click(screen.getByRole('radio', { name: text.email.office }));
    sign();
    await press(user);
    await previewShown();
    expect(calls(mock, '/api/kiosk/preview')).toHaveLength(1);
    expect(screen.getByText(he.sign.sessionWarning.kiosk)).toBeVisible();
    expect(
      urls(mock).some((url) => url.startsWith('/api/sign') || url.startsWith('/api/auth')),
    ).toBe(false);
  });
});

describe('B3a on the office computer: the ending (6.4 part B, 6.5)', () => {
  const form = () => jsonResponse(200, FULL_FORM);

  it('2 minutes before the session ends: the answers would be lost, ask the manager', async () => {
    await kioskAtForm(form);
    await formShown();
    expect(screen.getByText(he.sign.sessionWarning.kiosk)).toBeVisible();
    expect(screen.queryByText(he.sign.sessionWarning.link)).toBeNull();
  });

  it('"email": no confirm on B3; on B3a the address once more, then signed through location.replace', async () => {
    const { mock, user } = await kioskAtForm(form);
    await fillAll(user);
    await user.click(screen.getByRole('radio', { name: text.email.byEmail }));
    sign();
    await press(user);
    await previewShown();
    expect(screen.queryByRole('dialog')).toBeNull();
    await tickAndConfirm(user);
    const dialog = await screen.findByRole('dialog', { name: previewText.confirmTitle });
    const address = within(dialog).getByText('dana@example.test');
    expect(address.tagName).toBe('BDI');
    expect(address).toHaveAttribute('dir', 'ltr');
    // Back: nothing sent.
    await user.click(within(dialog).getByRole('button', { name: previewText.back }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(mock, '/api/kiosk/submit')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: previewText.confirm }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: previewText.confirmSign,
      }),
    );
    await waitFor(() => expect(replacePage).toHaveBeenCalledWith('/kiosk?done'));
    expect(calls(mock, '/api/kiosk/submit')).toHaveLength(1);
    expect(bodyOf(calls(mock, '/api/kiosk/submit')[0])).toMatchObject({
      emailChoice: 'email',
      email: 'dana@example.test',
      acknowledged: true,
    });
    expect(urls(mock).some((url) => url.startsWith('/api/sign'))).toBe(false);
  });

  it('"office": no confirm; already signed (409) → the "signed" ending without a copy', async () => {
    const { mock, user } = await kioskAtForm(
      form,
      undefined,
      errorAnswer(409, 'SIGN_ALREADY_SIGNED', { state: 'signed' }),
    );
    await fillAll(user);
    await officeSignPress(user);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(replacePage).toHaveBeenCalledWith('/kiosk?signed'));
    expect(calls(mock, '/api/kiosk/submit')).toHaveLength(1);
  });

  it('the session ended at "אישור וחתימה" (401): "ask the manager", her answers dropped', async () => {
    const { user } = await kioskAtForm(form, undefined, () =>
      apiErrorResponse(401, 'SIGN_SESSION_EXPIRED'),
    );
    await fillAll(user);
    await officeSignPress(user);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.kioskCodeGone.title }),
    ).toBeVisible();
    expect(replacePage).not.toHaveBeenCalled();
  });
});
