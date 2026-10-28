import {
  assignmentRowSchema,
  type AssignmentTableQuery,
  pagedSchema,
  type roundCreateSchema,
  roundDetailsSchema,
  roundListItemSchema,
  type RoundListQuery,
  type RoundExportQuery,
  roundCancelledSchema,
  roundCreatedSchema,
  type recipientsPreviewSchema,
  recipientsPreviewReportSchema,
  roundSentSchema,
} from '@doc-signing/shared';
import type { z } from 'zod';
import { staffRequest } from '../auth/staff-api';

/** Every round query: invalidate `all` after a round is created, sent or cancelled. */
export const roundKeys = {
  all: ['staff', 'rounds'] as const,
  list: (query: RoundListQuery) => ['staff', 'rounds', 'list', query] as const,
  /** Everything of one round: its details and every table page. */
  round: (roundId: string) => ['staff', 'rounds', 'round', roundId] as const,
  details: (roundId: string) => ['staff', 'rounds', 'round', roundId, 'details'] as const,
  assignments: (roundId: string, request: AssignmentTableQuery) =>
    ['staff', 'rounds', 'round', roundId, 'assignments', request] as const,
};

type QueryValue = string | number | boolean | readonly string[] | undefined;

/** `?a=1&status=x&status=y` in the given key order; undefined values left out. */
function queryString(values: Readonly<Record<string, QueryValue>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

const roundPath = (roundId: string) => `/api/rounds/${encodeURIComponent(roundId)}` as const;

/** The round list (A3), newest first. */
export function fetchRounds(query: RoundListQuery, signal?: AbortSignal) {
  const search = queryString({ status: query.status, page: query.page, pageSize: query.pageSize });
  return staffRequest(`/api/rounds${search}`, {
    schema: pagedSchema(roundListItemSchema),
    signal,
  });
}

/** One round (A4 header, counts, departments, progress). */
export function fetchRound(roundId: string, signal?: AbortSignal) {
  return staffRequest(roundPath(roundId), { schema: roundDetailsSchema, signal });
}

/** The table's filters only: what the export and the address may carry. */
export type AssignmentFilters = RoundExportQuery;

function filterValues(filters: AssignmentFilters) {
  return {
    status: filters.status,
    dept: filters.dept,
    approval: filters.approval,
    returned: filters.returned,
  };
}

/**
 * One page of the employee table. With search text it is the POST route with `q` in the body
 * (it may be an ID number, so never in a URL); without it the GET with filters and paging.
 */
export function fetchAssignments(
  roundId: string,
  query: AssignmentTableQuery,
  signal?: AbortSignal,
) {
  const schema = pagedSchema(assignmentRowSchema);
  const paging = { page: query.page, pageSize: query.pageSize };
  if (query.q !== undefined) {
    return staffRequest(`${roundPath(roundId)}/assignments/search`, {
      method: 'POST',
      body: { ...filterValues(query), q: query.q, ...paging },
      schema,
      signal,
    });
  }
  return staffRequest(
    `${roundPath(roundId)}/assignments${queryString({ ...filterValues(query), ...paging })}`,
    { schema, signal },
  );
}

/**
 * The Excel export with the table's filters. Takes the filters only, so the search text can't
 * reach this URL; the browser downloads the file itself.
 */
export function exportUrl(roundId: string, filters: AssignmentFilters): string {
  return `${roundPath(roundId)}/export${queryString(filterValues(filters))}`;
}

/** The ZIP of signed files, one department (at send time) or all; streamed by the browser. */
export function downloadUrl(roundId: string, dept: string | undefined): string {
  return `${roundPath(roundId)}/download${queryString({ dept })}`;
}

/** The mode, templates and recipients of a round, as the preview and create take them. */
export type RoundSelectionBody = z.input<typeof recipientsPreviewSchema>;

/** The selection the preview saw, plus the name and all four settings. */
export type RoundCreateBody = z.input<typeof roundCreateSchema>;

/**
 * The recipient preview (3.8): counts, departments and lists. Nothing is created, but every
 * call writes an audit row, so the wizard calls it only on entering the summary or on "refresh".
 */
export function previewRecipients(body: RoundSelectionBody) {
  return staffRequest('/api/rounds/recipients-preview', {
    method: 'POST',
    body,
    schema: recipientsPreviewReportSchema,
  });
}

/** The draft round (3.9): nothing is sent yet. */
export function createRound(body: RoundCreateBody) {
  return staffRequest('/api/rounds', { method: 'POST', body, schema: roundCreatedSchema });
}

/** Sends a draft (3.10). `confirmOutdatedTemplateIds`: "send the round's version anyway". */
export function sendRound(id: string, confirmOutdatedTemplateIds: readonly string[] = []) {
  return staffRequest(`/api/rounds/${encodeURIComponent(id)}/send`, {
    method: 'POST',
    body: { confirmOutdatedTemplateIds: [...confirmOutdatedTemplateIds] },
    schema: roundSentSchema,
  });
}

/** Cancels a round, also a draft (3.12): its open rows are cancelled, nothing is deleted. */
export function cancelRound(id: string) {
  return staffRequest(`/api/rounds/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    schema: roundCancelledSchema,
  });
}
