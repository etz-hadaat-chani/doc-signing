import {
  formatDate,
  linkExpiresAtFrom,
  type RoundCreated,
  type RoundSent,
  TEMPLATE_PREVIEW_WARNINGS,
} from '@doc-signing/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { he } from '../../../i18n/he';
import { apiErrorResponse, jsonResponse } from '../../../test/fetch-stub';
import { card, EMPLOYEE_ID } from '../../employees/employees.fixtures';
import { readyTemplate } from '../../templates/templates.fixtures';
import { report } from './rounds.fixtures';
import {
  type Answer,
  bodyOf,
  callsTo,
  chooseAll,
  type FetchMock,
  nextButton,
  openWizard,
  PREVIEW,
  type Rendered,
  stepTitle,
  stub,
  text,
  tile,
  toRecipients,
  toSummary,
} from './wizard.test-utils';

// pdf.js needs a real browser (canvas, workers): the preview is tested with a stand-in.
vi.mock('../../../pdf/pdf-document', () => ({
  loadPdf: vi.fn(() =>
    Promise.resolve({
      pages: [{ width: 595, height: 842 }],
      render: () => ({ done: Promise.resolve(), cancel: () => undefined }),
      destroy: () => undefined,
    }),
  ),
  isCancelled: () => false,
}));

const texts = he.newRound;
const ROUND_ID = '7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e';
const TEMPLATE = `/api/templates/${readyTemplate.id}`;
const CREATE = 'POST /api/rounds';
const SEND = `POST /api/rounds/${ROUND_ID}/send`;
const CANCEL = `POST /api/rounds/${ROUND_ID}/cancel`;
const PDF = `GET ${TEMPLATE}/preview`;
const CHECK = `GET ${TEMPLATE}/preview/check`;
const EMAIL = `GET ${TEMPLATE}/invitation-preview?linkExpiryDays=60`;

const SETTINGS = {
  reminderIntervalDays: 3,
  maxReminders: null,
  linkExpiryDays: 60,
  senderName: 'מערכת חתימות',
  hrContact: { name: 'משאבי אנוש', phone: '02-1234567', email: null },
  reminderSkipDates: [],
  employerSignature: null,
};

const created: RoundCreated = {
  id: ROUND_ID,
  name: 'חוזה שנתי',
  mode: 'single_template',
  status: 'draft',
  settings: {
    remindersEnabled: true,
    reminderIntervalDays: 3,
    maxReminders: null,
    linkExpiryDays: 60,
  },
  linkExpiresAt: null,
  templates: [],
  counts: report().counts,
  createdAt: '2026-10-28T08:00:00.000Z',
};

const sent: RoundSent = {
  id: ROUND_ID,
  status: 'sending',
  sentAt: '2026-10-28T08:00:00.000Z',
  linkExpiresAt: '2026-12-27T08:00:00.000Z',
  counts: { queued: 7, noEmail: 2, missingData: 1, cancelledInactive: 0 },
  outdatedTemplateIds: [],
  textWarnings: { total: 0, truncated: false, items: [] },
};

const errorWith = (status: number, code: string, details?: Record<string, unknown>) =>
  jsonResponse(status, { error: { code, message: 'text from the server', details } });

const networkError = () => Promise.reject(new TypeError('Failed to fetch'));

function stubB(routes: Record<string, Answer> = {}) {
  return stub({
    'GET /api/settings': () => jsonResponse(200, SETTINGS),
    [PDF]: () =>
      new Response(new Uint8Array([37, 80, 68, 70]), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    [CHECK]: () =>
      jsonResponse(200, {
        sample: true,
        missing: [],
        leftForEmployee: [{ key: 'address', name: 'כתובת' }],
        warnings: [{ code: 'TEXT_TOO_LONG', message: 'text from the server', keys: ['address'] }],
      }),
    [EMAIL]: () =>
      jsonResponse(200, {
        senderName: 'מערכת חתימות',
        subject: 'מסמך לחתימה: חוזה',
        html: '<p>שלום שירה</p><a href="https://example.org/sign/example-link">חתימה</a>',
        text: 'שלום שירה',
        expiresAt: '2026-12-27T08:00:00.000Z',
      }),
    [CREATE]: () => jsonResponse(201, created),
    [SEND]: () => jsonResponse(202, sent),
    [CANCEL]: () =>
      jsonResponse(200, {
        roundId: ROUND_ID,
        status: 'cancelled',
        cancelled: 3,
        signedUntouched: 0,
      }),
    ...routes,
  });
}

async function toSettings(result: Rendered) {
  await toRecipients(result);
  await chooseAll(result);
  await toSummary(result);
  await result.user.click(nextButton());
  await stepTitle(texts.settings.title);
  await screen.findByLabelText(texts.settings.linkExpiryDays, { exact: false });
}

async function toSend(result: Rendered) {
  await toSettings(result);
  await result.user.click(nextButton());
  await stepTitle(texts.preview.title);
  await result.user.click(nextButton());
  await stepTitle(texts.send.title);
}

/** Opens the confirmation and confirms (twice, as a quick double click would). */
async function confirmSend({ user }: Rendered, clicks = 1) {
  await user.click(screen.getByRole('button', { name: texts.send.send }));
  const dialog = await screen.findByRole('dialog', { name: texts.send.confirmTitle });
  const confirm = within(dialog).getByRole('button', { name: texts.send.confirm });
  for (let i = 0; i < clicks; i += 1) await user.click(confirm);
}

const sendBodies = (mock: FetchMock) =>
  callsTo(mock, SEND).map(([, init]) => JSON.parse(text(init?.body)) as unknown);

describe('NewRoundPage (A5): step 5 settings', () => {
  it('prefills from the settings, shows the send-day expiry, checks, sends all four values', async () => {
    const mock = stubB();
    const result = await openWizard();
    await toSettings(result);

    const days = screen.getByLabelText(texts.settings.linkExpiryDays, { exact: false });
    expect(days).toHaveValue('60');
    expect(
      screen.getByLabelText(texts.settings.reminderIntervalDays, { exact: false }),
    ).toHaveValue('3');
    expect(screen.getByRole('radio', { name: texts.settings.unlimited })).toBeChecked();
    expect(screen.getByTestId('expiry-example')).toHaveTextContent(
      texts.settings.expiryExample(formatDate(linkExpiresAtFrom(new Date(), 60))),
    );

    await result.user.clear(days);
    await result.user.type(days, '400');
    await result.user.click(nextButton());
    expect(await screen.findByText(texts.settings.between(1, 365))).toBeInTheDocument();
    await stepTitle(texts.settings.title);

    await result.user.clear(days);
    await result.user.type(days, '30');
    await result.user.click(screen.getByRole('radio', { name: texts.settings.limited }));
    await result.user.type(
      screen.getByLabelText(texts.settings.maxReminders, { exact: false }),
      '4',
    );
    await result.user.click(nextButton());
    await stepTitle(texts.preview.title);
    await result.user.click(nextButton());
    await stepTitle(texts.send.title);
    await confirmSend(result);
    await stepTitle(texts.done.title);

    expect(bodyOf(mock, CREATE)).toEqual({
      ...(bodyOf(mock, PREVIEW) as object),
      name: 'חוזה שנתי',
      settings: {
        remindersEnabled: true,
        reminderIntervalDays: 3,
        maxReminders: 4,
        linkExpiryDays: 30,
      },
    });
    expect(callsTo(mock, 'GET /api/settings')).toHaveLength(1);
  });
});

describe('NewRoundPage (A5): step 6 preview', () => {
  it('draws the sample document once, warnings by code, and the email in a sandboxed frame', async () => {
    const mock = stubB();
    const result = await openWizard();
    await toSettings(result);
    await result.user.click(nextButton());
    await stepTitle(texts.preview.title);

    expect(await screen.findByText(texts.preview.pageLabel(1, 1))).toBeInTheDocument();
    const warnings = await screen.findByTestId('preview-warnings');
    expect(warnings).toHaveTextContent(TEMPLATE_PREVIEW_WARNINGS.TEXT_TOO_LONG);
    expect(document.body.textContent).not.toContain('text from the server');
    expect(screen.getByText('כתובת')).toBeInTheDocument();

    const frame = await screen.findByTitle(texts.preview.emailFrameTitle);
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('srcdoc')).toContain('example-link');
    expect(screen.getByTestId('email-subject')).toHaveTextContent('מסמך לחתימה: חוזה');

    // Once each (every call writes an audit row): no refetch on focus.
    window.dispatchEvent(new Event('focus'));
    expect(callsTo(mock, PDF)).toHaveLength(1);
    expect(callsTo(mock, CHECK)).toHaveLength(1);
    expect(callsTo(mock, EMAIL)).toHaveLength(1);
  });

  it('a picked employee: the id in the request only, no ID number or email on screen', async () => {
    const forEmployee = `?employeeId=${EMPLOYEE_ID}`;
    const mock = stubB({
      [`${PDF}${forEmployee}`]: () =>
        new Response(new Uint8Array([37, 80, 68, 70]), {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        }),
      [`${CHECK}${forEmployee}`]: () =>
        jsonResponse(200, { sample: false, missing: [], leftForEmployee: [], warnings: [] }),
    });
    const result = await openWizard();
    await toSettings(result);
    await result.user.click(nextButton());
    await stepTitle(texts.preview.title);

    await result.user.click(screen.getByRole('radio', { name: texts.preview.specific }));
    await result.user.type(
      screen.getByRole('searchbox', { name: he.filters.search }),
      'עובדת{Enter}',
    );
    await result.user.click(await screen.findByRole('button', { name: /הצגה עבור עובדת לדוגמה/ }));
    expect(await screen.findByText(texts.preview.noIssues)).toBeInTheDocument();
    expect(callsTo(mock, `${PDF}${forEmployee}`)).toHaveLength(1);
    expect(screen.getByText(texts.preview.showingFor('עובדת לדוגמה'))).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(card.idNumber);
    expect(document.body.textContent).not.toContain(card.email ?? '@');
  });
});

describe('NewRoundPage (A5): step 7 send', () => {
  it('a double click creates and sends once; the done screen; no leave warning after', async () => {
    const mock = stubB({
      'GET /api/dashboard/summary': () => apiErrorResponse(500, 'INTERNAL_ERROR'),
    });
    const result = await openWizard();
    await toSend(result);
    expect(screen.queryByRole('button', { name: texts.next })).not.toBeInTheDocument();

    await result.user.click(screen.getByRole('button', { name: texts.send.send }));
    const dialog = await screen.findByRole('dialog', { name: texts.send.confirmTitle });
    const { willSendEmail, inRound } = report().counts;
    expect(dialog).toHaveTextContent(texts.send.confirmText(inRound, willSendEmail, String));
    const confirm = within(dialog).getByRole('button', { name: texts.send.confirm });
    await Promise.all([result.user.click(confirm), result.user.click(confirm)]);

    await stepTitle(texts.done.title);
    expect(callsTo(mock, CREATE)).toHaveLength(1);
    expect(callsTo(mock, SEND)).toHaveLength(1);
    expect(sendBodies(mock)).toEqual([{ confirmOutdatedTemplateIds: [] }]);
    expect(tile('queued')).toBe('7');
    expect(screen.getByText(texts.done.expiry(formatDate(sent.linkExpiresAt)))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: texts.done.toRound })).toHaveAttribute(
      'href',
      `/rounds/${ROUND_ID}`,
    );

    await result.user.click(screen.getByRole('link', { name: he.nav.dashboard }));
    await waitFor(() => expect(result.router.state.location.pathname).toBe('/'));
  });

  it.each([
    ['no answer', networkError],
    ['a 500', () => apiErrorResponse(500, 'INTERNAL_ERROR')],
    ['a page that is not ours', () => new Response('<html>blocked</html>', { status: 418 })],
  ])(
    'create gets %s: "may exist as a draft", the summary again, no retry',
    async (_label, answer) => {
      const mock = stubB({ [CREATE]: answer });
      const result = await openWizard();
      await toSend(result);
      await confirmSend(result);

      await stepTitle(texts.summary.title);
      const notice = await screen.findByTestId('round-maybe-created');
      expect(notice).toHaveTextContent(texts.send.maybeCreated);
      expect(within(notice).getByRole('link', { name: texts.send.draftsLink })).toHaveAttribute(
        'href',
        '/rounds?status=draft',
      );
      await waitFor(() => expect(callsTo(mock, PREVIEW)).toHaveLength(2));
      expect(callsTo(mock, CREATE)).toHaveLength(1);
      expect(callsTo(mock, SEND)).toHaveLength(0);
    },
  );

  it('create 409 ROUND_CANNOT_BE_CREATED: nothing made, back to a fresh summary', async () => {
    const mock = stubB({ [CREATE]: () => apiErrorResponse(409, 'ROUND_CANNOT_BE_CREATED') });
    const result = await openWizard();
    await toSend(result);
    await confirmSend(result);

    await stepTitle(texts.summary.title);
    expect(await screen.findByText(texts.send.notCreatedSummary)).toBeInTheDocument();
    await waitFor(() => expect(callsTo(mock, PREVIEW)).toHaveLength(2));
    // Nothing was created: "back" is still there.
    expect(screen.getByRole('button', { name: texts.back })).toBeInTheDocument();
  });

  it('create 400: nothing made, the error here, send again allowed', async () => {
    const mock = stubB({ [CREATE]: () => apiErrorResponse(400, 'VALIDATION_FAILED') });
    const result = await openWizard();
    await toSend(result);
    await confirmSend(result);

    expect(await screen.findByText(texts.send.notCreated)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('text from the server');
    expect(screen.getByRole('button', { name: texts.send.send })).toBeEnabled();
    expect(callsTo(mock, SEND)).toHaveLength(0);
  });

  it('outdated template: the panel, then "send the round\'s version" confirms every id', async () => {
    const outdated = {
      id: readyTemplate.id,
      name: 'חוזה',
      version: 1,
      reason: 'newer_version',
      newestVersion: 2,
      assignmentCount: 3,
    };
    let sends = 0;
    const mock = stubB({
      [SEND]: () => {
        sends += 1;
        return sends === 1
          ? errorWith(409, 'ROUND_TEMPLATE_OUTDATED', { templates: [outdated] })
          : jsonResponse(202, sent);
      },
    });
    const result = await openWizard();
    await toSend(result);
    await confirmSend(result);

    const panel = await screen.findByTestId('round-outdated');
    expect(panel).toHaveTextContent(texts.send.outdatedReasons.newer_version(2));
    expect(screen.queryByRole('button', { name: texts.back })).not.toBeInTheDocument();
    // The confirmation closes first (the page behind it is hidden until then).
    await result.user.click(
      await within(panel).findByRole('button', { name: texts.send.sendOutdated }),
    );

    await stepTitle(texts.done.title);
    expect(callsTo(mock, CREATE)).toHaveLength(1);
    expect(sendBodies(mock)).toEqual([
      { confirmOutdatedTemplateIds: [] },
      { confirmOutdatedTemplateIds: [readyTemplate.id] },
    ]);
  });

  it('not ready → the draft panel; a retry that finds it sent says so, never creates again', async () => {
    let sends = 0;
    const mock = stubB({
      [SEND]: () => {
        sends += 1;
        if (sends === 1) {
          return errorWith(409, 'ROUND_TEMPLATE_NOT_READY', {
            templates: [
              {
                id: readyTemplate.id,
                name: 'חוזה',
                version: 1,
                reasons: [{ code: 'NO_MAIN_SIGNATURE', message: 'x', keys: [] }],
              },
            ],
          });
        }
        return errorWith(409, 'ROUND_NOT_DRAFT', { status: 'sending' });
      },
    });
    const result = await openWizard();
    await toSend(result);
    await confirmSend(result);

    const panel = await screen.findByTestId('round-draft');
    expect(panel).toHaveTextContent(texts.send.draftTitle);
    expect(panel).not.toHaveTextContent('text from the server');
    await result.user.click(await within(panel).findByRole('button', { name: texts.send.retry }));

    expect(await screen.findByText(texts.send.alreadySent, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: texts.send.toRound })).toHaveAttribute(
      'href',
      `/rounds/${ROUND_ID}`,
    );
    expect(callsTo(mock, CREATE)).toHaveLength(1);
    expect(callsTo(mock, SEND)).toHaveLength(2);
  });

  it('a failed send keeps the draft: leave warns about it; cancel it → a fresh summary', async () => {
    const mock = stubB({
      [SEND]: networkError,
      'GET /api/dashboard/summary': () => apiErrorResponse(500, 'INTERNAL_ERROR'),
    });
    const result = await openWizard();
    await toSend(result);
    await confirmSend(result);
    const panel = await screen.findByTestId('round-draft');

    await result.user.click(await screen.findByRole('link', { name: he.nav.dashboard }));
    const leave = await screen.findByRole('dialog', { name: texts.leaveTitle });
    expect(leave).toHaveTextContent(texts.leaveDraftText);
    await result.user.click(within(leave).getByRole('button', { name: texts.stay }));

    await result.user.click(
      await within(panel).findByRole('button', { name: texts.send.cancelDraft }),
    );
    const dialog = await screen.findByRole('dialog', { name: texts.send.cancelTitle });
    await result.user.click(within(dialog).getByRole('button', { name: texts.send.cancelDraft }));

    await stepTitle(texts.summary.title);
    expect(await screen.findByText(texts.send.cancelled)).toBeInTheDocument();
    expect(callsTo(mock, CANCEL)).toHaveLength(1);
    await waitFor(() => expect(callsTo(mock, PREVIEW)).toHaveLength(2));
    expect(callsTo(mock, CREATE)).toHaveLength(1);
  });
});
