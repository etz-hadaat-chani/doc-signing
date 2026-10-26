import { type EmployeeListItem, NO_EMAIL_REASONS } from '@doc-signing/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../i18n/he';
import { jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, officerUser, renderRoutes } from '../../test/render';
import { DEPARTMENTS, listItem, page } from './employees.fixtures';

const LIST = 'GET /api/employees?page=1&pageSize=25';
const SEARCH = 'POST /api/employees/search';

const rows: EmployeeListItem[] = (['valid', 'missing', 'invalid', 'bounced'] as const).map(
  (emailStatus, index) => ({
    ...listItem,
    id: `${listItem.id.slice(0, -1)}${String(index)}`,
    employeeNumber: String(9001 + index),
    firstName: `עובד${String(index)}`,
    emailStatus,
    isActive: index !== 3,
  }),
);

function stubList(user = managerUser, extra: Record<string, () => Response> = {}) {
  return stubApi({
    'GET /api/auth/me': meAnswer(user),
    'GET /api/departments': () => jsonResponse(200, { items: DEPARTMENTS }),
    [LIST]: () => jsonResponse(200, page(rows)),
    [SEARCH]: () => jsonResponse(200, page(rows.slice(0, 1))),
    ...extra,
  });
}

type FetchMock = ReturnType<typeof stubList>;

const urls = (mock: FetchMock) =>
  mock.mock.calls.map(
    ([url, init]) => `${init?.method ?? 'GET'} ${typeof url === 'string' ? url : ''}`,
  );

async function openList(entry = '/employees') {
  const result = renderRoutes(entry);
  await screen.findByRole('heading', { level: 1, name: he.nav.employees }, { timeout: 5000 });
  return result;
}

describe('EmployeesPage (A6)', () => {
  it('shows number, name, department, email status mark and active; no other details', async () => {
    stubList();
    await openList();
    const table = await screen.findByRole('table', { name: he.employees.listCaption });

    const first = within(table).getByRole('row', { name: /9001/ });
    expect(within(first).getByRole('link', { name: 'עובד0 לדוגמה' })).toHaveAttribute(
      'href',
      `/employees/${rows[0]?.id ?? ''}`,
    );
    expect(first).toHaveTextContent('15 - מחלקה לדוגמה א');
    expect(first).toHaveTextContent(he.employees.emailValid);
    expect(first).toHaveTextContent(he.employees.active);

    // Every email status: text and tone (not color alone).
    const marks: [string, string, string][] = [
      ['9001', he.employees.emailValid, 'success'],
      ['9002', NO_EMAIL_REASONS.missing, 'error'],
      ['9003', NO_EMAIL_REASONS.invalid, 'error'],
      ['9004', NO_EMAIL_REASONS.bounced, 'error'],
    ];
    for (const [number, label, tone] of marks) {
      const row = within(table).getByRole('row', { name: new RegExp(number) });
      expect(within(row).getByText(label).closest('[data-tone]')).toHaveAttribute(
        'data-tone',
        tone,
      );
    }
    const inactive = within(table).getByRole('row', { name: /9004/ });
    expect(within(inactive).getByText(he.employees.inactive)).toBeInTheDocument();

    // NFR-PRV-6: not even the email address in the list.
    expect(table).not.toHaveTextContent('sample@example.test');
  });

  it('keeps filters in the address and sends them on the GET', async () => {
    const fetchMock = stubList(managerUser, {
      'GET /api/employees?page=1&pageSize=25&emailStatus=bounced': () =>
        jsonResponse(200, page(rows.slice(3))),
      'GET /api/employees?page=1&pageSize=25&emailStatus=bounced&active=false': () =>
        jsonResponse(200, page(rows.slice(3))),
    });
    const { router, user } = await openList();

    await user.click(screen.getByRole('combobox', { name: he.employees.emailStatusFilter }));
    await user.click(screen.getByRole('option', { name: NO_EMAIL_REASONS.bounced }));
    await waitFor(() => expect(router.state.location.search).toBe('?emailStatus=bounced'));

    await user.click(screen.getByRole('combobox', { name: he.employees.activeFilter }));
    await user.click(screen.getByRole('option', { name: he.employees.inactive }));
    await waitFor(() =>
      expect(router.state.location.search).toBe('?emailStatus=bounced&active=false'),
    );
    await waitFor(() =>
      expect(urls(fetchMock)).toContain(
        'GET /api/employees?page=1&pageSize=25&emailStatus=bounced&active=false',
      ),
    );
  });

  it('reads the filters back from the address', async () => {
    const dept = DEPARTMENTS[1]?.id ?? '';
    const fetchMock = stubList(managerUser, {
      [`GET /api/employees?page=1&pageSize=25&dept=${dept}`]: () => jsonResponse(200, page(rows)),
    });
    await openList(`/employees?dept=${dept}`);
    await waitFor(() =>
      expect(urls(fetchMock)).toContain(`GET /api/employees?page=1&pageSize=25&dept=${dept}`),
    );
    expect(screen.getByRole('combobox', { name: he.filters.department })).toHaveTextContent(
      '15 - מחלקה לדוגמה א',
    );
  });

  it('sends the search text in a POST body, never in the address or a URL', async () => {
    const fetchMock = stubList();
    const { router, user } = await openList();
    await screen.findByRole('table', { name: he.employees.listCaption });

    await user.type(screen.getByRole('searchbox', { name: he.filters.search }), '000000018{Enter}');
    await waitFor(() => expect(urls(fetchMock)).toContain(SEARCH));

    const searchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const body = searchCall?.[1]?.body;
    expect(typeof body === 'string' ? JSON.parse(body) : body).toEqual({
      page: 1,
      pageSize: 25,
      q: '000000018',
    });
    expect(urls(fetchMock).filter((url) => url.includes('000000018'))).toEqual([]);
    expect(router.state.location.search).toBe('');
    expect(router.state.location.state).toBeNull();
    await waitFor(
      () => expect(screen.getAllByRole('row')).toHaveLength(2), // header + one result
    );
  });

  it('shows add and import to a manager only', async () => {
    stubList();
    await openList();
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: he.employees.add }),
    ).toHaveAttribute('href', '/employees/new');
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: he.nav.employeeImport }),
    ).toHaveAttribute('href', '/employees/import');
  });

  it('an officer sees the same list without add or import', async () => {
    stubList(officerUser);
    await openList();
    await screen.findByRole('table', { name: he.employees.listCaption });
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
    expect(
      within(screen.getByRole('main')).queryByRole('link', { name: he.employees.add }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('main')).queryByRole('link', { name: he.nav.employeeImport }),
    ).not.toBeInTheDocument();
  });

  it('says so when nothing is found', async () => {
    stubList(managerUser, { [LIST]: () => jsonResponse(200, page([])) });
    await openList();
    expect(await screen.findByText(he.employees.empty)).toBeInTheDocument();
  });
});
