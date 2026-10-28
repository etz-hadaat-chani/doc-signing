import {
  type AssignmentAnswer,
  type AssignmentRow,
  type AssignmentStatus,
  CANCELLABLE_STATUSES,
  type DisplayStatus,
  formatDate,
  MANUAL_PRINTABLE_STATUSES,
  type RoundStatus,
} from '@doc-signing/shared';
import { he } from '../../../i18n/he';

/**
 * A row's actions in the "פעולות" menu (3.12 rules, the API still decides): by display status.
 * - `remind`: sent / opened.
 * - `resend`: "send failed" or a wrong email.
 * - `unlock`: locked and the link not expired (the API's rule: also a `no_email` row locked at
 *   the kiosk, whose display status stays "no email" with the locked chip), while an unlock is
 *   left; `officeCancel` replaces it at 0.
 * - `cancel`: every open row (also a draft's, also locked or expired).
 * - `manual`: a link to manual handling (print, scan, office signing; 5.7).
 * Approve / return / send again live with the answers (AnswersPanel).
 */
export type RowAction = 'remind' | 'resend' | 'unlock' | 'officeCancel' | 'cancel' | 'manual';

type ActionRow = Pick<AssignmentRow, 'status' | 'displayStatus' | 'locked' | 'unlocksLeft'>;

const SENT_ROUND: readonly RoundStatus[] = ['sending', 'active'];
const OPEN_ROUND: readonly RoundStatus[] = ['draft', ...SENT_ROUND];
const REMIND: readonly DisplayStatus[] = ['sent', 'opened'];
const RESEND: readonly DisplayStatus[] = ['send_failed', 'invalid_email'];
const MANUAL: readonly AssignmentStatus[] = [...MANUAL_PRINTABLE_STATUSES, 'missing_data'];

export function rowActions(row: ActionRow, roundStatus: RoundStatus): RowAction[] {
  if (!OPEN_ROUND.includes(roundStatus)) return [];
  const sent = SENT_ROUND.includes(roundStatus);
  const actions: RowAction[] = [];
  if (sent && REMIND.includes(row.displayStatus)) actions.push('remind');
  if (sent && RESEND.includes(row.displayStatus)) actions.push('resend');
  if (sent && row.locked && row.displayStatus !== 'expired') {
    actions.push(row.unlocksLeft > 0 ? 'unlock' : 'officeCancel');
  }
  if (sent && MANUAL.includes(row.status)) actions.push('manual');
  if (
    (CANCELLABLE_STATUSES as readonly AssignmentStatus[]).includes(row.status) &&
    !actions.includes('officeCancel')
  ) {
    actions.push('cancel');
  }
  return actions;
}

/** The answers can be opened: she filled in boxes, or the row is in the approval flow. */
export function hasAnswersPanel(
  row: Pick<AssignmentRow, 'hasAnswers' | 'approval' | 'returned'>,
): boolean {
  return row.hasAnswers || row.approval !== null || row.returned !== null;
}

/** A returned row whose correction round wasn't sent yet: "send again" (managers). */
export function canSendAgain(row: Pick<AssignmentRow, 'returned'>): boolean {
  return row.returned !== null && row.returned.correctionRound === null;
}

const DATE_VALUE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** An answer as text: yes / no for a box, DD/MM/YYYY for a date, else as typed. */
export function answerText(answer: Pick<AssignmentAnswer, 'value'>): string {
  const { value } = answer;
  if (value === null || value === '') return he.rounds.none;
  if (value === 'true') return he.rounds.actions.panel.yes;
  if (value === 'false') return he.rounds.actions.panel.no;
  const date = DATE_VALUE.exec(value);
  if (date) return `${date[3]}/${date[2]}/${date[1]}`;
  return value;
}

/**
 * When to fetch the answers again so the drawings show: the earliest drawing link's expiry, or
 * null when there is no drawing.
 */
export function drawingsExpireAt(answers: readonly Pick<AssignmentAnswer, 'drawing'>[]) {
  const times = answers.flatMap(({ drawing }) =>
    drawing === null ? [] : [Date.parse(drawing.expiresAt)],
  );
  return times.length === 0 ? null : Math.min(...times);
}

export const returnedText = (at: string) => he.rounds.actions.panel.returned(formatDate(at));
