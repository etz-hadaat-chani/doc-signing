import Alert from '@mui/material/Alert';
import Snackbar, { type SnackbarCloseReason } from '@mui/material/Snackbar';
import { type ReactNode, useMemo, useState } from 'react';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { type Notify, NotifyContext } from './notify-context';

/** A success message closes by itself after this long (ms); an error stays until closed. */
export const SUCCESS_HIDE_MS = 5000;

type Kind = 'success' | 'error';

interface Notice {
  id: number;
  kind: Kind;
  text: string;
}

/** Tells queued messages apart (two may have the same text). */
let nextNoticeId = 1;

const { color, shadow } = tokens;
const LOOK = {
  success: { color: color.success, background: color.successTint },
  error: { color: color.error, background: color.errorTint },
} as const;

/**
 * Short messages after an action ("נשלח", "השמירה נכשלה"), one at a time at the bottom of the
 * screen. Screen readers hear them: success politely (status), errors at once (alert).
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Notice[]>([]);
  const [open, setOpen] = useState(true);

  const notify = useMemo<Notify>(() => {
    const push = (kind: Kind) => (text: string) => {
      const id = nextNoticeId;
      nextNoticeId += 1;
      setQueue((current) => [...current, { id, kind, text }]);
    };
    return { success: push('success'), error: push('error') };
  }, []);

  const current = queue[0];

  const close = (_event: unknown, reason?: SnackbarCloseReason) => {
    // A click elsewhere on the page doesn't dismiss a message the user may not have read.
    if (reason === 'clickaway') return;
    setOpen(false);
  };

  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <Snackbar
        open={current !== undefined && open}
        autoHideDuration={current?.kind === 'success' ? SUCCESS_HIDE_MS : null}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{
          transition: {
            onExited: () => {
              setQueue((rest) => rest.slice(1));
              setOpen(true);
            },
          },
        }}
      >
        {current && (
          <Alert
            key={current.id}
            severity={current.kind}
            role={current.kind === 'error' ? 'alert' : 'status'}
            aria-live={current.kind === 'error' ? 'assertive' : 'polite'}
            onClose={() => close(null)}
            closeText={he.common.close}
            sx={{
              color: color.text,
              backgroundColor: LOOK[current.kind].background,
              borderColor: LOOK[current.kind].color,
              boxShadow: shadow.overlay,
              '& .MuiAlert-icon': { color: LOOK[current.kind].color },
            }}
          >
            {current.text}
          </Alert>
        )}
      </Snackbar>
    </NotifyContext.Provider>
  );
}
