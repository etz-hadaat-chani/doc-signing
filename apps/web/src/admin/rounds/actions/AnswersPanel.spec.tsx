import {
  type AssignmentResponses,
  type AssignmentRow,
  errorMessage,
  RETURN_NOTE_MAX_LENGTH,
} from '@doc-signing/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../../test/fetch-stub';
import { managerUser, meAnswer, officerUser, renderRoutes } from '../../../test/render';
import {
  CORRECTION_ROUND_ID,
  details,
  detailsPath,
  paged,
  ROUND_ID,
  signedRow,
  tablePath,
} from '../round-details.fixtures';

const text = he.rounds.actions;
/** A request's JSON body, or null. */
const bodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;

const waitingRow: AssignmentRow = { ...signedRow, hasAnswers: true, approval: 'waiting' };
const NAME = `${waitingRow.firstName} ${waitingRow.lastName}`;
const path = (action: string, id = waitingRow.assignmentId) => `/api/assignments/${id}/${action}`;

const responses = (extra: Partial<AssignmentResponses> = {}): AssignmentResponses => ({
  assignmentId: waitingRow.assignmentId,
  roundId: ROUND_ID,
  status: 'signed',
  approval: 'waiting',
  returnedAt: null,
  returnNote: null,
  answers: [
    {
      key: 'b1',
      label: 'מצב משפחתי',
      type: 'select',
      needsApproval: false,
      value: 'נשוי',
      drawing: null,
    },
    {
      key: 'b2',
      label: 'יש לי מחלה כרונית',
      type: 'checkbox',
      needsApproval: true,
      value: 'true',
      drawing: null,
    },
    {
      key: 'b3',
      label: 'תאריך לידה',
      type: 'date_input',
      needsApproval: false,
      value: '1990-05-17',
      drawing: null,
    },
    {
      key: 'b4',
      label: 'הערות',
      type: 'long_text',
      needsApproval: false,
      value: 'שורה ראשונה\nשורה שנייה',
      drawing: null,
    },
  ],
  emailAnswer: { choice: 'office', choiceLabel: 'במשרד', email: null, differsFromStored: false },
  ...extra,
});

type Routes = Record<string, (init: RequestInit) => Response>;

function stubPanel(
  shown: AssignmentRow,
  answer: () => AssignmentResponses,
  routes: Routes = {},
  user = managerUser,
) {
  return stubApi({
    'GET /api/auth/me': meAnswer(user),
    [`GET ${detailsPath}`]: () => jsonResponse(200, details),
    [`GET ${tablePath()}`]: () => jsonResponse(200, paged([shown])),
    [`GET ${path('responses', shown.assignmentId)}`]: () => jsonResponse(200, answer()),
    ...routes,
  });
}

const callsTo = (mock: ReturnType<typeof stubPanel>, url: string, method = 'GET') =>
  mock.mock.calls.filter(([called, init]) => called === url && (init?.method ?? 'GET') === method);

async function openPanel(name = NAME) {
  const rendered = renderRoutes(`/rounds/${ROUND_ID}`);
  const button = await screen.findByRole('button', { name: text.answersFor(name) });
  await rendered.user.click(button);
  const panel = await screen.findByRole('presentation');
  await within(panel).findByText('מצב משפחתי');
  return { ...rendered, panel };
}

describe('AnswersPanel', () => {
  it('is fetched on click only and shows the answers in order, as text', async () => {
    const mock = stubPanel(waitingRow, () => responses());
    renderRoutes(`/rounds/${ROUND_ID}`);
    await screen.findByRole('button', { name: text.answersFor(NAME) });
    expect(callsTo(mock, path('responses'))).toHaveLength(0);
    const { panel } = await openPanel();
    expect(callsTo(mock, path('responses'))).toHaveLength(1);
    const terms = within(panel)
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(terms).toEqual([
      'מצב משפחתי',
      `יש לי מחלה כרונית${text.panel.needsApproval}`,
      'תאריך לידה',
      'הערות',
      text.panel.emailTitle,
    ]);
    expect(panel).toHaveTextContent(text.panel.yes);
    expect(panel).toHaveTextContent('17/05/1990');
    expect(
      within(panel)
        .getByText(/שורה ראשונה/)
        .closest('dd'),
    ).toHaveStyle({
      whiteSpace: 'pre-line',
    });
    expect(panel).toHaveTextContent('במשרד');
  });

  it('its own key: "רענון" and a window focus never fetch it again (each fetch is logged)', async () => {
    const mock = stubPanel(waitingRow, () => responses());
    const { user } = await openPanel();
    await user.click(screen.getByRole('button', { name: text.panel.close }));
    await waitFor(() => expect(screen.queryByRole('presentation')).toBeNull());
    // Open again: one more view, by choice.
    await user.click(screen.getByRole('button', { name: text.answersFor(NAME) }));
    await waitFor(() => expect(callsTo(mock, path('responses'))).toHaveLength(2));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await user.click(screen.getByRole('button', { name: text.panel.close }));
    await waitFor(() => expect(screen.queryByRole('presentation')).toBeNull());
    await user.click(screen.getByRole('button', { name: he.rounds.details.refresh }));
    await waitFor(() => expect(callsTo(mock, tablePath())).toHaveLength(2));
    expect(callsTo(mock, path('responses'))).toHaveLength(2);
  });

  it('fetches again when the drawing links expire, so the drawings keep showing', async () => {
    const drawing = (seconds: number) =>
      responses({
        answers: [
          {
            key: 'd1',
            label: 'מצב משפחתי',
            type: 'drawing',
            needsApproval: false,
            value: null,
            drawing: {
              url: 'https://storage.test/d1',
              expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
            },
          },
        ],
      });
    let fetches = 0;
    const mock = stubPanel(waitingRow, () => {
      fetches += 1;
      return drawing(fetches === 1 ? 1 : 300);
    });
    const { panel } = await openPanel();
    expect(
      within(panel).getByRole('img', { name: text.panel.drawingAlt('מצב משפחתי') }),
    ).toHaveAttribute('src', 'https://storage.test/d1');
    await waitFor(() => expect(callsTo(mock, path('responses'))).toHaveLength(2), {
      timeout: 4000,
    });
  });

  it('approve: one request, the panel and the table fetched again', async () => {
    let approved = false;
    const mock = stubPanel(waitingRow, () => responses(approved ? { approval: 'approved' } : {}), {
      [`POST ${path('approve')}`]: () => {
        approved = true;
        return jsonResponse(200, {
          assignmentId: waitingRow.assignmentId,
          approvedAt: '2026-10-28T09:00:00.000Z',
        });
      },
    });
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole('button', { name: text.approve.label }));
    const dialog = screen.getByRole('dialog', { name: text.approve.title });
    await user.dblClick(within(dialog).getByRole('button', { name: text.approve.label }));
    expect(await within(panel).findByText(text.panel.approved)).toBeInTheDocument();
    expect(callsTo(mock, path('approve'), 'POST')).toHaveLength(1);
    await waitFor(() => expect(callsTo(mock, tablePath())).toHaveLength(2));
  });

  it('return for correction needs a note (counter, 500 max) and shows it as plain text', async () => {
    const note = '<b>לתקן</b> את התאריך\nותודה';
    let returned = false;
    const mock = stubPanel(
      waitingRow,
      () =>
        responses(
          returned
            ? {
                status: 'cancelled',
                approval: null,
                returnedAt: '2026-10-28T09:00:00.000Z',
                returnNote: note,
              }
            : {},
        ),
      {
        [`POST ${path('return')}`]: () => {
          returned = true;
          return jsonResponse(200, {
            assignmentId: waitingRow.assignmentId,
            status: 'cancelled',
            returnedAt: '2026-10-28T09:00:00.000Z',
          });
        },
      },
    );
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole('button', { name: text.returnForCorrection.label }));
    const dialog = screen.getByRole('dialog', { name: text.returnForCorrection.label });
    const confirm = within(dialog).getByRole('button', { name: text.returnForCorrection.label });
    expect(confirm).toBeDisabled();
    const field = within(dialog).getByRole('textbox', { name: text.returnForCorrection.note });
    await user.type(field, '   ');
    expect(confirm).toBeDisabled();
    await user.clear(field);
    await user.type(field, note.replace('\n', '{Shift>}{Enter}{/Shift}'));
    expect(dialog).toHaveTextContent(
      text.returnForCorrection.noteHelp(note.length, RETURN_NOTE_MAX_LENGTH),
    );
    await user.click(confirm);
    expect(await screen.findByText(text.returnForCorrection.done)).toBeInTheDocument();
    const [request] = callsTo(mock, path('return'), 'POST');
    expect(bodyOf(request?.[1])).toEqual({ note });
    const shown = await within(panel).findByText(/לתקן/);
    expect(shown).toHaveStyle({ whiteSpace: 'pre-line' });
    expect(shown.textContent).toBe(note);
    expect(panel.querySelector('b')).toBeNull();
  });

  it('send again from a returned row; an existing correction round is a link', async () => {
    const returnedRow: AssignmentRow = {
      ...waitingRow,
      status: 'cancelled',
      displayStatus: 'returned_for_correction',
      approval: null,
      returned: { at: '2026-10-28T09:00:00.000Z', correctionRound: null },
    };
    stubPanel(
      returnedRow,
      () =>
        responses({
          status: 'cancelled',
          approval: null,
          returnedAt: '2026-10-28T09:00:00.000Z',
          returnNote: 'לתקן',
        }),
      {
        [`POST ${path('send-again')}`]: () =>
          jsonResponse(409, {
            error: {
              code: 'CORRECTION_ROUND_EXISTS',
              message: 'x',
              details: { roundId: CORRECTION_ROUND_ID },
            },
          }),
      },
    );
    const { user, panel } = await openPanel();
    expect(panel).toHaveTextContent(text.panel.returned('28/10/2026'));
    await user.click(within(panel).getByRole('button', { name: text.sendAgain.label }));
    const dialog = screen.getByRole('dialog', { name: text.sendAgain.label });
    await user.click(within(dialog).getByRole('button', { name: text.sendAgain.label }));
    expect(await within(panel).findByText(text.sendAgain.exists)).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: text.sendAgain.toRound })).toHaveAttribute(
      'href',
      `/rounds/${CORRECTION_ROUND_ID}`,
    );
    expect(screen.queryByText(errorMessage('CORRECTION_ROUND_EXISTS'))).toBeNull();
  });

  it('a send-again refusal shows its Hebrew text', async () => {
    const returnedRow: AssignmentRow = {
      ...waitingRow,
      status: 'cancelled',
      displayStatus: 'returned_for_correction',
      approval: null,
      returned: { at: '2026-10-28T09:00:00.000Z', correctionRound: null },
    };
    stubPanel(
      returnedRow,
      () =>
        responses({ status: 'cancelled', approval: null, returnedAt: '2026-10-28T09:00:00.000Z' }),
      { [`POST ${path('send-again')}`]: () => apiErrorResponse(409, 'EMPLOYEE_INACTIVE') },
    );
    const { user, panel } = await openPanel();
    await user.click(within(panel).getByRole('button', { name: text.sendAgain.label }));
    const dialog = screen.getByRole('dialog', { name: text.sendAgain.label });
    await user.click(within(dialog).getByRole('button', { name: text.sendAgain.label }));
    expect(await screen.findByText(errorMessage('EMPLOYEE_INACTIVE'))).toBeInTheDocument();
  });

  it('an officer reads the same panel without approve, return or send again', async () => {
    stubPanel(waitingRow, () => responses(), {}, officerUser);
    const { panel } = await openPanel();
    expect(panel).toHaveTextContent(text.panel.waiting);
    expect(within(panel).queryByRole('button', { name: text.approve.label })).toBeNull();
    expect(
      within(panel).queryByRole('button', { name: text.returnForCorrection.label }),
    ).toBeNull();
  });
});
