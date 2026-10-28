import {
  type manualListQuerySchema,
  manualRowSchema,
  manualSentSchema,
  manualSignedSchema,
  pagedSchema,
} from '@doc-signing/shared';
import type { z } from 'zod';
import { staffRequest } from '../auth/staff-api';

/**
 * Manual handling (A10, 3.16 API): the list, the send, the scanned signature and the print link.
 * Only ids, kinds and paging in an address; the search text goes in a POST body.
 */

/** The filters and paging the address may hold (never `q`). */
export type ManualFilters = z.output<typeof manualListQuerySchema>;

/** A request: the filters, plus the search text when there is one (POST only). */
export type ManualRequest = ManualFilters & { q?: string };

/** Every manual-handling query: invalidated after every action (`useAction`). */
export const manualKeys = {
  all: ['staff', 'manual'] as const,
  list: (request: ManualRequest) => ['staff', 'manual', 'list', request] as const,
};

const manualPageSchema = pagedSchema(manualRowSchema);

function queryString(filters: ManualFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  return params.toString();
}

/**
 * One page of the list. With search text it is the POST search (the text may be an ID number,
 * so it never goes in a URL); without it the GET with filters and paging only.
 */
export function fetchManual(request: ManualRequest, signal?: AbortSignal) {
  if (request.q !== undefined) {
    return staffRequest('/api/manual-handling/search', {
      method: 'POST',
      body: request,
      schema: manualPageSchema,
      signal,
    });
  }
  return staffRequest(`/api/manual-handling?${queryString(request)}`, {
    schema: manualPageSchema,
    signal,
  });
}

/** Sends the rows (all or none); a 409 lists every refused row in `details.refused`. */
export function sendManual(assignmentIds: readonly string[]) {
  return staffRequest('/api/manual-handling/send', {
    method: 'POST',
    body: { assignmentIds },
    schema: manualSentSchema,
  });
}

const assignmentPath = (id: string, action: string) =>
  `/api/assignments/${encodeURIComponent(id)}/${action}` as const;

/** The personalized PDF, opened in a new tab on click only (logged as a view, never cached). */
export const printPath = (id: string) => assignmentPath(id, 'print');

/** The scanned paper signature (multipart `file`): "Signed manually". */
export function uploadScan(id: string, file: File) {
  const body = new FormData();
  body.append('file', file);
  return staffRequest(assignmentPath(id, 'manual-sign'), {
    method: 'POST',
    body,
    schema: manualSignedSchema,
  });
}
