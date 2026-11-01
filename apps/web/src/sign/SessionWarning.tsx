import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import { useEffect, useState } from 'react';
import { he } from '../i18n/he';
import { SESSION_WARNING_MS } from './session-deadline';

interface SessionWarningProps {
  /** `sessionDeadline(...)` (`session-deadline.ts`), or null before the ID check. */
  deadline: number | null;
  channel: 'link' | 'kiosk';
}

/**
 * Two minutes before the signing session ends: one calm line at the top of the screen, kept in
 * view while she scrolls. Announced politely (`role="status"`), never a popup and never moving
 * the focus. One timer, no countdown; cleared with the screen or a new deadline (a new ID check).
 */
export function SessionWarning({ deadline, channel }: SessionWarningProps) {
  const [shownFor, setShownFor] = useState<number | null>(null);

  useEffect(() => {
    if (deadline === null) return undefined;
    const timer = setTimeout(
      () => setShownFor(deadline),
      Math.max(deadline - SESSION_WARNING_MS - Date.now(), 0),
    );
    return () => clearTimeout(timer);
  }, [deadline]);

  const shown = deadline !== null && shownFor === deadline;
  return (
    <Box role="status" sx={{ position: 'sticky', top: 0, zIndex: 2 }}>
      {shown && (
        // "none": MUI would make it an assertive alert; the box around it announces it politely.
        <Alert severity="warning" role="none" sx={{ mb: 3, boxShadow: 1 }}>
          {he.sign.sessionWarning[channel]}
        </Alert>
      )}
    </Box>
  );
}
