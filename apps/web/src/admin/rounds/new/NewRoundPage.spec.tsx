import {
  NO_EMAIL_REASONS,
  type RecipientsPreviewReport,
  ROUND_PREVIEW_BLOCKERS,
  STATUS_LABELS,
  TEMPLATE_NOT_READY_MESSAGES,
} from '@doc-signing/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../../test/fetch-stub';
import { managerUser, meAnswer, renderRoutes } from '../../../test/render';
import { card, DEPARTMENTS, EMPLOYEE_ID, listItem, page } from '../../employees/employees.fixtures';
import { readyTemplate, template } from '../../templates/templates.fixtures';
import { byDepartmentReport, DEPT_15, DEPT_19, report, TEMPLATE_B_ID } from './rounds.fixtures';

const texts = he.newRound;
const PREVIEW = 'POST /api/rounds/recipients-preview';
const SEARCH = 'POST /api/employees/search';
const TEMPLATES = 'GET /api/templates?page=1&pageSize=100';
const notReady = { ...template, id: TEMPLATE_B_ID, name: 'תבנית חלקית' };

type Answer = (init: RequestInit) => Response | Promise<Response>;

function stub(routes: Record<string, Answer> = {}) {
  return stubApi({
    'GET /api/auth/me': meAnswer(managerUser),
    'GET /api/departments': () => jsonResponse(200, { items: DEPARTMENTS }),
    [TEMPLATES]: () => jsonResponse(200, page([readyTemplate, notReady])),
    [SEARCH]: () => jsonResponse(200, page([listItem])),
    [PREVIEW]: () => jsonResponse(200, report()),
    [`GET /api/employees/${EMPLOYEE_ID}`]: () => jsonResponse(200, card),
    ...routes,
  });
}

type FetchMock = ReturnType<typeof stub>;

const callsTo = (mock: FetchMock, route: string) =>
  mock.mock.calls.filter(
    ([url, init]) => `${init?.method ?? 'GET'} ${typeof url === 'string' ? url : ''}` === route,
  );

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const bodyOf = (mock: FetchMock, route: string, index = 0): unknown =>
  JSON.parse(text(callsTo(mock, route)[index]?.[1]?.body));

type Rendered = ReturnType<typeof renderRoutes>;

async function openWizard(entry: Parameters<typeof renderRoutes>[0] = '/rounds/new') {
  const result = renderRoutes(entry);
  await screen.findByRole('heading', { level: 1, name: he.nav.newRound }, { timeout: 5000 });
  return result;
}

const nextButton = () => screen.getByRole('button', { name: texts.next });
const stepTitle = (name: string) => screen.findByRole('heading', { level: 2, name });

async function toDocument({ user }: Rendered, mode?: 'by_department') {
  await user.type(screen.getByLabelText(texts.name.label, { exact: false }), 'חוזה שנתי');
  if (mode)
    await user.click(screen.getByRole('radio', { name: new RegExp(texts.name.modes[mode]) }));
  await user.click(nextButton());
  await stepTitle(texts.document.title);
}

async function toRecipients(result: Rendered) {
  await toDocument(result);
  await result.user.click(
    await screen.findByRole('radio', { name: new RegExp(readyTemplate.name) }),
  );
  await result.user.click(nextButton());
  await stepTitle(texts.recipients.title);
}

async function chooseAll({ user }: Rendered) {
  await user.click(screen.getByRole('checkbox', { name: texts.recipients.all }));
}

async function toSummary(result: Rendered) {
  await result.user.click(nextButton());
  await stepTitle(texts.summary.title);
  await screen.findByRole('list', { name: texts.summary.countsLabel });
}

function tile(key: string) {
  const element = document.querySelector(`[data-count="${key}"] [data-value]`);
  return element?.textContent;
}

describe('NewRoundPage (A5): steps 1–3', () => {
  it('each "next" checks its own step: name, then a ready template, then recipients', async () => {
    stub();
    const result = await openWizard();
    await result.user.click(nextButton());
    expect(await screen.findByText(texts.problems.nameRequired)).toBeInTheDocument();

    await toDocument(result);
    await result.user.click(nextButton());
    expect(await screen.findByText(texts.problems.templateRequired)).toBeInTheDocument();
    // A template that isn't ready can't be chosen, and says why (our text by code).
    expect(await screen.findByRole('radio', { name: new RegExp(notReady.name) })).toBeDisabled();
    expect(screen.getByText(TEMPLATE_NOT_READY_MESSAGES.NO_MAIN_SIGNATURE)).toBeInTheDocument();

    await result.user.click(screen.getByRole('radio', { name: new RegExp(readyTemplate.name) }));
    await result.user.click(nextButton());
    await stepTitle(texts.recipients.title);
    await result.user.click(nextButton());
    expect(await screen.findByText(texts.problems.recipientsRequired)).toBeInTheDocument();
  });

  it('by department: no template list, the choice comes in the summary', async () => {
    const mock = stub();
    const result = await openWizard();
    await toDocument(result, 'by_department');
    expect(screen.getByText(texts.document.byDepartment)).toBeInTheDocument();
    expect(callsTo(mock, TEMPLATES)).toHaveLength(0);
    await result.user.click(nextButton());
    await stepTitle(texts.recipients.title);
  });

  it('going back keeps everything entered', async () => {
    stub();
    const result = await openWizard();
    await toRecipients(result);
    await chooseAll(result);
    await result.user.click(screen.getByRole('button', { name: texts.back }));
    await stepTitle(texts.document.title);
    expect(
      await screen.findByRole('radio', { name: new RegExp(readyTemplate.name) }),
    ).toBeChecked();
    await result.user.click(screen.getByRole('button', { name: texts.back }));
    expect(screen.getByLabelText(texts.name.label, { exact: false })).toHaveValue('חוזה שנתי');
    await result.user.click(nextButton());
    await result.user.click(nextButton());
    expect(screen.getByRole('checkbox', { name: texts.recipients.all })).toBeChecked();
  });
});

describe('NewRoundPage (A5): employee picker', () => {
  it('searches in a POST body only, shows no ID number or email, keeps picks across searches', async () => {
    const mock = stub();
    const result = await openWizard();
    await toRecipients(result);

    await result.user.type(screen.getByRole('searchbox', { name: he.filters.search }), '000000018');
    const results = await screen.findByRole('table', { name: texts.recipients.resultsCaption });
    expect(bodyOf(mock, SEARCH)).toEqual({ q: '000000018', page: 1, pageSize: 10 });
    for (const [url] of mock.mock.calls) expect(text(url)).not.toContain('000000018');

    await result.user.click(await within(results).findByRole('button', { name: /עובדת לדוגמה/ }));
    expect(within(results).getByRole('button', { name: texts.recipients.added })).toBeDisabled();

    // A new search keeps the employee already picked.
    const search = screen.getByRole('searchbox', { name: he.filters.search });
    await result.user.clear(search);
    await result.user.type(search, 'אחר{Enter}');
    await waitFor(() => expect(callsTo(mock, SEARCH).length).toBeGreaterThan(1));
    const picked = screen.getByRole('table', { name: texts.recipients.pickedCaption });
    expect(within(picked).getByText('עובדת לדוגמה')).toBeInTheDocument();
    expect(screen.getByText(texts.recipients.pickedCount(1, '1'))).toBeInTheDocument();

    expect(document.body.textContent).not.toContain(listItem.email ?? '@');
    expect(document.body.textContent).not.toContain(card.idNumber);
  });

  it("an inactive employee can be picked, with a note that they won't be added", async () => {
    stub({ [SEARCH]: () => jsonResponse(200, page([{ ...listItem, isActive: false }])) });
    const result = await openWizard();
    await toRecipients(result);
    await result.user.type(
      screen.getByRole('searchbox', { name: he.filters.search }),
      'עובדת{Enter}',
    );
    await result.user.click(await screen.findByRole('button', { name: /הוספת עובדת לדוגמה/ }));
    expect(await screen.findByText(texts.recipients.inactivePicked(1, '1'))).toBeInTheDocument();
  });

  it('removes a picked employee', async () => {
    stub();
    const result = await openWizard();
    await toRecipients(result);
    await result.user.type(
      screen.getByRole('searchbox', { name: he.filters.search }),
      'עובדת{Enter}',
    );
    await result.user.click(await screen.findByRole('button', { name: /הוספת עובדת לדוגמה/ }));
    await result.user.click(screen.getByRole('button', { name: /הסרת עובדת לדוגמה/ }));
    expect(screen.getByText(texts.recipients.nonePicked)).toBeInTheDocument();
  });
});

describe('NewRoundPage (A5): summary', () => {
  it('sends the mixed choice once, on entering the summary, and shows the counts', async () => {
    const mock = stub();
    const result = await openWizard();
    await toRecipients(result);
    await chooseAll(result);
    await result.user.click(screen.getByRole('combobox', { name: he.departmentPicker.label }));
    await result.user.click(await screen.findByRole('option', { name: '15 - מחלקה לדוגמה א' }));
    await result.user.keyboard('{Escape}');
    await result.user.type(
      screen.getByRole('searchbox', { name: he.filters.search }),
      'עובדת{Enter}',
    );
    await result.user.click(await screen.findByRole('button', { name: /הוספת עובדת לדוגמה/ }));
    await toSummary(result);

    expect(callsTo(mock, PREVIEW)).toHaveLength(1);
    expect(bodyOf(mock, PREVIEW)).toEqual({
      mode: 'single_template',
      templateId: readyTemplate.id,
      recipients: { all: true, departmentIds: [DEPT_15.id], employeeIds: [EMPLOYEE_ID] },
      alreadySigned: 'skip',
    });
    expect(tile('willSendEmail')).toBe('1');
    expect(tile('inRound')).toBe('3');
    expect(tile('inactive')).toBe('1');
    expect(screen.getByText(texts.summary.canCreate)).toBeInTheDocument();
    expect(nextButton()).toBeEnabled();

    // Back and in again with the same choice: no new call (each one writes an audit row).
    await result.user.click(screen.getByRole('button', { name: texts.back }));
    await stepTitle(texts.recipients.title);
    await toSummary(result);
    expect(callsTo(mock, PREVIEW)).toHaveLength(1);

    // Window focus or a shown tab never asks again: no polling.
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(callsTo(mock, PREVIEW)).toHaveLength(1);
    const queries = result.queryClient.getQueryCache().getAll();
    for (const query of queries) {
      expect((query.options as { refetchInterval?: unknown }).refetchInterval).toBeUndefined();
    }
  });

  it('"refresh" asks once more; skip / send again makes it stale until "update"', async () => {
    const mock = stub({
      [PREVIEW]: (init) => {
        const body = JSON.parse(text(init.body)) as { alreadySigned: 'skip' | 'send_again' };
        return jsonResponse(200, report({ alreadySigned: body.alreadySigned }));
      },
    });
    const result = await openWizard();
    await toRecipients(result);
    await chooseAll(result);
    await toSummary(result);

    await result.user.click(screen.getByRole('button', { name: texts.summary.refresh }));
    await waitFor(() => expect(callsTo(mock, PREVIEW)).toHaveLength(2));

    await result.user.click(
      screen.getByRole('radio', { name: texts.summary.alreadySignedChoices.send_again }),
    );
    expect(await screen.findByText(texts.summary.stale)).toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
    expect(callsTo(mock, PREVIEW)).toHaveLength(2);

    await result.user.click(screen.getByRole('button', { name: texts.summary.update }));
    await waitFor(() => expect(callsTo(mock, PREVIEW)).toHaveLength(3));
    expect(bodyOf(mock, PREVIEW, 2)).toMatchObject({ alreadySigned: 'send_again' });
    await waitFor(() => expect(screen.queryByText(texts.summary.stale)).not.toBeInTheDocument());
    expect(nextButton()).toBeEnabled();
  });

  it('by department: blockers in our Hebrew disable "next"; the choice is sent after "update"', async () => {
    const chosen: RecipientsPreviewReport = (() => {
      const base = byDepartmentReport();
      return {
        ...base,
        canCreate: true,
        blockers: [],
        departments: base.departments.map((department) =>
          department.id === DEPT_19.id
            ? { ...department, status: 'ready', template: department.options[1] ?? null }
            : department,
        ),
      };
    })();
    let calls = 0;
    const mock = stub({
      [PREVIEW]: () => {
        calls += 1;
        return jsonResponse(200, calls === 1 ? byDepartmentReport() : chosen);
      },
    });
    const result = await openWizard();
    await toDocument(result, 'by_department');
    await result.user.click(nextButton());
    await stepTitle(texts.recipients.title);
    await chooseAll(result);
    await toSummary(result);

    const blockers = screen.getByTestId('round-blockers');
    expect(blockers).toHaveTextContent(ROUND_PREVIEW_BLOCKERS.DEPARTMENT_TEMPLATE_CHOICE_NEEDED);
    expect(blockers).not.toHaveTextContent('text from the server');
    expect(screen.getByTestId('round-warnings')).toHaveTextContent('15 - מחלקה לדוגמה א');
    expect(screen.getByText(TEMPLATE_NOT_READY_MESSAGES.NO_MAIN_SIGNATURE)).toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
    expect(tile('waitingForChoice')).toBe('2');

    await result.user.click(
      screen.getByRole('combobox', { name: texts.summary.chooseTemplate('19 - מחלקה לדוגמה ב') }),
    );
    await result.user.click(await screen.findByRole('option', { name: 'חוזה אחר (גרסה 2)' }));
    expect(await screen.findByText(texts.summary.stale)).toBeInTheDocument();
    await result.user.click(screen.getByRole('button', { name: texts.summary.update }));
    await waitFor(() => expect(callsTo(mock, PREVIEW)).toHaveLength(2));
    expect(bodyOf(mock, PREVIEW, 1)).toMatchObject({
      mode: 'by_department',
      departmentTemplates: [{ departmentId: DEPT_19.id, templateId: TEMPLATE_B_ID }],
    });
    await waitFor(() => expect(nextButton()).toBeEnabled());
  });

  it('lists: one tab per list, reasons by code, "and N more" when cut', async () => {
    const data = report();
    stub({
      [PREVIEW]: () =>
        jsonResponse(200, {
          ...data,
          lists: {
            ...data.lists,
            noEmail: { ...data.lists.noEmail, total: 501, truncated: true },
            alreadyOpen: {
              total: 1,
              truncated: false,
              items: [
                {
                  ...(data.lists.inactivePicked.items[0] ?? data.lists.noEmail.items[0]),
                  roundId: DEPT_19.id,
                  roundName: 'סבב פתוח',
                  status: 'sent',
                },
              ],
            },
          },
        }),
    });
    const result = await openWizard();
    await toRecipients(result);
    await chooseAll(result);
    await toSummary(result);

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual([
      'חסרים פרטים (1)',
      'ללא מייל (501)',
      'כבר חתמו (1)',
      'פתוח בסבב אחר (1)',
      'לא פעילים שנבחרו (1)',
    ]);
    expect(screen.getByText('כתובת, טלפון נייד')).toBeInTheDocument();

    await result.user.click(screen.getByRole('tab', { name: /ללא מייל/ }));
    expect(screen.getByText(NO_EMAIL_REASONS.bounced)).toBeInTheDocument();
    expect(screen.getByText(texts.summary.moreRows('500'))).toBeInTheDocument();

    await result.user.click(screen.getByRole('tab', { name: /כבר חתמו/ }));
    expect(screen.getByText('02/09/2026')).toBeInTheDocument();
    expect(screen.getByText('סבב קודם')).toBeInTheDocument();

    await result.user.click(screen.getByRole('tab', { name: /פתוח בסבב אחר/ }));
    expect(screen.getByText('סבב פתוח')).toBeInTheDocument();
    expect(screen.getByText(STATUS_LABELS.sent)).toBeInTheDocument();
  });

  it('a failed preview shows the error with a retry', async () => {
    let fail = true;
    stub({
      [PREVIEW]: () =>
        fail ? apiErrorResponse(500, 'INTERNAL_ERROR') : jsonResponse(200, report()),
    });
    const result = await openWizard();
    await toRecipients(result);
    await chooseAll(result);
    await result.user.click(nextButton());
    expect(await screen.findByRole('heading', { name: texts.summary.failed })).toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
    fail = false;
    await result.user.click(screen.getByRole('button', { name: he.feedback.retry }));
    await screen.findByRole('list', { name: texts.summary.countsLabel });
  });
});

describe('NewRoundPage (A5): preselected employee and leaving', () => {
  it('takes the employee from router state, shows no ID number, and clears the state', async () => {
    const mock = stub();
    const result = await openWizard({
      pathname: '/rounds/new',
      state: { employeeId: EMPLOYEE_ID },
    });
    await waitFor(() => expect(result.router.state.location.state).toBeNull());
    expect(result.router.state.location.search).toBe('');
    expect(callsTo(mock, `GET /api/employees/${EMPLOYEE_ID}`)).toHaveLength(1);

    await toRecipients(result);
    const picked = await screen.findByRole('table', { name: texts.recipients.pickedCaption });
    expect(within(picked).getByText('עובדת לדוגמה')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(card.idNumber);
    expect(document.body.textContent).not.toContain(card.email ?? '@');

    await toSummary(result);
    expect(bodyOf(mock, PREVIEW)).toMatchObject({
      recipients: { all: false, departmentIds: [], employeeIds: [EMPLOYEE_ID] },
    });
  });

  it('asks before leaving once something was entered', async () => {
    stub({ 'GET /api/dashboard/summary': () => apiErrorResponse(500, 'INTERNAL_ERROR') });
    const result = await openWizard();
    await result.user.type(screen.getByLabelText(texts.name.label, { exact: false }), 'א');
    await result.user.click(screen.getByRole('link', { name: he.nav.dashboard }));
    expect(await screen.findByRole('dialog', { name: texts.leaveTitle })).toBeInTheDocument();
    await result.user.click(screen.getByRole('button', { name: texts.stay }));
    expect(result.router.state.location.pathname).toBe('/rounds/new');
  });

  it('leaves without asking when nothing was entered', async () => {
    stub({ 'GET /api/dashboard/summary': () => apiErrorResponse(500, 'INTERNAL_ERROR') });
    const result = await openWizard();
    await result.user.click(screen.getByRole('link', { name: he.nav.dashboard }));
    await waitFor(() => expect(result.router.state.location.pathname).toBe('/'));
  });
});
