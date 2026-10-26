import {
  errorMessage,
  TEMPLATE_NOT_READY_MESSAGES,
  TEMPLATE_PREVIEW_WARNINGS,
  type TemplateItem,
  type TemplatePreviewReport,
} from '@doc-signing/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, renderRoutes } from '../../test/render';
import { DEPARTMENTS } from '../employees/employees.fixtures';
import {
  page,
  readyTemplate,
  template,
  TEMPLATE_ID,
  VERSION_2_ID,
  VERSION_3_ID,
  versions,
} from './templates.fixtures';

const text = he.templates.details;
const VERSIONS = 'GET /api/templates?page=1&pageSize=100&includeArchived=true';
const PATCH = `PATCH /api/templates/${TEMPLATE_ID}`;

const report: TemplatePreviewReport = {
  sample: true,
  missing: [{ key: 'landline', name: 'טלפון' }],
  leftForEmployee: [{ key: 'address', name: 'כתובת' }],
  // One per reason from the API; the screen shows it once.
  warnings: [
    { code: 'TEMPLATE_NOT_READY', message: 'x', keys: [] },
    { code: 'TEMPLATE_NOT_READY', message: 'y', keys: ['box_1'] },
    { code: 'TEXT_TOO_LONG', message: 'z', keys: ['full_name'] },
  ],
};

type Handler = (init: RequestInit) => Response;

function stubDetails(item: TemplateItem = template, extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /api/auth/me': meAnswer(managerUser),
    'GET /api/departments': () => jsonResponse(200, { items: DEPARTMENTS }),
    [`GET /api/templates/${item.id}`]: () => jsonResponse(200, item),
    [VERSIONS]: () => jsonResponse(200, { ...page([item]), pageSize: 100 }),
    [`GET /api/templates/${item.id}/preview/check`]: () => jsonResponse(200, report),
    ...extra,
  });
}

async function openDetails(id = TEMPLATE_ID, name = template.name) {
  const result = renderRoutes(`/templates/${id}`);
  await screen.findByRole('heading', { level: 1, name }, { timeout: 5000 });
  return result;
}

type FetchMock = ReturnType<typeof stubDetails>;

function bodiesOf(mock: FetchMock, method: string): unknown[] {
  return mock.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([, init]) =>
      typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    );
}

const section = (name: string) => screen.getByRole('region', { name });
const nameField = () => screen.getByRole('textbox', { name: he.templates.upload.name });
const saveButton = () => screen.getByRole('button', { name: text.save });

describe('TemplateDetailsPage: what it shows', () => {
  it('the version, the "ready" reasons by code, the positions and the preview check', async () => {
    stubDetails();
    await openDetails();
    expect(screen.getByText(/גרסה 1 · 2 עמודים · נוצרה ב-01\/10\/2026/)).toBeInTheDocument();

    const status = section(text.statusTitle);
    expect(within(status).getByText(text.notReady)).toBeInTheDocument();
    expect(
      within(status).getByText(TEMPLATE_NOT_READY_MESSAGES.NO_MAIN_SIGNATURE),
    ).toBeInTheDocument();
    expect(within(status).getByText(text.positionsByDeveloper)).toBeInTheDocument();

    const positions = screen.getByRole('table', { name: text.positionsCaption });
    expect(within(positions).getByText(he.templates.fieldTypes.select)).toBeInTheDocument();
    expect(within(positions).getByText('box_1')).toBeInTheDocument();
    expect(within(positions).getAllByText(he.templates.fillModes.system)).toHaveLength(2);

    const preview = section(text.previewTitle);
    expect(within(preview).getByRole('link', { name: text.openPreview })).toHaveAttribute(
      'href',
      `/api/templates/${TEMPLATE_ID}/preview`,
    );
    expect(await within(preview).findByText('טלפון')).toBeInTheDocument();
    expect(within(preview).getByText('כתובת')).toBeInTheDocument();
    expect(
      within(preview).getByText(TEMPLATE_PREVIEW_WARNINGS.TEMPLATE_NOT_READY),
    ).toBeInTheDocument();
    expect(
      within(preview).getByText(
        `${TEMPLATE_PREVIEW_WARNINGS.TEXT_TOO_LONG} (${he.templates.fieldTypes.full_name})`,
      ),
    ).toBeInTheDocument();
  });

  it('lists every version newest first, linking to the others', async () => {
    const all = versions();
    const latest = all[2];
    if (!latest) throw new Error('no versions');
    stubDetails(latest, { [VERSIONS]: () => jsonResponse(200, { ...page(all), pageSize: 100 }) });
    await openDetails(VERSION_3_ID);
    const table = await screen.findByRole('table', { name: text.versionsCaption });
    await within(table).findByRole('link', { name: he.templates.version(2) });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
      `${he.templates.version(3)} (${text.current})`,
      he.templates.version(2),
      he.templates.version(1),
    ]);
    expect(within(table).getByRole('link', { name: he.templates.version(1) })).toHaveAttribute(
      'href',
      `/templates/${TEMPLATE_ID}`,
    );
  });

  it('an old version is read only and links to the latest', async () => {
    const all = versions();
    const old = all[1];
    if (!old) throw new Error('no versions');
    stubDetails(old, { [VERSIONS]: () => jsonResponse(200, { ...page(all), pageSize: 100 }) });
    await openDetails(VERSION_2_ID);
    expect(screen.getByText(text.readOnlyOld)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: text.toLatest })).toHaveAttribute(
      'href',
      `/templates/${VERSION_3_ID}`,
    );
    expect(nameField()).toBeDisabled();
    expect(screen.queryByRole('button', { name: text.save })).not.toBeInTheDocument();
  });

  it('an address that is not a template id is "not found" without a request', async () => {
    const fetchMock = stubDetails();
    renderRoutes('/templates/not-an-id');
    expect(
      await screen.findByRole('heading', { name: he.feedback.notFoundTitle }, { timeout: 5000 }),
    ).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map(([url]) => (typeof url === 'string' ? url : ''));
    expect(urls.some((url) => url.startsWith('/api/templates'))).toBe(false);
  });
});

describe('TemplateDetailsPage: settings', () => {
  it('saves only what changed, in place', async () => {
    const fetchMock = stubDetails(template, {
      [PATCH]: () => jsonResponse(200, { ...template, employerSignatureMode: 'pre_signed' }),
    });
    const { user } = await openDetails();
    await user.click(screen.getByRole('radio', { name: /כבר על המסמך בשליחה/ }));
    await user.click(saveButton());
    expect(await screen.findByText(text.saved)).toBeInTheDocument();
    expect(bodiesOf(fetchMock, 'PATCH')).toEqual([{ employerSignatureMode: 'pre_signed' }]);
  });

  it('nothing changed → says so and sends nothing', async () => {
    const fetchMock = stubDetails();
    const { user } = await openDetails();
    await user.click(saveButton());
    expect(await screen.findByText(text.noChanges)).toBeInTheDocument();
    expect(bodiesOf(fetchMock, 'PATCH')).toEqual([]);
  });

  it('an empty name is marked and not sent', async () => {
    const fetchMock = stubDetails();
    const { user } = await openDetails();
    await user.clear(nameField());
    await user.click(saveButton());
    expect(nameField()).toHaveAccessibleDescription(he.templates.form.required);
    expect(nameField()).toHaveFocus();
    expect(bodiesOf(fetchMock, 'PATCH')).toEqual([]);
  });

  it('locked: says what a change does; a new name asks first, then opens the new version', async () => {
    const locked = { ...readyTemplate, isLocked: true };
    const version2 = { ...locked, id: VERSION_2_ID, version: 2, name: 'שם חדש', isLocked: false };
    const fetchMock = stubDetails(locked, {
      [PATCH]: () => jsonResponse(200, version2),
      [`GET /api/templates/${VERSION_2_ID}`]: () => jsonResponse(200, version2),
      [`GET /api/templates/${VERSION_2_ID}/preview/check`]: () => jsonResponse(200, report),
    });
    const { user, router } = await openDetails();
    expect(screen.getByText(text.lockedNote)).toBeInTheDocument();

    await user.clear(nameField());
    await user.type(nameField(), 'שם חדש');
    await user.click(saveButton());
    const dialog = await screen.findByRole('dialog', { name: text.versionDialogTitle });
    expect(within(dialog).getByText(text.versionDialogText(1, 2))).toBeInTheDocument();
    expect(bodiesOf(fetchMock, 'PATCH')).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: text.versionDialogConfirm }));
    expect(await screen.findByText(text.versionCreated(2))).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/templates/${VERSION_2_ID}`));
    expect(bodiesOf(fetchMock, 'PATCH')).toEqual([{ name: 'שם חדש' }]);
  });

  it('locked: the dialog can be cancelled, and nothing is sent', async () => {
    const fetchMock = stubDetails({ ...readyTemplate, isLocked: true });
    const { user } = await openDetails();
    await user.click(screen.getByRole('radio', { name: /נוספת אחרי שהעובד חותם/ }));
    await user.click(saveButton());
    const dialog = await screen.findByRole('dialog', { name: text.versionDialogTitle });
    await user.click(within(dialog).getByRole('button', { name: he.common.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bodiesOf(fetchMock, 'PATCH')).toEqual([]);
  });

  it('locked: departments alone are saved in place, with no dialog', async () => {
    const locked = { ...readyTemplate, isLocked: true };
    const fetchMock = stubDetails(locked, { [PATCH]: () => jsonResponse(200, locked) });
    const { user } = await openDetails();
    const picker = screen.getByRole('combobox', { name: he.departmentPicker.label });
    await user.click(picker);
    await user.click(screen.getByRole('option', { name: '19 - מחלקה לדוגמה ב' }));
    await user.keyboard('{Escape}');
    await user.click(saveButton());
    expect(await screen.findByText(text.saved)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bodiesOf(fetchMock, 'PATCH')).toEqual([{ departmentIds: [DEPARTMENTS[1]?.id] }]);
  });

  it('a 409 (a newer version exists) is shown on the form', async () => {
    stubDetails(template, { [PATCH]: () => apiErrorResponse(409, 'TEMPLATE_HAS_NEWER_VERSION') });
    const { user } = await openDetails();
    await user.click(screen.getByRole('radio', { name: /כבר על המסמך בשליחה/ }));
    await user.click(saveButton());
    expect(await screen.findByText(errorMessage('TEMPLATE_HAS_NEWER_VERSION'))).toBeInTheDocument();
  });
});

describe('TemplateDetailsPage: archive', () => {
  it('asks first (danger), then archives', async () => {
    const fetchMock = stubDetails(template, {
      [`POST /api/templates/${TEMPLATE_ID}/archive`]: () =>
        jsonResponse(200, { ...template, isArchived: true }),
    });
    const { user } = await openDetails();
    await user.click(screen.getByRole('button', { name: text.archive }));
    const dialog = await screen.findByRole('dialog', { name: text.archiveDialogTitle });
    expect(within(dialog).getByText(text.archiveDialogText(template.name, 1))).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: he.common.cancel })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: text.archive }));
    expect(await screen.findByText(text.archived)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => init?.method === 'POST' && url === `/api/templates/${TEMPLATE_ID}/archive`,
      ),
    ).toBe(true);
  });

  it('an archived template has no archive button and a read-only form', async () => {
    stubDetails({ ...template, isArchived: true });
    await openDetails();
    expect(screen.getByText(text.readOnlyArchived)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: text.archive })).not.toBeInTheDocument();
    expect(screen.getAllByText(he.templates.status.archived).length).toBeGreaterThan(0);
  });
});
