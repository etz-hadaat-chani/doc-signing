import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { errorContent } from '../../../components/feedback/error-content';
import { useNotify } from '../../../components/notifications/notify-context';
import { dashboardKeys } from '../../dashboard/dashboard.api';
import { employeeKeys } from '../../employees/employees.api';
import { manualKeys } from '../../manual/manual.api';
import { roundKeys } from '../rounds.api';

interface RunOptions<T> {
  /** The action changes what the employee card's history shows (status, approval, return). */
  employees?: boolean;
  /** The success notice, or null for none. */
  done?: (result: T) => string | null;
  /** Shows an error itself (true) instead of the notice with the Hebrew text by code. */
  onError?: (error: Error) => boolean;
}

/**
 * Runs one manager action: one at a time (a ref, so a double click sends once even before the
 * next render), `busy` while it runs, the error as a Hebrew notice by code. Success or refusal,
 * the round's queries, manual handling (A10) and the dashboard are fetched again (a 409 means the
 * row changed too);
 * the answers panel has its own key and is never refetched by this.
 */
export function useAction() {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);

  const refresh = (employees: boolean) => {
    const keys = [
      roundKeys.all,
      manualKeys.all,
      dashboardKeys.all,
      ...(employees ? [employeeKeys.all] : []),
    ];
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
  };

  async function run<T>(call: () => Promise<T>, options: RunOptions<T> = {}): Promise<T | null> {
    if (running.current) return null;
    running.current = true;
    setBusy(true);
    try {
      const result = await call();
      const text = options.done?.(result) ?? null;
      if (text !== null) notify.success(text);
      return result;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (!options.onError?.(failure)) notify.error(errorContent(error).message);
      return null;
    } finally {
      refresh(options.employees ?? false);
      running.current = false;
      setBusy(false);
    }
  }

  return { busy, run };
}
