import type { ApprovalRow, AssignmentResponses } from '@doc-signing/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../i18n/he';
import { jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, officerUser, renderRoutes } from '../../test/render';
import { paged, ROUND_ID } from './manual.fixtures';

/** Made-up data. Never an ID number, an answer in the list or an address. */
const ASSIGNMENT_ID = '4e5f6a7b-8c9d-4e0f-8a1b-000000000077';
const row: ApprovalRow = {
  assignmentId: ASSIGNMENT_ID,
  round: { id: ROUND_ID, name: 'סבב לדוגמה', status: 'active', isCorrection: false },
  document: { id: '6a7b8c9d-0e1f-4a2b-8c3d-000000000001', name: 'מסמך לדוגמה', version: 2 },
  department: { id: '1b2c3d4e-5f6a-4b7c-8d8e-9f0a1b2c3d4e', code: 15, label: '15 - מחלקה' },
  employee: {
    id: '5f6a7b8c-9d0e-4f1a-8b2c-000000000077',
    employeeNumber: '9077',
    firstName: 'עובדת',
    lastName: 'לדוגמה',
  },
  signedAt: '2026-10-27T09:00:00.000Z',
  signMethod: 'kiosk',
  reasons: [{ key: 'b2', label: 'יש לי מחלה כרונית' }],
};
const responses: AssignmentResponses = {
  assignmentId: ASSIGNMENT_ID,
  roundId: ROUND_ID,
  status: 'signed',
  approval: 'waiting',
  returnedAt: null,
  returnNote: null,
  answers: [
    {
      key: 'b2',
      label: 'יש לי מחלה כרונית',
      type: 'checkbox',
      needsApproval: true,
      value: 'true',
      drawing: null,
    },
  ],
  emailAnswer: { choice: 'office', choiceLabel: 'במשרד', email: null, differsFromStored: false },
};

const text = he.manual;
const actions = he.rounds.actions;
const NAME = `${row.employee.firstName} ${row.employee.lastName}`;
const LIST = 'GET /api/approvals?page=1&pageSize=25';

function stubPage(user = managerUser, list = LIST) {
  return stubApi({
    'GET /api/auth/me': meAnswer(user),
    'GET /api/rounds?page=1&pageSize=100': () => jsonResponse(200, { ...paged([]), pageSize: 100 }),
    [list]: () => jsonResponse(200, paged([row])),
    [`GET /api/assignments/${ASSIGNMENT_ID}/responses`]: () => jsonResponse(200, responses),
  });
}

const urls = (mock: ReturnType<typeof stubPage>) =>
  mock.mock.calls.map(
    ([url, init]) => `${init?.method ?? 'GET'} ${typeof url === 'string' ? url : ''}`,
  );

async function openPage(entry = '/manual/approvals') {
  const rendered = renderRoutes(entry);
  await screen.findByRole('table', { name: text.approvals.listCaption }, { timeout: 5000 });
  await screen.findByText(NAME);
  return rendered;
}

describe('ApprovalsPage (A10, waiting for approval)', () => {
  it('manager: the tabs, the row with its reasons, the answers with approve and return', async () => {
    stubPage();
    const { user } = await openPage();
    const tabs = screen.getByRole('tablist', { name: text.tabs.label });
    expect(within(tabs).getByRole('tab', { name: text.tabs.approvals })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const line = screen.getByRole('row', { name: /9077/ });
    expect(within(line).getByText('יש לי מחלה כרונית')).toBeInTheDocument();
    expect(within(line).getByText(text.approvals.signMethods.kiosk)).toBeInTheDocument();
    expect(within(line).getByText(new RegExp(text.approvals.version(2)))).toBeInTheDocument();

    await user.click(within(line).getByRole('button', { name: actions.answersFor(NAME) }));
    const panel = await screen.findByRole('presentation');
    expect(await within(panel).findByRole('button', { name: actions.approve.label })).toBeVisible();
    expect(
      within(panel).getByRole('button', { name: actions.returnForCorrection.label }),
    ).toBeVisible();
  });

  it('officer: the list and the answers, no tabs and no buttons', async () => {
    stubPage(officerUser);
    const { user } = await openPage();
    expect(screen.getByRole('heading', { level: 1, name: he.nav.approvals })).toBeVisible();
    expect(screen.queryByRole('tablist')).toBeNull();
    await user.click(screen.getByRole('button', { name: actions.answersFor(NAME) }));
    const panel = await screen.findByRole('presentation');
    expect(await within(panel).findByText(actions.panel.waiting)).toBeVisible();
    expect(within(panel).queryByRole('button', { name: actions.approve.label })).toBeNull();
    expect(
      within(panel).queryByRole('button', { name: actions.returnForCorrection.label }),
    ).toBeNull();
  });

  it('the round filter comes from the address and goes in the GET', async () => {
    const list = `GET /api/approvals?page=1&pageSize=25&roundId=${ROUND_ID}`;
    const mock = stubPage(managerUser, list);
    await openPage(`/manual/approvals?roundId=${ROUND_ID}`);
    await waitFor(() => expect(urls(mock)).toContain(list));
    expect(screen.getByRole('combobox', { name: text.roundFilter })).toHaveTextContent(
      text.chosenRound,
    );
  });
});
