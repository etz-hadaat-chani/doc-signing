import {
  approvedSchema,
  assignmentCancelledSchema,
  assignmentEmailQueuedSchema,
  assignmentResponsesSchema,
  assignmentUnlockedSchema,
  returnedSchema,
  roundRemindedSchema,
  sentAgainSchema,
} from '@doc-signing/shared';
import { staffRequest } from '../../auth/staff-api';

/**
 * The manager's actions on a round and its rows (3.12) and the approvals (3.16 part B2). No body
 * but the return note; only ids in the paths.
 */

const assignmentPath = (id: string, action: string) =>
  `/api/assignments/${encodeURIComponent(id)}/${action}` as const;

/**
 * One row's answers. Outside `roundKeys` on purpose: an action invalidates `roundKeys.all`, and
 * every fetch of the answers is an audit row (`assignment.responses_viewed`).
 */
export const answersKeys = {
  all: ['staff', 'answers'] as const,
  one: (assignmentId: string) => ['staff', 'answers', assignmentId] as const,
};

export function remindAssignment(id: string) {
  return staffRequest(assignmentPath(id, 'remind'), {
    method: 'POST',
    schema: assignmentEmailQueuedSchema,
  });
}

export function resendAssignment(id: string) {
  return staffRequest(assignmentPath(id, 'resend'), {
    method: 'POST',
    schema: assignmentEmailQueuedSchema,
  });
}

export function unlockAssignment(id: string) {
  return staffRequest(assignmentPath(id, 'unlock'), {
    method: 'POST',
    schema: assignmentUnlockedSchema,
  });
}

export function cancelAssignment(id: string) {
  return staffRequest(assignmentPath(id, 'cancel'), {
    method: 'POST',
    schema: assignmentCancelledSchema,
  });
}

/** Reminds every `sent` / `opened` row that can get one; the answer counts the rest. */
export function remindRound(id: string) {
  return staffRequest(`/api/rounds/${encodeURIComponent(id)}/remind`, {
    method: 'POST',
    schema: roundRemindedSchema,
  });
}

/** Everything she filled in; drawings as 5-minute links. Logged as a view. */
export function fetchResponses(id: string, signal?: AbortSignal) {
  return staffRequest(assignmentPath(id, 'responses'), {
    schema: assignmentResponsesSchema,
    signal,
  });
}

export function approveAssignment(id: string) {
  return staffRequest(assignmentPath(id, 'approve'), { method: 'POST', schema: approvedSchema });
}

export function returnAssignment(id: string, note: string) {
  return staffRequest(assignmentPath(id, 'return'), {
    method: 'POST',
    body: { note },
    schema: returnedSchema,
  });
}

/** A correction round for this one employee, created and sent at once. */
export function sendAgain(id: string) {
  return staffRequest(assignmentPath(id, 'send-again'), {
    method: 'POST',
    schema: sentAgainSchema,
  });
}
