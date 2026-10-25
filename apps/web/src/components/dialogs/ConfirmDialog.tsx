import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { type ReactNode, useId } from 'react';
import { he } from '../../i18n/he';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  text: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Can't be undone (cancel a round, return for correction): red button, focus on Cancel. */
  danger?: boolean;
  /** The action is running: Confirm is disabled and the dialog can't be closed. */
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** More fields between the text and the buttons, e.g. a required note. */
  children?: ReactNode;
}

/**
 * Asks before an action. MUI's Dialog keeps the focus inside, closes on Escape and returns the
 * focus to the button that opened it.
 */
export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  cancelLabel = he.common.cancel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps) {
  const titleId = useId();
  const textId = useId();

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      aria-labelledby={titleId}
      aria-describedby={textId}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText id={textId} color="text.primary">
          {text}
        </DialogContentText>
        {children}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button variant="outlined" onClick={onClose} disabled={busy} autoFocus={danger}>
          {cancelLabel}
        </Button>
        <Button
          variant="contained"
          color={danger ? 'error' : 'primary'}
          onClick={onConfirm}
          disabled={busy}
          autoFocus={!danger}
          startIcon={busy ? <CircularProgress size={16} color="inherit" aria-hidden /> : undefined}
        >
          {busy ? he.common.working : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
