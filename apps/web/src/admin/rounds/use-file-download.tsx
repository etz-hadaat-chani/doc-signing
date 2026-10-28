import { apiErrorSchema, type ErrorCode, errorMessage } from '@doc-signing/shared';
import { useCallback, useRef } from 'react';
import { useNotify } from '../../components/notifications/notify-context';
import { he } from '../../i18n/he';
import { reportStaffStatus } from '../auth/staff-api';

/**
 * What an answer shown in the download frame means. A file (Content-Disposition: attachment)
 * never shows there: the browser saves it, so a page that did load is an error answer.
 * - `none`: nothing readable (an empty page, or a browser that fires `load` for a download).
 * - `api`: our error format, by code.
 * - `unexpected`: some other page (a filter's block page, a proxy's error).
 */
export type FrameAnswer =
  { kind: 'none' } | { kind: 'api'; code: ErrorCode } | { kind: 'unexpected' };

export function readFrameAnswer(text: string | null | undefined): FrameAnswer {
  const trimmed = text?.trim() ?? '';
  if (trimmed === '') return { kind: 'none' };
  try {
    const parsed = apiErrorSchema.safeParse(JSON.parse(trimmed));
    if (parsed.success) return { kind: 'api', code: parsed.data.error.code };
  } catch {
    // Not JSON: not ours.
  }
  return { kind: 'unexpected' };
}

/** The page in the frame as text; null when the browser won't let us read it. */
function frameText(frame: HTMLIFrameElement | null): string | null {
  try {
    return frame?.contentDocument?.body?.textContent ?? null;
  } catch {
    return null;
  }
}

/** The session codes go through the same path as a staff request's 401 / 403. */
const SESSION_STATUS: Partial<Record<ErrorCode, number>> = { UNAUTHORIZED: 401, FORBIDDEN: 403 };

/**
 * Downloads a file the API streams (the Excel export, the ZIP) without reading it into memory:
 * a hidden same-origin frame opens the URL, the browser saves the file to disk. An error answer
 * (409 no signed files, 429 a download already running, 401 signed out) loads in the frame
 * instead, and is shown in Hebrew by its code. Render `frame` once on the page.
 */
export function useFileDownload() {
  const notify = useNotify();
  const frameRef = useRef<HTMLIFrameElement>(null);
  // An empty frame also fires `load` when it is added: only answers to our own clicks count.
  const waiting = useRef(false);

  const open = useCallback((url: string) => {
    const frame = frameRef.current;
    if (!frame) return;
    waiting.current = true;
    frame.src = url;
  }, []);

  const onLoad = () => {
    if (!waiting.current) return;
    waiting.current = false;
    const answer = readFrameAnswer(frameText(frameRef.current));
    if (answer.kind === 'none') return;
    if (answer.kind === 'unexpected') {
      notify.error(he.feedback.unexpectedText);
      return;
    }
    const status = SESSION_STATUS[answer.code];
    if (status !== undefined) reportStaffStatus(status);
    // Signed out: the session sends the user to the login page; nothing else to say.
    if (status !== 401) notify.error(errorMessage(answer.code));
  };

  const frame = (
    <iframe
      ref={frameRef}
      title={he.rounds.files.frameTitle}
      onLoad={onLoad}
      aria-hidden
      tabIndex={-1}
      data-testid="download-frame"
      style={{ display: 'none' }}
    />
  );

  return { open, frame };
}
