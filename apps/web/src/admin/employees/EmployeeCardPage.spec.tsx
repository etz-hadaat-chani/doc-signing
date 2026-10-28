import { NO_EMAIL_REASONS, STATUS_LABELS } from '@doc-signing/shared';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, officerUser, renderRoutes } from '../../test/render';
import {
  card,
  EMPLOYEE_ID,
  history,
  page,
  SENT_ASSIGNMENT_ID,
  SIGNED_ASSIGNMENT_ID,
} from './employees.fixtures';

const CARD = `GET /api/employees/${EMPLOYEE_ID}`;
const HISTORY = `GET /api/employees/${EMPLOYEE_ID}/assignments?page=1&pageSize=25`;
const fields = he.employees.fields;

function stubCard(user = managerUser, answers: Record<string, () => Response> = {}) {
  return stubApi({
    'GET /api/auth/me': meAnswer(user),
    [CARD]: () => jsonResponse(200, card),
    [HISTORY]: () => jsonResponse(200, page(history)),
    ...answers,
  });
}

async function openCard() {
  const result = renderRoutes(`/employees/${EMPLOYEE_ID}`);
  await screen.findByRole('heading', { level: 1, name: 'עובדת לדוגמה' }, { timeout: 5000 });
  return result;
}

/** The value shown under a label in the details list. */
function detail(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: 'dt' });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`no value for ${label}`);
  return value;
}

describe('EmployeeCardPage (A7)', () => {
  it('shows every detail of FR-EMP-7, formatted', async () => {
    stubCard();
    await openCard();

    expect(detail(fields.employeeNumber)).toHaveTextContent('9001');
    expect(detail(fields.idNumber)).toHaveTextContent('000000018');
    expect(detail(fields.department)).toHaveTextContent('15 - מחלקה לדוגמה א');
    expect(detail(fields.email)).toHaveTextContent('sample@example.test');
    expect(detail(fields.email)).toHaveTextContent(he.employees.emailValid);
    expect(detail(fields.landline)).toHaveTextContent('02-1234567');
    expect(detail(fields.mobile)).toHaveTextContent('050-1234567');
    expect(within(detail(fields.mobile)).getByText('050-1234567')).toHaveAttribute('dir', 'ltr');
    expect(detail(fields.address)).toHaveTextContent('רחוב לדוגמה 1');
    expect(detail(fields.city)).toHaveTextContent('עיר לדוגמה');
    expect(detail(fields.birthDate)).toHaveTextContent('03/05/1980 (גיל 46)');
    expect(detail(fields.jobTitle)).toHaveTextContent('תפקיד לדוגמה');
    expect(detail(fields.employmentStatus)).toHaveTextContent('קבוע');
    expect(detail(fields.jobPercent)).toHaveTextContent('62.5%');
    expect(detail(fields.workDays)).toHaveTextContent('א-ה');
    expect(detail(fields.hoursBaseCode)).toHaveTextContent('42 שעות');
    expect(detail(fields.pensionFundA)).toHaveTextContent('קופה א לדוגמה');
    expect(detail(fields.pensionFundB)).toHaveTextContent(he.employees.emptyValue);
    expect(detail(fields.studyFund)).toHaveTextContent('קרן לדוגמה');
  });

  it('shows the email status without an address, and the hours code when unknown', async () => {
    stubCard(managerUser, {
      [CARD]: () =>
        jsonResponse(200, {
          ...card,
          email: null,
          emailStatus: 'missing',
          hoursBaseCode: 2,
          hoursBaseLabel: '2',
          birthDate: null,
          age: null,
          isActive: false,
        }),
    });
    await openCard();
    expect(detail(fields.email)).toHaveTextContent(NO_EMAIL_REASONS.missing);
    expect(detail(fields.hoursBaseCode)).toHaveTextContent('2');
    expect(detail(fields.birthDate)).toHaveTextContent(he.employees.emptyValue);
    expect(screen.getByText(he.employees.inactive)).toBeInTheDocument();
  });

  it('lists the history: status, round link, and the document link only when signed', async () => {
    stubCard();
    await openCard();
    const table = await screen.findByRole('table', { name: he.employees.history.title });

    const signed = within(table).getByRole('row', { name: /סבב לדוגמה/ });
    expect(within(signed).getByRole('link', { name: 'סבב לדוגמה' })).toHaveAttribute(
      'href',
      `/rounds/${history[0]?.round.id ?? ''}`,
    );
    expect(within(signed).getByText(STATUS_LABELS.signed)).toBeInTheDocument();
    expect(signed).toHaveTextContent('מסמך לדוגמה (גרסה 2)');
    expect(signed).toHaveTextContent('02/09/2026');
    const document = within(signed).getByRole('link', { name: he.employees.history.openDocument });
    expect(document).toHaveAttribute('href', `/api/assignments/${SIGNED_ASSIGNMENT_ID}/document`);
    expect(document).toHaveAttribute('target', '_blank');
    expect(document).toHaveAttribute('rel', 'noreferrer');

    const sent = within(table).getByRole('row', { name: /סבב ישן/ });
    expect(within(sent).getByText(STATUS_LABELS.sent)).toBeInTheDocument();
    expect(
      within(sent).queryByRole('link', { name: he.employees.history.openDocument }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(SENT_ASSIGNMENT_ID)).not.toBeInTheDocument();
  });

  it('keeps the details when the history fails', async () => {
    stubCard(managerUser, { [HISTORY]: () => apiErrorResponse(400, 'BAD_REQUEST') });
    await openCard();
    expect(await screen.findByRole('button', { name: he.feedback.retry })).toBeInTheDocument();
    expect(detail(fields.city)).toHaveTextContent('עיר לדוגמה');
  });

  it('a manager gets "edit"', async () => {
    stubCard();
    await openCard();
    expect(screen.getByRole('link', { name: he.employees.edit })).toHaveAttribute(
      'href',
      `/employees/${EMPLOYEE_ID}/edit`,
    );
  });

  it('"send document" opens the wizard with the employee in router state, not the address', async () => {
    stubCard();
    const result = await openCard();
    await result.user.click(screen.getByRole('button', { name: he.employees.card.sendDocument }));
    await screen.findByRole('heading', { level: 1, name: he.nav.newRound }, { timeout: 5000 });
    expect(result.router.state.location.pathname).toBe('/rounds/new');
    expect(result.router.state.location.search).toBe('');
  });

  it('no "send document" for an inactive employee or an officer', async () => {
    stubCard(managerUser, { [CARD]: () => jsonResponse(200, { ...card, isActive: false }) });
    await openCard();
    expect(screen.getByRole('link', { name: he.employees.edit })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: he.employees.card.sendDocument }),
    ).not.toBeInTheDocument();
  });

  it('an officer sees the card without the ID number and without "edit"', async () => {
    // JSON leaves the undefined field out, as the API does for officers.
    stubCard(officerUser, { [CARD]: () => jsonResponse(200, { ...card, idNumber: undefined }) });
    await openCard();
    expect(screen.queryByText(fields.idNumber, { selector: 'dt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: he.employees.edit })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: he.employees.card.sendDocument }),
    ).not.toBeInTheDocument();
    expect(detail(fields.city)).toHaveTextContent('עיר לדוגמה');
  });

  it('an unknown employee shows "not found"', async () => {
    stubCard(managerUser, { [CARD]: () => apiErrorResponse(404, 'NOT_FOUND') });
    renderRoutes(`/employees/${EMPLOYEE_ID}`);
    expect(
      await screen.findByRole('heading', { name: he.feedback.notFoundTitle }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('a broken address shows "not found" without asking the API', async () => {
    const fetchMock = stubCard();
    renderRoutes('/employees/not-a-uuid');
    await screen.findByRole('heading', { name: he.feedback.notFoundTitle }, { timeout: 5000 });
    expect(fetchMock.mock.calls.map(([url]) => (typeof url === 'string' ? url : ''))).toEqual([
      '/api/auth/me',
    ]);
  });
});
