import { STATUS_LABELS } from '@doc-signing/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../i18n/he';
import { jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, renderRoutes } from '../../test/render';
import {
  CORRECTION_ROUND_ID,
  DEPT_B,
  details,
  detailsPath,
  expiredLockedRow,
  paged,
  returnedRow,
  ROUND_ID,
  row,
  searchPath,
  signedRow,
  tablePath,
} from './round-details.fixtures';

const text = he.rounds.table;
const ROWS = [row, signedRow, returnedRow, expiredLockedRow];
const ID_LIKE = /\d{9}/;

type Call = { url: string; method: string; body: unknown };

function stubTable() {
  const fetchMock = stubApi({
    'GET /api/auth/me': meAnswer(managerUser),
    [`GET ${detailsPath}`]: () => jsonResponse(200, details),
    [`GET ${tablePath()}`]: () => jsonResponse(200, paged(ROWS, 60)),
    [`GET ${tablePath('page=2&pageSize=25')}`]: () => jsonResponse(200, paged([row], 60, 2)),
    [`GET ${tablePath('status=sent&status=locked&page=1&pageSize=25')}`]: () =>
      jsonResponse(200, paged([row])),
    [`GET ${tablePath(`dept=${DEPT_B}&page=1&pageSize=25`)}`]: () =>
      jsonResponse(200, paged([row])),
    [`GET ${tablePath('approval=waiting&page=1&pageSize=25')}`]: () =>
      jsonResponse(200, paged([signedRow])),
    [`POST ${searchPath}`]: () => jsonResponse(200, paged([row])),
  });
  const calls = (): Call[] =>
    fetchMock.mock.calls.map(([url, init = {}]) => ({
      url: typeof url === 'string' ? url : '',
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    }));
  return { fetchMock, calls };
}

async function openTable(entry = `/rounds/${ROUND_ID}`) {
  const stub = stubTable();
  const rendered = renderRoutes(entry);
  const table = await screen.findByRole('table', { name: text.caption });
  return { ...rendered, ...stub, table };
}

const rowOf = (number: string) => screen.getByText(number).closest('tr') as HTMLElement;

describe('AssignmentsTable (A4 employee table)', () => {
  it('shows each employee: number, name, department, status, dates and reminders', async () => {
    await openTable();
    await screen.findByText(row.employeeNumber);
    const sent = rowOf(row.employeeNumber);
    expect(within(sent).getByRole('link', { name: 'עובדת לדוגמה' })).toHaveAttribute(
      'href',
      `/employees/${row.employeeId}`,
    );
    expect(sent).toHaveTextContent('15 - מחלקה לדוגמה א');
    expect(sent).toHaveTextContent(STATUS_LABELS.sent);
    expect(sent).toHaveTextContent('04/10/2026');
    expect(sent).toHaveTextContent(text.reminders(1, '04/10/2026'));
  });

  it('a signed row: the email answer with the address given and the "differs" mark', async () => {
    await openTable();
    const signed = rowOf((await screen.findByText(signedRow.employeeNumber)).textContent ?? '');
    expect(signed).toHaveTextContent('מייל');
    expect(signed).toHaveTextContent('given@example.test');
    expect(signed).toHaveTextContent(text.emailDiffers);
  });

  it('opens the signed document on click only, in a new tab without a referrer', async () => {
    const { calls } = await openTable();
    await screen.findByText(signedRow.employeeNumber);
    const links = screen.getAllByRole('link', { name: text.openDocument });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', `/api/assignments/${signedRow.assignmentId}/document`);
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', 'noreferrer');
    expect(
      within(rowOf(row.employeeNumber)).queryByRole('link', { name: text.openDocument }),
    ).toBeNull();
    expect(calls().some((call) => call.url.includes('/document'))).toBe(false);
  });

  it('a returned row links to the round it was sent again in', async () => {
    await openTable();
    await screen.findByText(returnedRow.employeeNumber);
    const returned = rowOf(returnedRow.employeeNumber);
    expect(returned).toHaveTextContent(STATUS_LABELS.returned_for_correction);
    expect(returned).toHaveTextContent(text.sentAgainIn);
    expect(
      within(returned).getByRole('link', { name: 'תיקון: הצהרת בריאות לדוגמה' }),
    ).toHaveAttribute('href', `/rounds/${CORRECTION_ROUND_ID}`);
  });

  it('shows "locked" next to "expired" when the expiry hides the lock', async () => {
    await openTable();
    await screen.findByText(expiredLockedRow.employeeNumber);
    const expired = rowOf(expiredLockedRow.employeeNumber);
    expect(expired).toHaveTextContent(STATUS_LABELS.expired);
    expect(expired).toHaveTextContent(STATUS_LABELS.locked);
  });

  it('never shows an ID number', async () => {
    const { table } = await openTable();
    await screen.findByText(row.employeeNumber);
    expect(table.textContent).not.toMatch(ID_LIKE);
  });

  it('reads several statuses from the address (the dashboard links ?status=)', async () => {
    const { calls } = await openTable(`/rounds/${ROUND_ID}?status=sent&status=locked`);
    await waitFor(() =>
      expect(calls().map((call) => call.url)).toContain(
        tablePath('status=sent&status=locked&page=1&pageSize=25'),
      ),
    );
    expect(screen.getByRole('combobox', { name: text.statusFilter })).toHaveTextContent(
      `${STATUS_LABELS.sent}, ${STATUS_LABELS.locked}`,
    );
  });

  it('picks several statuses into the address; a filter change goes back to page 1', async () => {
    const { user, router } = await openTable(`/rounds/${ROUND_ID}?page=2`);
    await user.click(screen.getByRole('combobox', { name: text.statusFilter }));
    await user.click(screen.getByRole('option', { name: STATUS_LABELS.sent }));
    await waitFor(() => expect(router.state.location.search).toBe('?status=sent'));
    await user.click(screen.getByRole('option', { name: STATUS_LABELS.locked }));
    await waitFor(() => expect(router.state.location.search).toBe('?status=sent&status=locked'));
    await user.click(screen.getByRole('option', { name: he.filters.all }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('filters by department at send time and by "waiting for approval"', async () => {
    const { user, router, calls } = await openTable();
    await user.click(screen.getByRole('combobox', { name: he.filters.department }));
    await user.click(screen.getByRole('option', { name: '120 - מחלקה לדוגמה ב' }));
    await waitFor(() => expect(router.state.location.search).toBe(`?dept=${DEPT_B}`));
    await user.click(screen.getByRole('checkbox', { name: text.approvalOnly }));
    await waitFor(() =>
      expect(router.state.location.search).toBe(`?dept=${DEPT_B}&approval=waiting`),
    );
    expect(calls().map((call) => call.url)).toContain(
      tablePath(`dept=${DEPT_B}&page=1&pageSize=25`),
    );
  });

  it('search text goes only in a POST body: never in the address or any URL', async () => {
    const { user, router, calls } = await openTable(`/rounds/${ROUND_ID}?page=2`);
    await user.type(screen.getByRole('searchbox', { name: he.filters.search }), '123456782{Enter}');

    // A new search goes back to page 1.
    await waitFor(() =>
      expect(
        calls()
          .filter((call) => call.method === 'POST')
          .at(-1)?.body,
      ).toEqual({
        q: '123456782',
        page: 1,
        pageSize: 25,
      }),
    );
    for (const call of calls().filter((item) => item.method === 'POST')) {
      expect(call.url).toBe(searchPath);
    }
    expect(router.state.location.search).toBe('');
    for (const call of calls()) {
      expect(call.url).not.toContain('123456782');
      expect(call.url).not.toMatch(/[?&]q=/);
    }
  });

  it('a search keeps the filters of the address in its body', async () => {
    const { user, calls } = await openTable(`/rounds/${ROUND_ID}?status=sent&status=locked`);
    await user.type(screen.getByRole('searchbox', { name: he.filters.search }), 'לדוגמה{Enter}');
    await waitFor(() =>
      expect(
        calls()
          .filter((call) => call.method === 'POST')
          .at(-1)?.body,
      ).toEqual({
        status: ['sent', 'locked'],
        q: 'לדוגמה',
        page: 1,
        pageSize: 25,
      }),
    );
  });
});
