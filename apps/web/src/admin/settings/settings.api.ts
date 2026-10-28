import { settingsItemSchema } from '@doc-signing/shared';
import { staffRequest } from '../auth/staff-api';

/** Every settings query (5.8 adds the form that changes them). */
export const settingsKeys = {
  all: ['staff', 'settings'] as const,
};

/** The defaults a new round starts from (manager only). */
export function fetchSettings(signal?: AbortSignal) {
  return staffRequest('/api/settings', { schema: settingsItemSchema, signal });
}
