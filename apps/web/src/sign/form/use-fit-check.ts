import type { SignFitResult } from '@doc-signing/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { documentOutcome, type DocumentOutcome } from '../document-outcome';

/** Asked this long after she stops typing in a box. */
export const FIT_DELAY_MS = 700;
/**
 * At most this many checks per form screen; after that the live warning stops and the server
 * still decides at submit. The fit limit is 4,000 per IP per 15 minutes (minimum 300), about 20
 * per employee when 200 sign through one filter IP; a usual form takes 3–10.
 */
export const FIT_MAX_CALLS = 40;
/** A 429 without `Retry-After`: no checks for this long. */
const FIT_PAUSE_MS = 60_000;

export type FitCall = (
  answers: Record<string, string>,
  signal: AbortSignal,
) => Promise<SignFitResult>;

interface FitCheckOptions {
  fit: FitCall;
  /** 401 `SIGN_SESSION_EXPIRED`. */
  onSessionEnded: () => void;
  /** 409 / 423 / 404: the caller shows the B5 screen. */
  onRefused: (outcome: Extract<DocumentOutcome, { kind: 'refused' | 'gone' }>) => void;
}

/** What one key's checks have shown: the longest text that fit, the shortest that didn't. */
interface Known {
  fitLength: number | null;
  tooLongLength: number | null;
}

/**
 * The live "too long for its place" warning (FR-TPL-9, `POST …/fit`). `schedule(key, text)`
 * after every change; only that key is asked, 700 ms after the last change, and not when the
 * length already tells: no longer than a text that fit → fits; no shorter than one that didn't
 * → still too long. The previous call for that key is aborted. `tooLong`: key → the text found
 * too long (a warning only while she hasn't changed it). It never blocks typing; the server
 * decides at submit.
 */
export function useFitCheck({ fit, onSessionEnded, onRefused }: FitCheckOptions) {
  const [tooLong, setTooLong] = useState<ReadonlyMap<string, string>>(() => new Map());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const calls = useRef(new Map<string, AbortController>());
  const known = useRef(new Map<string, Known>());
  const count = useRef(0);
  const pausedUntil = useRef(0);
  // The page's callbacks are new on every render; the timers read the latest ones.
  const latest = useRef({ fit, onSessionEnded, onRefused });
  useEffect(() => {
    latest.current = { fit, onSessionEnded, onRefused };
  });

  const mark = useCallback(
    (key: string, text: string | null) =>
      setTooLong((current) => {
        if (text === null && !current.has(key)) return current;
        const next = new Map(current);
        if (text === null) next.delete(key);
        else next.set(key, text);
        return next;
      }),
    [],
  );

  const run = useCallback(
    async (key: string, text: string) => {
      const callbacks = latest.current;
      const seen = known.current.get(key) ?? { fitLength: null, tooLongLength: null };
      if (seen.fitLength !== null && text.length <= seen.fitLength) return mark(key, null);
      if (seen.tooLongLength !== null && text.length >= seen.tooLongLength) return mark(key, text);
      if (count.current >= FIT_MAX_CALLS || Date.now() < pausedUntil.current) return undefined;
      calls.current.get(key)?.abort();
      const controller = new AbortController();
      calls.current.set(key, controller);
      count.current += 1;
      try {
        const result = await callbacks.fit({ [key]: text }, controller.signal);
        const tooLongNow = result.tooLong.includes(key);
        known.current.set(
          key,
          tooLongNow
            ? { fitLength: seen.fitLength, tooLongLength: text.length }
            : { fitLength: text.length, tooLongLength: seen.tooLongLength },
        );
        mark(key, tooLongNow ? text : null);
      } catch (error) {
        if (controller.signal.aborted) return undefined;
        const outcome = documentOutcome(error);
        if (outcome.kind === 'sessionEnded') callbacks.onSessionEnded();
        else if (outcome.kind === 'refused' || outcome.kind === 'gone')
          callbacks.onRefused(outcome);
        else if (outcome.kind === 'wait') {
          pausedUntil.current = Date.now() + (outcome.seconds ?? FIT_PAUSE_MS / 1000) * 1000;
        }
        // No connection or anything else: no warning; the server decides at submit.
      } finally {
        if (calls.current.get(key) === controller) calls.current.delete(key);
      }
      return undefined;
    },
    [mark],
  );

  const schedule = useCallback(
    (key: string, text: string) => {
      const timer = timers.current.get(key);
      if (timer !== undefined) clearTimeout(timer);
      timers.current.delete(key);
      if (text === '') {
        calls.current.get(key)?.abort();
        mark(key, null);
        return;
      }
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          void run(key, text);
        }, FIT_DELAY_MS),
      );
    },
    [mark, run],
  );

  // The timers and calls end with the screen.
  useEffect(() => {
    const pending = timers.current;
    const running = calls.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      for (const controller of running.values()) controller.abort();
    };
  }, []);

  return { tooLong, schedule };
}
