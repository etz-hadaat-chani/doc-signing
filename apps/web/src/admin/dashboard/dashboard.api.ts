import {
  dashboardSummarySchema,
  pagedSchema,
  roundDetailsSchema,
  roundListItemSchema,
} from '@doc-signing/shared';
import { staffRequest } from '../auth/staff-api';

/** Every dashboard query: refreshing (or invalidating after an action) `all` updates them all. */
export const dashboardKeys = {
  all: ['staff', 'dashboard'] as const,
  summary: ['staff', 'dashboard', 'summary'] as const,
  drafts: ['staff', 'dashboard', 'drafts'] as const,
  round: (roundId: string) => ['staff', 'dashboard', 'round', roundId] as const,
};

/** Open drafts listed by name; more than this shows a link to the round list. */
export const DRAFTS_SHOWN = 100;

export function fetchDashboardSummary(signal?: AbortSignal) {
  return staffRequest('/api/dashboard/summary', { schema: dashboardSummarySchema, signal });
}

/** The summary counts drafts only; their names and ages come from the round list. */
export function fetchOpenDrafts(signal?: AbortSignal) {
  return staffRequest(`/api/rounds?status=draft&pageSize=${DRAFTS_SHOWN}`, {
    schema: pagedSchema(roundListItemSchema),
    signal,
  });
}

/** For a round still sending: its "sent X of Y" (`progress`). */
export function fetchRoundDetails(roundId: string, signal?: AbortSignal) {
  return staffRequest(`/api/rounds/${encodeURIComponent(roundId)}`, {
    schema: roundDetailsSchema,
    signal,
  });
}
