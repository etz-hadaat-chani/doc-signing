import { REMINDER_SKIP_DATES_MAX, reminderSkipDatesSchema } from '@doc-signing/shared';
import { he } from '../../i18n/he';
import { parseDay } from '../employees/employee-form';

const text = he.settings.skipDates;

/**
 * Adds a typed day (DD/MM/YYYY, as the screen shows dates) to the no-reminder list (3.14), which
 * holds `YYYY-MM-DD` as the API does. The shared schema checks the real day; the list stays
 * sorted, so the screen shows what the server will read back.
 */
export function addSkipDate(
  list: readonly string[],
  typed: string,
): { list: string[] } | { error: string } {
  const day = parseDay(typed);
  if (day === null) return { error: text.invalidShape };
  if (!reminderSkipDatesSchema.safeParse([day]).success) return { error: text.notADay };
  if (list.includes(day)) return { error: text.duplicate };
  if (list.length >= REMINDER_SKIP_DATES_MAX) return { error: text.full(REMINDER_SKIP_DATES_MAX) };
  return { list: [...list, day].sort() };
}

export function removeSkipDate(list: readonly string[], day: string): string[] {
  return list.filter((item) => item !== day);
}
