import type { TemplateItem, TemplatePreviewReport } from '@doc-signing/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { he } from '../../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../../test/fetch-stub';
import { managerUser, meAnswer, renderRoutes } from '../../../test/render';
import { DEPARTMENTS } from '../../employees/employees.fixtures';
import {
  FIELDS,
  page,
  readyTemplate,
  template,
  TEMPLATE_ID,
  VERSION_2_ID,
} from '../templates.fixtures';

// pdf.js needs a real browser (canvas, workers): the editor is tested with a stand-in.
vi.mock('../../../pdf/pdf-document', () => ({
  loadPdf: vi.fn(() =>
    Promise.resolve({
      pages: [
        { width: 595, height: 842 },
        { width: 595, height: 842 },
      ],
      render: () => ({ done: Promise.resolve(), cancel: () => undefined }),
      destroy: () => undefined,
    }),
  ),
  isCancelled: () => false,
}));

const text = he.templates.editor;
const PATCH = `PATCH /api/templates/${TEMPLATE_ID}`;
const report: TemplatePreviewReport = {
  sample: true,
  missing: [],
  leftForEmployee: [],
  warnings: [],
};
const NAME_ID = FIELDS[0]?.id ?? '';

type Handler = (init: RequestInit) => Response;

function stubEditor(item: TemplateItem = template, extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /api/auth/me': meAnswer(managerUser),
    'GET /api/departments': () => jsonResponse(200, { items: DEPARTMENTS }),
    [`GET /api/templates/${item.id}`]: () => jsonResponse(200, item),
    [`GET /api/templates/${item.id}/preview`]: () =>
      new Response(new Uint8Array([37, 80, 68, 70]), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    [`GET /api/templates/${item.id}/preview/check`]: () => jsonResponse(200, report),
    ...extra,
  });
}

async function openEditor(id = TEMPLATE_ID) {
  const result = renderRoutes(`/templates/${id}/positions`);
  await screen.findByRole('heading', { level: 1, name: text.title }, { timeout: 5000 });
  return result;
}

const card = (name: string) => screen.getByRole('region', { name });
const outline = (uid: string) => document.querySelector<HTMLElement>(`[data-outline="${uid}"]`);
const bodiesOf = (mock: ReturnType<typeof stubEditor>, method: string) =>
  mock.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([, init]) =>
      typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
    );

describe('TemplatePositionsPage', () => {
  it('shows one card per box and an outline per position, which moves at once', async () => {
    stubEditor();
    const { user } = await openEditor();
    expect(card(he.templates.fieldTypes.full_name)).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /רשימת בחירה/ })).toHaveLength(1);
    await waitFor(() => expect(outline(NAME_ID)).not.toBeNull());
    const before = parseFloat(outline(NAME_ID)?.style.top ?? '');

    const y = within(card(he.templates.fieldTypes.full_name)).getByRole('textbox', { name: 'Y' });
    await user.clear(y);
    await user.type(y, '300');
    const after = parseFloat(outline(NAME_ID)?.style.top ?? '');
    expect(after).toBeGreaterThan(before);
    expect(screen.getByText(text.unsaved)).toBeInTheDocument();
  });

  it('the live reasons follow the unsaved list, the footer warning too', async () => {
    stubEditor();
    const { user } = await openEditor();
    await screen.findByText(text.notReadyLive);
    const y = within(card(he.templates.fieldTypes.full_name)).getByRole('textbox', { name: 'Y' });
    await user.clear(y);
    await user.type(y, '10');
    expect(screen.getByText(text.inFooter)).toBeInTheDocument();
    expect(
      screen.getByText(/16 הנקודות התחתונות של העמוד, שם מודפסת/, { selector: 'li' }),
    ).toBeInTheDocument();
  });

  it('saves the whole list and fetches the preview again', async () => {
    const mock = stubEditor(template, {
      [PATCH]: () => jsonResponse(200, { ...template, updatedAt: '2026-10-03T08:00:00.000Z' }),
    });
    const { user } = await openEditor();
    const x = within(card(he.templates.fieldTypes.id_number)).getByRole('textbox', { name: 'X' });
    await user.clear(x);
    await user.type(x, '120,5');
    await user.click(screen.getByRole('button', { name: text.save }));
    await screen.findByText(text.saved);
    const [body] = bodiesOf(mock, 'PATCH') as { fields: { key: string; x: number }[] }[];
    expect(body?.fields.map(({ key }) => key)).toEqual(['full_name', 'id_number', 'box_1']);
    expect(body?.fields[1]?.x).toBe(120.5);
    await waitFor(() =>
      expect(
        mock.mock.calls.filter(([url]) => url === `/api/templates/${TEMPLATE_ID}/preview`),
      ).toHaveLength(2),
    );
  });

  it('nothing changed: no request', async () => {
    const mock = stubEditor();
    const { user } = await openEditor();
    await user.click(screen.getByRole('button', { name: text.save }));
    await screen.findByText(he.templates.details.noChanges);
    expect(bodiesOf(mock, 'PATCH')).toHaveLength(0);
  });

  it('shows an error under its field and sends nothing', async () => {
    const mock = stubEditor();
    const { user } = await openEditor();
    const nameCard = card(he.templates.fieldTypes.full_name);
    const width = within(nameCard).getByRole('textbox', {
      name: he.templates.editor.numbers.width,
    });
    await user.clear(width);
    await user.type(width, 'רחב');
    await user.click(screen.getByRole('button', { name: text.save }));
    expect(within(nameCard).getByText(text.notNumber)).toBeInTheDocument();
    expect(width).toHaveFocus();
    expect(bodiesOf(mock, 'PATCH')).toHaveLength(0);
  });

  it('a refused save marks the position the server named', async () => {
    stubEditor(template, {
      [PATCH]: () =>
        jsonResponse(400, {
          error: {
            code: 'TEMPLATE_FIELD_OUTSIDE_PAGE',
            message: 'x',
            details: { fields: [{ index: 1, page: 1, reason: 'outside_page' }] },
          },
        }),
    });
    const { user } = await openEditor();
    const idCard = card(he.templates.fieldTypes.id_number);
    const x = within(idCard).getByRole('textbox', { name: 'X' });
    await user.clear(x);
    await user.type(x, '101');
    await user.click(screen.getByRole('button', { name: text.save }));
    expect(
      await within(idCard).findByText('מיקום של שדה חורג מגבולות העמוד או מפנה לעמוד שאינו קיים'),
    ).toBeInTheDocument();
  });

  it('a locked template asks first, then opens the new version', async () => {
    const locked = { ...readyTemplate, isLocked: true };
    const version2 = { ...locked, id: VERSION_2_ID, version: 2, isLocked: false };
    const mock = stubEditor(locked, {
      [PATCH]: () => jsonResponse(200, version2),
      [`GET /api/templates/${VERSION_2_ID}`]: () => jsonResponse(200, version2),
      [`GET /api/templates/${VERSION_2_ID}/preview`]: () =>
        new Response(new Uint8Array([37]), { status: 200 }),
      [`GET /api/templates/${VERSION_2_ID}/preview/check`]: () => jsonResponse(200, report),
      'GET /api/templates?page=1&pageSize=100&includeArchived=true': () =>
        jsonResponse(200, { ...page([locked]), pageSize: 100 }),
    });
    const { user, router } = await openEditor();
    const y = within(card(he.templates.fieldTypes.full_name)).getByRole('textbox', { name: 'Y' });
    await user.clear(y);
    await user.type(y, '400');
    await user.click(screen.getByRole('button', { name: text.save }));
    const dialog = await screen.findByRole('dialog', {
      name: he.templates.details.versionDialogTitle,
    });
    expect(bodiesOf(mock, 'PATCH')).toHaveLength(0);
    await user.click(
      within(dialog).getByRole('button', { name: he.templates.details.versionDialogConfirm }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/templates/${VERSION_2_ID}/positions`),
    );
    expect(await screen.findByText(he.templates.details.versionCreated(2))).toBeInTheDocument();
    expect(bodiesOf(mock, 'PATCH')).toHaveLength(1);
  });

  it('warns before leaving with unsaved changes', async () => {
    stubEditor(template, {
      'GET /api/templates?page=1&pageSize=100&includeArchived=true': () =>
        jsonResponse(200, { ...page([template]), pageSize: 100 }),
    });
    const { user, router } = await openEditor();
    const y = within(card(he.templates.fieldTypes.full_name)).getByRole('textbox', { name: 'Y' });
    await user.type(y, '5');
    await user.click(screen.getByRole('link', { name: text.backToDetails }));
    const dialog = await screen.findByRole('dialog', { name: text.leaveTitle });
    await user.click(within(dialog).getByRole('button', { name: text.stay }));
    expect(router.state.location.pathname).toBe(`/templates/${TEMPLATE_ID}/positions`);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('link', { name: text.backToDetails }));
    await user.click(
      within(await screen.findByRole('dialog', { name: text.leaveTitle })).getByRole('button', {
        name: text.leaveConfirm,
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe(`/templates/${TEMPLATE_ID}`));
  });

  it('adds a box from the menu with the next free key', async () => {
    stubEditor();
    const { user } = await openEditor();
    await user.click(screen.getByRole('button', { name: text.addBox }));
    await user.click(screen.getByRole('menuitem', { name: he.templates.fieldTypes.checkbox }));
    expect(
      card(he.templates.boxName(he.templates.fieldTypes.checkbox, '⁦box_2⁩')),
    ).toBeInTheDocument();
  });

  it('an archived version is read only', async () => {
    stubEditor({ ...template, isArchived: true });
    await openEditor();
    expect(screen.getByText(new RegExp(text.readOnly))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: text.save })).not.toBeInTheDocument();
  });

  it('a path that is not a uuid is "not found" with no template request', async () => {
    const mock = stubEditor();
    renderRoutes('/templates/abc/positions');
    await screen.findByRole('heading', { name: he.feedback.notFoundTitle });
    expect(
      mock.mock.calls.some(([url]) => typeof url === 'string' && url.startsWith('/api/templates')),
    ).toBe(false);
  });

  it('the preview PDF failing to load shows a retry', async () => {
    stubEditor(template, {
      [`GET /api/templates/${TEMPLATE_ID}/preview`]: () => apiErrorResponse(404, 'NOT_FOUND'),
    });
    await openEditor();
    expect(await screen.findByRole('button', { name: he.feedback.retry })).toBeInTheDocument();
  });

  it('a window focus never fetches the preview PDF again (each fetch logs a view)', async () => {
    const mock = stubEditor();
    await openEditor();
    const calls = (url: string) => mock.mock.calls.filter(([called]) => called === url).length;
    const itemPath = `/api/templates/${TEMPLATE_ID}`;
    const pdfPath = `${itemPath}/preview`;
    await waitFor(() => expect(calls(pdfPath)).toBe(1));
    // Past the default 30 s staleTime: other queries do refetch on this focus.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(calls(itemPath)).toBe(2));
    expect(calls(pdfPath)).toBe(1);
    vi.restoreAllMocks();
  });
});
