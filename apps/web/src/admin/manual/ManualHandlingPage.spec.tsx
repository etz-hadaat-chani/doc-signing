import { errorMessage, formatTime, MAX_UNLOCKS, NO_EMAIL_REASONS } from '@doc-signing/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { he } from '../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, officerUser, renderRoutes } from '../../test/render';
import { card, DEPARTMENTS } from '../employees/employees.fixtures';
import {
  corrected,
  emailAdded,
  lockedOut,
  missingData,
  noEmail,
  paged,
  ROUND_ID,
  ROWS,
} from './manual.fixtures';

const text = he.manual;
const LIST = 'GET /api/manual-handling?page=1&pageSize=25';
const SEARCH = 'POST /api/manual-handling/search';
const SEND = 'POST /api/manual-handling/send';
const NAME = (row: typeof noEmail) => `${row.employee.firstName} ${row.employee.lastName}`;

type Routes = Record<string, (init: RequestInit) => Response>;

function stubPage(routes: Routes = {}, user = managerUser) {
  return stubApi({
    'GET /api/auth/me': meAnswer(user),
    'GET /api/departments': () => jsonResponse(200, { items: DEPARTMENTS }),
    'GET /api/rounds?page=1&pageSize=100': () => jsonResponse(200, { ...paged([]), pageSize: 100 }),
    [LIST]: () => jsonResponse(200, paged(ROWS)),
    ...routes,
  });
}

type FetchMock = ReturnType<typeof stubPage>;

const urls = (mock: FetchMock) =>
  mock.mock.calls.map(
    ([url, init]) => `${init?.method ?? 'GET'} ${typeof url === 'string' ? url : ''}`,
  );

const bodyOf = (mock: FetchMock, key: string): unknown => {
  const call = mock.mock.calls.find(
    ([url, init]) => `${init?.method ?? 'GET'} ${typeof url === 'string' ? url : ''}` === key,
  );
  const body = call?.[1]?.body;
  return typeof body === 'string' ? JSON.parse(body) : body;
};

async function openPage(entry = '/manual') {
  const rendered = renderRoutes(entry);
  await screen.findByRole('table', { name: text.listCaption }, { timeout: 5000 });
  await screen.findByText(NAME(noEmail));
  return rendered;
}

const rowOf = (row: typeof noEmail) =>
  screen.getByRole('row', { name: new RegExp(row.employee.employeeNumber) });

async function openMenu(user: Awaited<ReturnType<typeof openPage>>['user'], row: typeof noEmail) {
  await user.click(screen.getByRole('button', { name: text.menuFor(NAME(row)) }));
  return screen.getByRole('menu');
}

describe('ManualHandlingPage (A10)', () => {
  it('an officer gets "no permission" and no list request', async () => {
    const mock = stubPage({}, officerUser);
    renderRoutes('/manual');
    expect(
      await screen.findByRole('heading', { level: 1, name: he.feedback.noPermissionTitle }),
    ).toBeInTheDocument();
    expect(urls(mock).some((url) => url.includes('/api/manual-handling'))).toBe(false);
  });

  it('shows each kind with its state: ready, missing names, lock, the corrected email + Har Gal', async () => {
    stubPage();
    await openPage();
    expect(within(rowOf(noEmail)).getByText(text.kinds.no_email)).toBeInTheDocument();
    // The email status mark (EmailStatusMark), never the address.
    expect(within(rowOf(noEmail)).getByText(NO_EMAIL_REASONS.missing)).toBeInTheDocument();
    expect(within(rowOf(emailAdded)).getByText(text.ready.email_added)).toBeInTheDocument();
    expect(rowOf(emailAdded)).toHaveTextContent('added@example.test');
    expect(rowOf(missingData)).toHaveTextContent(text.missing('כתובת, עיר'));
    expect(rowOf(lockedOut)).toHaveTextContent(text.unlocksLeft(0, MAX_UNLOCKS));
    const correctedRow = rowOf(corrected);
    expect(correctedRow).toHaveTextContent('old@example.test ← new@example.test');
    expect(correctedRow).toHaveTextContent(text.harGal);
    // Never an ID number.
    expect(screen.getByRole('table', { name: text.listCaption })).not.toHaveTextContent(
      card.idNumber ?? '000000018',
    );
  });

  it('keeps filters in the address and sends them in the GET; the round link opens filtered', async () => {
    const filtered = `GET /api/manual-handling?page=1&pageSize=25&roundId=${ROUND_ID}&kind=locked`;
    const mock = stubPage({ [filtered]: () => jsonResponse(200, paged([lockedOut])) });
    renderRoutes(`/manual?roundId=${ROUND_ID}&kind=locked`);
    expect(await screen.findByText(NAME(lockedOut))).toBeInTheDocument();
    expect(urls(mock)).toContain(filtered);
    // A round from a link that isn't in the newest list still shows as chosen.
    expect(screen.getByRole('combobox', { name: text.roundFilter })).toHaveTextContent(
      text.chosenRound,
    );
  });

  it('sends the search text only in a POST body, with the filters', async () => {
    const mock = stubPage({ [SEARCH]: () => jsonResponse(200, paged([noEmail])) });
    const { router, user } = await openPage();
    await user.type(screen.getByRole('searchbox', { name: he.filters.search }), '000000018{Enter}');
    await waitFor(() => expect(urls(mock)).toContain(SEARCH));
    expect(bodyOf(mock, SEARCH)).toEqual({ page: 1, pageSize: 25, q: '000000018' });
    expect(urls(mock).filter((url) => url.includes('000000018'))).toEqual([]);
    expect(router.state.location.search).toBe('');
  });

  it('only ready rows can be selected; the selection clears when a filter or the search changes', async () => {
    stubPage({ [SEARCH]: () => jsonResponse(200, paged(ROWS)) });
    const { user } = await openPage();
    const box = (row: typeof noEmail) =>
      screen.getByRole('checkbox', { name: `${he.table.selectRow} ${NAME(row)}` });
    expect(box(noEmail)).toBeDisabled();
    await user.click(box(emailAdded));
    expect(screen.getByRole('status')).toHaveTextContent(he.table.selectedCount(1));
    expect(screen.getByRole('button', { name: text.send.selected })).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: he.filters.search }), 'לדוגמה{Enter}');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: text.send.selected })).toBeNull(),
    );
    await user.click(box(emailAdded));
    await user.click(screen.getByRole('combobox', { name: text.kindFilter }));
    await user.click(screen.getByRole('option', { name: text.kinds.no_email }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: text.send.selected })).toBeNull(),
    );
  });

  it('send selected: confirm, the ids in the body, a notice, the selection cleared', async () => {
    const mock = stubPage({
      [SEND]: () =>
        jsonResponse(202, {
          items: [
            {
              assignmentId: emailAdded.assignmentId,
              roundId: ROUND_ID,
              status: 'pending',
              emailMessageId: '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d',
            },
          ],
        }),
    });
    const { user } = await openPage();
    await user.click(
      screen.getByRole('checkbox', { name: `${he.table.selectRow} ${NAME(emailAdded)}` }),
    );
    await user.click(screen.getByRole('button', { name: text.send.selected }));
    const dialog = screen.getByRole('dialog', { name: text.send.title });
    await user.click(within(dialog).getByRole('button', { name: text.send.label }));
    expect(await screen.findByText(text.send.done(1, '1'))).toBeInTheDocument();
    expect(bodyOf(mock, SEND)).toEqual({ assignmentIds: [emailAdded.assignmentId] });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: text.send.selected })).toBeNull(),
    );
  });

  it('a 409 lists every refused row by name and why; nothing was sent', async () => {
    stubPage({
      [SEND]: () =>
        jsonResponse(409, {
          error: {
            code: 'MISSING_DATA_STILL_MISSING',
            message: 'x',
            details: {
              refused: [
                {
                  assignmentId: emailAdded.assignmentId,
                  code: 'MISSING_DATA_STILL_MISSING',
                  missing: ['כתובת'],
                },
              ],
            },
          },
        }),
    });
    const { user } = await openPage();
    await openMenu(user, emailAdded);
    await user.click(screen.getByRole('menuitem', { name: text.send.label }));
    const dialog = screen.getByRole('dialog', { name: text.send.title });
    await user.click(within(dialog).getByRole('button', { name: text.send.label }));
    expect(await within(dialog).findByText(text.send.refusedTitle)).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      `${NAME(emailAdded)}: ${errorMessage('MISSING_DATA_STILL_MISSING')} (כתובת)`,
    );
    expect(within(dialog).getByRole('button', { name: text.send.label })).toBeDisabled();
  });

  it('a 5xx may have sent it: "maybe" notice, the list fetched again, never resent', async () => {
    const mock = stubPage({ [SEND]: () => apiErrorResponse(500, 'INTERNAL_ERROR') });
    const { user } = await openPage();
    await openMenu(user, emailAdded);
    await user.click(screen.getByRole('menuitem', { name: text.send.label }));
    const dialog = screen.getByRole('dialog', { name: text.send.title });
    await user.click(within(dialog).getByRole('button', { name: text.send.label }));
    expect(await screen.findByText(text.send.maybe)).toBeInTheDocument();
    await waitFor(() => expect(urls(mock).filter((url) => url === LIST).length).toBe(2));
    expect(urls(mock).filter((url) => url === SEND)).toHaveLength(1);
  });

  it('fix email: pre-filled from the card, a real address required, the Har Gal reminder, PATCH { email }', async () => {
    const patch = `PATCH /api/employees/${noEmail.employee.id}`;
    const mock = stubPage({
      [`GET /api/employees/${noEmail.employee.id}`]: () =>
        jsonResponse(200, { ...card, id: noEmail.employee.id, email: 'typo@example' }),
      [patch]: () => jsonResponse(200, { ...card, id: noEmail.employee.id }),
    });
    const { user } = await openPage();
    await openMenu(user, noEmail);
    await user.click(screen.getByRole('menuitem', { name: text.fixEmail.label }));
    const dialog = screen.getByRole('dialog', { name: text.fixEmail.title(NAME(noEmail)) });
    expect(dialog).toHaveTextContent(text.harGal);
    const field = within(dialog).getByRole('textbox', { name: text.fixEmail.field });
    await waitFor(() => expect(field).toHaveValue('typo@example'));
    await user.click(within(dialog).getByRole('button', { name: text.fixEmail.confirm }));
    expect(within(dialog).getByText(text.fixEmail.invalid)).toBeInTheDocument();
    expect(urls(mock)).not.toContain(patch);

    await user.clear(field);
    await user.type(field, 'Fixed@Example.test');
    await user.click(within(dialog).getByRole('button', { name: text.fixEmail.confirm }));
    expect(await screen.findByText(text.fixEmail.done)).toBeInTheDocument();
    expect(bodyOf(mock, patch)).toEqual({ email: 'fixed@example.test' });
  });

  it('corrected email: "update to the new email" is pre-filled with the address she gave', async () => {
    const patch = `PATCH /api/employees/${corrected.employee.id}`;
    const mock = stubPage({
      [patch]: () => jsonResponse(200, { ...card, id: corrected.employee.id }),
    });
    const { user } = await openPage();
    await openMenu(user, corrected);
    await user.click(screen.getByRole('menuitem', { name: text.fixEmail.useGiven }));
    const dialog = screen.getByRole('dialog', { name: text.fixEmail.title(NAME(corrected)) });
    expect(within(dialog).getByRole('textbox', { name: text.fixEmail.field })).toHaveValue(
      'new@example.test',
    );
    expect(dialog).toHaveTextContent(text.harGal);
    await user.click(within(dialog).getByRole('button', { name: text.fixEmail.confirm }));
    expect(await screen.findByText(text.fixEmail.doneCorrected)).toBeInTheDocument();
    expect(bodyOf(mock, patch)).toEqual({ email: 'new@example.test' });
  });

  it('print is a plain new-tab link, fetched only on the click; missing data has none', async () => {
    const mock = stubPage();
    const { user } = await openPage();
    const menu = await openMenu(user, lockedOut);
    const print = within(menu).getByRole('menuitem', { name: new RegExp(text.print.label) });
    expect(print).toHaveAttribute('href', `/api/assignments/${lockedOut.assignmentId}/print`);
    expect(print).toHaveAttribute('target', '_blank');
    expect(print).toHaveAttribute('rel', 'noreferrer');
    expect(urls(mock).some((url) => url.includes('/print'))).toBe(false);
    await user.keyboard('{Escape}');
    const missingMenu = await openMenu(user, missingData);
    expect(
      within(missingMenu).queryByRole('menuitem', { name: new RegExp(text.print.label) }),
    ).toBeNull();
    expect(within(missingMenu).getByRole('menuitem', { name: text.editCard })).toHaveAttribute(
      'href',
      `/employees/${missingData.employee.id}/edit`,
    );
  });

  it('upload scan: a PDF in a FormData to manual-sign, then a notice', async () => {
    const path = `POST /api/assignments/${lockedOut.assignmentId}/manual-sign`;
    const mock = stubPage({
      [path]: () =>
        jsonResponse(201, {
          assignmentId: lockedOut.assignmentId,
          roundId: ROUND_ID,
          status: 'signed_manual',
          signedAt: '2026-10-28T10:00:00.000Z',
          fileSha256: 'a'.repeat(64),
        }),
    });
    const { user } = await openPage();
    await openMenu(user, lockedOut);
    await user.click(screen.getByRole('menuitem', { name: text.scan.label }));
    const dialog = screen.getByRole('dialog', { name: text.scan.title(NAME(lockedOut)) });
    await user.click(within(dialog).getByRole('button', { name: text.scan.confirm }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(text.scan.required);

    const file = new File(['%PDF-1.7'], 'scan.pdf', { type: 'application/pdf' });
    const input = dialog.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
    await user.upload(input, file);
    await user.click(within(dialog).getByRole('button', { name: text.scan.confirm }));
    expect(await screen.findByText(text.scan.done)).toBeInTheDocument();
    const body = mock.mock.calls.find(
      ([url, init]) => `${init?.method ?? 'GET'} ${typeof url === 'string' ? url : ''}` === path,
    )?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBe(file);
  });

  it('office kiosk: asks first, then shows the short code, until when and where; nothing kept', async () => {
    const path = `POST /api/assignments/${noEmail.assignmentId}/kiosk`;
    const expiresAt = '2026-10-29T08:40:00.000Z';
    const mock = stubPage({
      [path]: () =>
        jsonResponse(201, {
          assignmentId: noEmail.assignmentId,
          shortCode: 'ABCDEFGH',
          expiresAt,
          kioskPath: '/kiosk',
        }),
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const before = window.location.href;
    const { user } = await openPage();
    await openMenu(user, noEmail);
    await user.click(screen.getByRole('menuitem', { name: text.kiosk.label }));
    const title = text.kiosk.title(NAME(noEmail));
    const ask = screen.getByRole('dialog', { name: title });
    expect(urls(mock)).not.toContain(path);
    await user.click(within(ask).getByRole('button', { name: text.kiosk.label }));

    const shown = await screen.findByText('ABCD-EFGH');
    const dialog = screen.getByRole('dialog', { name: title });
    expect(within(dialog).getByText(text.kiosk.validUntil(formatTime(expiresAt)))).toBeVisible();
    expect(
      within(dialog).getByText(text.kiosk.instructions(`${window.location.origin}/kiosk`)),
    ).toBeVisible();
    expect(shown).toHaveAttribute('dir', 'ltr');
    expect(urls(mock).filter((url) => url === path)).toHaveLength(1);
    // Not in the address, browser storage or a notice.
    expect(window.location.href).toBe(before);
    expect(setItem).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: text.kiosk.close }));
    await waitFor(() => expect(screen.queryByText('ABCD-EFGH')).toBeNull());
    setItem.mockRestore();
  });

  it('office kiosk on a row that can still be unlocked: unlock first, with the round link', async () => {
    const path = `POST /api/assignments/${lockedOut.assignmentId}/kiosk`;
    stubPage({ [path]: () => apiErrorResponse(409, 'ASSIGNMENT_LOCKED') });
    const { user } = await openPage();
    await openMenu(user, lockedOut);
    await user.click(screen.getByRole('menuitem', { name: text.kiosk.label }));
    const dialog = screen.getByRole('dialog', { name: text.kiosk.title(NAME(lockedOut)) });
    await user.click(within(dialog).getByRole('button', { name: text.kiosk.label }));
    expect(await within(dialog).findByText(new RegExp(text.kiosk.lockedFirst))).toBeVisible();
    expect(within(dialog).getByRole('link', { name: text.kiosk.toRound })).toHaveAttribute(
      'href',
      `/rounds/${ROUND_ID}`,
    );
    expect(within(dialog).getByRole('button', { name: text.kiosk.label })).toBeDisabled();
  });

  it('a manager sees the two tabs of A10', async () => {
    stubPage();
    await openPage();
    const tabs = screen.getByRole('tablist', { name: text.tabs.label });
    expect(within(tabs).getByRole('tab', { name: text.tabs.list })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(tabs).getByRole('tab', { name: text.tabs.approvals })).toHaveAttribute(
      'href',
      '/manual/approvals',
    );
  });
});
