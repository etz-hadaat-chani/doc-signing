import { type AssignmentRow, errorMessage, MAX_UNLOCKS } from '@doc-signing/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../../test/fetch-stub';
import { managerUser, meAnswer, officerUser, renderRoutes } from '../../../test/render';
import {
  details,
  detailsPath,
  paged,
  ROUND_ID,
  row,
  signedRow,
  tablePath,
} from '../round-details.fixtures';

const text = he.rounds.actions;
const NAME = `${row.firstName} ${row.lastName}`;
const actionPath = (action: string, id = row.assignmentId) => `/api/assignments/${id}/${action}`;

function stubRow(
  shown: AssignmentRow,
  routes: Record<string, () => Response> = {},
  user: typeof managerUser = managerUser,
) {
  return stubApi({
    'GET /api/auth/me': meAnswer(user),
    [`GET ${detailsPath}`]: () => jsonResponse(200, details),
    [`GET ${tablePath()}`]: () => jsonResponse(200, paged([shown, signedRow])),
    ...routes,
  });
}

const callsTo = (mock: ReturnType<typeof stubRow>, url: string, method = 'GET') =>
  mock.mock.calls.filter(([called, init]) => called === url && (init?.method ?? 'GET') === method)
    .length;

async function openMenu() {
  const rendered = renderRoutes(`/rounds/${ROUND_ID}`);
  const menuButton = await screen.findByRole('button', { name: text.menuFor(NAME) });
  await rendered.user.click(menuButton);
  return rendered;
}

const queued =
  (status = 'sent') =>
  () =>
    jsonResponse(202, {
      assignmentId: row.assignmentId,
      roundId: ROUND_ID,
      emailMessageId: '0f3e2d1c-4b5a-4687-9a1b-2c3d4e5f6a7b',
      status,
    });

describe('RowActions', () => {
  it('lists what the status allows: a sent row gets remind, manual handling and cancel', async () => {
    stubRow(row);
    await openMenu();
    const menu = screen.getByRole('menu');
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(items).toEqual([
      text.remind.label,
      `${text.manual}${text.manualHint}`,
      text.cancel.label,
    ]);
    expect(within(menu).getByRole('menuitem', { name: new RegExp(text.manual) })).toHaveAttribute(
      'href',
      `/manual?roundId=${ROUND_ID}`,
    );
  });

  it('remind: confirm, one request even on a double click, a notice, the table fetched again', async () => {
    const mock = stubRow(row, { [`POST ${actionPath('remind')}`]: queued() });
    const { user } = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: text.remind.label }));
    const dialog = screen.getByRole('dialog', { name: text.remind.label });
    expect(dialog).toHaveTextContent(text.remind.text(NAME));
    const confirm = within(dialog).getByRole('button', { name: text.remind.label });
    await user.dblClick(confirm);
    expect(await screen.findByText(text.remind.done)).toBeInTheDocument();
    expect(callsTo(mock, actionPath('remind'), 'POST')).toBe(1);
    await waitFor(() => expect(callsTo(mock, tablePath())).toBe(2));
    await waitFor(() => expect(callsTo(mock, detailsPath)).toBe(2));
  });

  it('a refusal shows the Hebrew text of its code (409 REMIND_TOO_SOON)', async () => {
    stubRow(row, {
      [`POST ${actionPath('remind')}`]: () => apiErrorResponse(409, 'REMIND_TOO_SOON'),
    });
    const { user } = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: text.remind.label }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: text.remind.label }));
    expect(await screen.findByText(errorMessage('REMIND_TOO_SOON'))).toBeInTheDocument();
  });

  it('unlock shows the unlocks left and asks to check with the employee first', async () => {
    const locked: AssignmentRow = {
      ...row,
      status: 'opened',
      displayStatus: 'locked',
      locked: true,
      unlocksLeft: 1,
    };
    const mock = stubRow(locked, {
      [`POST ${actionPath('unlock')}`]: () =>
        jsonResponse(200, {
          assignmentId: row.assignmentId,
          roundId: ROUND_ID,
          status: 'opened',
          unlocksLeft: 0,
        }),
    });
    const { user } = await openMenu();
    const item = screen.getByRole('menuitem', { name: new RegExp(text.unlock.label) });
    expect(item).toHaveTextContent(text.unlock.left(1, MAX_UNLOCKS));
    await user.click(item);
    const dialog = screen.getByRole('dialog', { name: text.unlock.label });
    expect(dialog).toHaveTextContent(text.unlock.text(NAME));
    expect(dialog).toHaveTextContent(text.unlock.leftLine(1, MAX_UNLOCKS));
    await user.click(within(dialog).getByRole('button', { name: text.unlock.label }));
    expect(await screen.findByText(text.unlock.done)).toBeInTheDocument();
    expect(callsTo(mock, actionPath('unlock'), 'POST')).toBe(1);
  });

  it('at 0 unlocks left: "handle at the office" links to the row in manual handling, no cancel', async () => {
    const lockedOut: AssignmentRow = {
      ...row,
      status: 'opened',
      displayStatus: 'locked',
      locked: true,
      unlocksLeft: 0,
    };
    const mock = stubRow(lockedOut);
    await openMenu();
    const menu = screen.getByRole('menu');
    expect(
      within(menu).queryByRole('menuitem', { name: new RegExp(text.unlock.label) }),
    ).toBeNull();
    const office = within(menu).getByRole('menuitem', { name: new RegExp(text.office.label) });
    expect(office).toHaveAttribute('href', `/manual?roundId=${ROUND_ID}&kind=locked`);
    expect(office).toHaveTextContent(text.office.hint);
    // The ordinary cancel stays, like on every open row; the office link cancels nothing.
    expect(within(menu).getByRole('menuitem', { name: text.cancel.label })).toBeInTheDocument();
    expect(callsTo(mock, actionPath('cancel'), 'POST')).toBe(0);
  });

  it('cancel can be stopped: "חזרה" sends nothing', async () => {
    const mock = stubRow(row);
    const { user } = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: text.cancel.label }));
    await user.click(screen.getByRole('button', { name: text.keep }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(callsTo(mock, actionPath('cancel'), 'POST')).toBe(0);
  });

  it('an officer sees the rows without any action button', async () => {
    stubRow(row, {}, officerUser);
    renderRoutes(`/rounds/${ROUND_ID}`);
    await screen.findByText(he.rounds.table.employeeNumber(row.employeeNumber));
    expect(screen.queryByRole('button', { name: text.menuFor(NAME) })).toBeNull();
    expect(screen.queryByRole('button', { name: text.remindAll.label })).toBeNull();
    expect(screen.queryByRole('button', { name: text.cancelRound.label })).toBeNull();
  });
});
