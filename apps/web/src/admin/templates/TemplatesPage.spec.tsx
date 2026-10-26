import { TEMPLATE_NOT_READY_MESSAGES } from '@doc-signing/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, renderRoutes } from '../../test/render';
import { DEPARTMENTS } from '../employees/employees.fixtures';
import { page, readyTemplate, template, VERSION_3_ID } from './templates.fixtures';

const text = he.templates;
const LIST = 'GET /api/templates?page=1&pageSize=25';

const lockedReady = { ...readyTemplate, id: VERSION_3_ID, name: 'חוזה נעול', isLocked: true };

function stubList(extra: Record<string, () => Response> = {}) {
  return stubApi({
    'GET /api/auth/me': meAnswer(managerUser),
    'GET /api/departments': () => jsonResponse(200, { items: DEPARTMENTS }),
    [LIST]: () => jsonResponse(200, page([template, lockedReady])),
    ...extra,
  });
}

async function openList(entry = '/templates') {
  const result = renderRoutes(entry);
  await screen.findByRole('heading', { level: 1, name: he.nav.templates }, { timeout: 5000 });
  return result;
}

const table = () => screen.getByRole('table', { name: text.listCaption });

describe('TemplatesPage', () => {
  it('shows name, departments by code, version and state; why a template is not ready', async () => {
    stubList();
    await openList();
    await within(table()).findByRole('link', { name: template.name });
    const rows = within(table()).getAllByRole('row');
    const first = rows[1];
    if (!first) throw new Error('no rows');
    expect(within(first).getByRole('link', { name: template.name })).toHaveAttribute(
      'href',
      `/templates/${template.id}`,
    );
    const departments = within(first)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(departments.slice(0, 2)).toEqual(['15 - מחלקה לדוגמה א', '19 - מחלקה לדוגמה ב']);
    expect(within(first).getByText(text.version(1))).toBeInTheDocument();
    expect(within(first).getByText(text.status.not_ready)).toBeInTheDocument();
    expect(
      within(first).getByText(TEMPLATE_NOT_READY_MESSAGES.NO_MAIN_SIGNATURE),
    ).toBeInTheDocument();
    expect(within(first).getByText('02/10/2026')).toBeInTheDocument();

    const second = rows[2];
    if (!second) throw new Error('no second row');
    expect(within(second).getByText(text.status.ready)).toBeInTheDocument();
    expect(within(second).getByText(text.status.locked)).toBeInTheDocument();
  });

  it('keeps only the department id and "include archived" in the address', async () => {
    const dept = DEPARTMENTS[1]?.id ?? '';
    const fetchMock = stubList({
      [`GET /api/templates?page=1&pageSize=25&dept=${dept}`]: () =>
        jsonResponse(200, page([template])),
      [`GET /api/templates?page=1&pageSize=25&dept=${dept}&includeArchived=true`]: () =>
        jsonResponse(200, page([{ ...template, isArchived: true }])),
    });
    const { user, router } = await openList();
    await user.click(screen.getByRole('combobox', { name: he.filters.department }));
    await user.click(screen.getByRole('option', { name: '15 - מחלקה לדוגמה א' }));
    await waitFor(() => expect(router.state.location.search).toBe(`?dept=${dept}`));

    await user.click(screen.getByRole('checkbox', { name: text.includeArchived }));
    await waitFor(() =>
      expect(router.state.location.search).toBe(`?dept=${dept}&includeArchived=true`),
    );
    expect(await within(table()).findByText(text.status.archived)).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map(([url]) => (typeof url === 'string' ? url : ''));
    expect(urls).toContain(`/api/templates?page=1&pageSize=25&dept=${dept}&includeArchived=true`);
  });

  it('links to the upload page', async () => {
    stubList();
    await openList();
    expect(screen.getByRole('link', { name: text.add })).toHaveAttribute('href', '/templates/new');
  });

  it('says when there are no templates', async () => {
    stubList({ [LIST]: () => jsonResponse(200, page([])) });
    await openList();
    expect(await screen.findByText(text.empty)).toBeInTheDocument();
  });

  it('shows the error with a retry', async () => {
    stubList({ [LIST]: () => apiErrorResponse(400, 'VALIDATION_FAILED') });
    await openList();
    expect(await screen.findByRole('button', { name: he.feedback.retry })).toBeInTheDocument();
  });
});
