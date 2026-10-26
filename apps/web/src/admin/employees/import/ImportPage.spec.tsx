import { ERROR_MESSAGES, formatDate, formatTime, NO_EMAIL_REASONS } from '@doc-signing/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { he } from '../../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../../test/fetch-stub';
import { managerUser, meAnswer, officerUser, renderRoutes } from '../../../test/render';
import { dashboardKeys } from '../../dashboard/dashboard.api';
import { employeeKeys } from '../employees.api';
import { DEPARTMENTS } from '../employees.fixtures';
import { BATCH_ID, commitResult, manyNew, nothingToDo, preview } from './import.fixtures';

const texts = he.employeeImport;
const PREVIEW = 'POST /api/employees/import/preview';
const COMMIT = `POST /api/employees/import/${BATCH_ID}/commit`;

type Answer = () => Response | Promise<Response>;

function stub(routes: Record<string, Answer> = {}, user = managerUser) {
  return stubApi({
    'GET /api/auth/me': meAnswer(user),
    'GET /api/departments': () => jsonResponse(200, { items: DEPARTMENTS }),
    [PREVIEW]: () => jsonResponse(200, preview),
    [COMMIT]: () => jsonResponse(200, commitResult),
    ...routes,
  });
}

type FetchMock = ReturnType<typeof stub>;

const callsTo = (mock: FetchMock, route: string) =>
  mock.mock.calls.filter(
    ([url, init]) => `${init?.method ?? 'GET'} ${typeof url === 'string' ? url : ''}` === route,
  );

const xlsx = () => new File(['fake'], 'עובדים.xlsx');

async function openPage() {
  const result = renderRoutes('/employees/import');
  await screen.findByRole('heading', { level: 1, name: he.nav.employeeImport }, { timeout: 5000 });
  return result;
}

async function upload(result: Awaited<ReturnType<typeof openPage>>) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input');
  await result.user.upload(input, xlsx());
  await result.user.click(screen.getByRole('button', { name: texts.check }));
}

async function openPreview() {
  const result = await openPage();
  await upload(result);
  await screen.findByRole('heading', { level: 2, name: texts.previewTitle });
  return result;
}

function deferred() {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function tab(name: string) {
  return screen.getByRole('tab', { name: new RegExp(`^${name}`) });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('EmployeeImportPage (A8): upload', () => {
  it('says nothing is saved yet, sends the file as multipart "file" and shows "checking"', async () => {
    const answer = deferred();
    const mock = stub({ [PREVIEW]: () => answer.promise });
    const result = await openPage();
    expect(screen.getByText(texts.nothingSavedYet)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: texts.check })).toBeDisabled();

    await upload(result);
    expect(await screen.findByText(texts.checking)).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: texts.check })).toBeDisabled();

    const [call] = callsTo(mock, PREVIEW);
    const body = call?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBeInstanceOf(File);

    answer.resolve(jsonResponse(200, preview));
    await screen.findByRole('heading', { level: 2, name: texts.previewTitle });
  });

  it('a refused file shows the server reason by code; the file stays chosen', async () => {
    stub({ [PREVIEW]: () => apiErrorResponse(400, 'INVALID_EXCEL_FILE') });
    const result = await openPage();
    await upload(result);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(ERROR_MESSAGES.INVALID_EXCEL_FILE);
    expect(screen.getByRole('group', { name: he.upload.chosen })).toHaveTextContent('עובדים.xlsx');
    expect(screen.getByRole('button', { name: texts.check })).toBeEnabled();
  });

  it('missing columns: the message and the column names', async () => {
    stub({
      [PREVIEW]: () =>
        jsonResponse(400, {
          error: {
            code: 'IMPORT_MISSING_COLUMNS',
            message: 'x',
            details: { columns: ['E-Mail', 'טלפון'] },
          },
        }),
    });
    const result = await openPage();
    await upload(result);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(ERROR_MESSAGES.IMPORT_MISSING_COLUMNS);
    expect(alert).toHaveTextContent(texts.columns('E-Mail, טלפון'));
  });

  it('a file too big for the server shows its message', async () => {
    stub({ [PREVIEW]: () => apiErrorResponse(400, 'FILE_TOO_LARGE') });
    const result = await openPage();
    await upload(result);
    expect(await screen.findByRole('alert')).toHaveTextContent(ERROR_MESSAGES.FILE_TOO_LARGE);
  });
});

describe('EmployeeImportPage (A8): preview', () => {
  it('shows the counts, the file name and until when it can be confirmed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T08:00:00Z'));
    stub();
    await openPreview();

    const counts = screen.getByRole('list', { name: texts.countsLabel });
    const value = (key: string) =>
      counts.querySelector(`[data-count="${key}"] [data-value]`)?.textContent;
    expect(value('rowsNew')).toBe('2');
    expect(value('rowsUpdated')).toBe('1');
    expect(value('rowsUnchanged')).toBe('1');
    expect(value('rowsFailed')).toBe('2');
    expect(value('departmentsNew')).toBe('1');
    expect(value('departmentsRenamed')).toBe('1');
    expect(screen.getByText(preview.fileName)).toBeInTheDocument();

    const until = new Date('2026-10-27T08:00:00Z');
    expect(
      screen.getByText(texts.confirmableUntil(formatDate(until), formatTime(until))),
    ).toBeInTheDocument();
    expect(screen.getByText(texts.leaveNote)).toBeInTheDocument();
  });

  it('new employees: row, number, name, "15 - name", email status', async () => {
    stub();
    await openPreview();
    expect(tab(texts.tabs.new)).toHaveTextContent(texts.tabWithCount(texts.tabs.new, '2'));
    const table = screen.getByRole('table', { name: texts.tabs.new });
    const row = within(table).getByRole('row', { name: /9101/ });
    expect(row).toHaveTextContent('עובדת חדשה');
    expect(row).toHaveTextContent('15 - מחלקה לדוגמה א');
    expect(row).toHaveTextContent(NO_EMAIL_REASONS.missing);
  });

  it('updated employees: each change as "field: old ← new" in Hebrew', async () => {
    const { user } = await (stub(), openPreview());
    await user.click(tab(texts.tabs.updated));
    const table = screen.getByRole('table', { name: texts.tabs.updated });
    const row = within(table).getByRole('row', { name: /9001/ });
    const lines = within(row)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    const a = texts.arrow;
    expect(lines).toEqual([
      `שם פרטי: דנה ${a} דינה`,
      `מחלקה: 15 - מחלקה לדוגמה א ${a} 31 - מחלקה חדשה לדוגמה`,
      `אימייל: — ${a} sample@example.test`,
      `${he.employees.emailStatusFilter}: ${NO_EMAIL_REASONS.missing} ${a} ${he.employees.emailValid}`,
      `טלפון נייד: 050-1111111 ${a} —`,
      `תעודת זהות: ${texts.changed}`,
    ]);
  });

  it('errors and warnings: row number, employee number and the Hebrew reason', async () => {
    const { user } = await (stub(), openPreview());
    await user.click(tab(texts.tabs.errors));
    const errors = screen.getByRole('table', { name: texts.tabs.errors });
    expect(within(errors).getByRole('row', { name: /9103/ })).toHaveTextContent(
      'מספר תעודת הזהות אינו תקין',
    );
    const noNumber = within(errors).getByRole('row', { name: /חסר מספר עובד/ });
    expect(noNumber).toHaveTextContent('7');
    expect(noNumber).toHaveTextContent(he.employees.emptyValue);

    await user.click(tab(texts.tabs.warnings));
    expect(screen.getByText(texts.warningsHint)).toBeInTheDocument();
    const warnings = screen.getByRole('table', { name: texts.tabs.warnings });
    expect(within(warnings).getByRole('row', { name: /9102/ })).toHaveTextContent(
      'כתובת האימייל אינה תקינה',
    );
  });

  it('departments: new as "31 - name", renamed as "19 - old ← 19 - new"', async () => {
    const { user } = await (stub(), openPreview());
    await user.click(tab(texts.tabs.departments));
    expect(screen.getByRole('heading', { level: 3, name: texts.newDepartments })).toBeVisible();
    expect(screen.getByText('31 - מחלקה חדשה לדוגמה')).toBeInTheDocument();
    const renamed = screen.getByText('19 - מחלקה לדוגמה ב').closest('li');
    expect(renamed).toHaveTextContent(
      `19 - מחלקה לדוגמה ב ${texts.arrow} 19 - מחלקה לדוגמה ב חדשה`,
    );
  });

  it('hides a tab with no entries and pages a long list in memory, not in the address', async () => {
    stub({ [PREVIEW]: () => jsonResponse(200, manyNew) });
    const { user, router } = await openPreview();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    const table = screen.getByRole('table', { name: texts.tabs.new });
    expect(within(table).getAllByRole('row')).toHaveLength(26); // header + 25
    await user.click(screen.getByRole('button', { name: he.table.nextPage }));
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(within(table).getByRole('row', { name: /9229/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/employees/import');
    expect(router.state.location.search).toBe('');
  });

  it('with error rows: the confirm is allowed and says the rows are skipped', async () => {
    stub();
    await openPreview();
    expect(screen.getByText(texts.errorsSkipped('2'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: texts.confirm })).toBeEnabled();
  });

  it('nothing to import: the confirm is disabled, "upload another file" goes back', async () => {
    stub({ [PREVIEW]: () => jsonResponse(200, nothingToDo) });
    const { user } = await openPreview();
    expect(screen.getByText(texts.nothingToImport)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: texts.confirm })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: texts.uploadOther }));
    expect(await screen.findByRole('heading', { level: 2, name: texts.steps[0] })).toBeVisible();
  });
});

describe('EmployeeImportPage (A8): confirm and done', () => {
  it('the dialog says what will happen; confirming commits with no body and shows done', async () => {
    const mock = stub();
    const { user, queryClient } = await openPreview();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: texts.confirm }));
    const dialog = screen.getByRole('dialog', { name: texts.dialogTitle });
    expect(dialog).toHaveTextContent(texts.dialogNew('2'));
    expect(dialog).toHaveTextContent(texts.dialogUpdated('1'));
    expect(dialog).toHaveTextContent(texts.dialogSkipped('2'));
    expect(dialog).toHaveTextContent('31 - מחלקה חדשה לדוגמה');
    expect(dialog).toHaveTextContent('19 - מחלקה לדוגמה ב חדשה');
    expect(dialog).toHaveTextContent(texts.nothingSent);

    await user.click(within(dialog).getByRole('button', { name: texts.dialogConfirm }));
    expect(await screen.findByRole('heading', { level: 2, name: texts.doneTitle })).toBeVisible();
    const [call] = callsTo(mock, COMMIT);
    expect(call?.[1]?.body).toBeUndefined();

    const counts = screen.getByRole('list', { name: texts.countsLabel });
    expect(within(counts).getByText(texts.doneCounts.rowsNew)).toBeInTheDocument();
    expect(screen.getByText(texts.doneManual, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: texts.toEmployees })).toHaveAttribute(
      'href',
      '/employees',
    );
    expect(screen.getByRole('link', { name: texts.toManual })).toHaveAttribute('href', '/manual');
    await waitFor(() =>
      expect(
        screen.getAllByRole('status').some((item) => item.textContent?.includes(texts.doneNotify)),
      ).toBe(true),
    );

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([employeeKeys.all, employeeKeys.departments, dashboardKeys.all]),
    );

    await user.click(screen.getByRole('button', { name: texts.anotherImport }));
    expect(await screen.findByRole('heading', { level: 2, name: texts.steps[0] })).toBeVisible();
  });

  it('a double click on confirm commits once; the dialog is busy meanwhile', async () => {
    const answer = deferred();
    const mock = stub({ [COMMIT]: () => answer.promise });
    const { user } = await openPreview();
    await user.click(screen.getByRole('button', { name: texts.confirm }));
    const dialog = screen.getByRole('dialog', { name: texts.dialogTitle });
    await user.dblClick(within(dialog).getByRole('button', { name: texts.dialogConfirm }));
    expect(within(dialog).getByRole('button', { name: he.common.working })).toBeDisabled();
    answer.resolve(jsonResponse(200, commitResult));
    await screen.findByRole('heading', { level: 2, name: texts.doneTitle });
    expect(callsTo(mock, COMMIT)).toHaveLength(1);
  });

  it.each([
    'IMPORT_STALE',
    'IMPORT_EXPIRED',
    'IMPORT_FILE_MISSING',
    'IMPORT_ALREADY_DONE',
  ] as const)('409 %s: the server message and "upload again" back to step 1', async (code) => {
    stub({ [COMMIT]: () => apiErrorResponse(409, code) });
    const { user } = await openPreview();
    await user.click(screen.getByRole('button', { name: texts.confirm }));
    await user.click(screen.getByRole('button', { name: texts.dialogConfirm }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(ERROR_MESSAGES[code]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: texts.confirm })).toBeDisabled();

    await user.click(within(alert).getByRole('button', { name: texts.uploadAgain }));
    expect(await screen.findByRole('heading', { level: 2, name: texts.steps[0] })).toBeVisible();
    expect(screen.queryByRole('group', { name: he.upload.chosen })).not.toBeInTheDocument();
  });

  it('another failure: a notification, the preview stays and can be confirmed again', async () => {
    stub({ [COMMIT]: () => apiErrorResponse(500, 'INTERNAL_ERROR') });
    const { user } = await openPreview();
    await user.click(screen.getByRole('button', { name: texts.confirm }));
    await user.click(screen.getByRole('button', { name: texts.dialogConfirm }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ERROR_MESSAGES.INTERNAL_ERROR);
    expect(screen.getByRole('heading', { level: 2, name: texts.previewTitle })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: texts.confirm })).toBeEnabled());
  });
});

describe('EmployeeImportPage (A8): roles', () => {
  it('officer: "no permission", and the file is never asked for', async () => {
    const mock = stub({}, officerUser);
    renderRoutes('/employees/import');
    expect(
      await screen.findByRole('heading', { level: 1, name: he.feedback.noPermissionTitle }),
    ).toBeVisible();
    expect(callsTo(mock, PREVIEW)).toHaveLength(0);
  });
});
