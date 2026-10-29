import {
  formatKioskShortCode,
  formatTime,
  KIOSK_PAGE_PATH,
  type KioskOpened,
  type ManualRow,
} from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { useId, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { isApiRequestError } from '../../api/api-error';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog';
import { he } from '../../i18n/he';
import { useAction } from '../rounds/actions/use-action';
import { openKiosk } from './manual.api';

const text = he.manual.kiosk;

/** The short code as it is shown: kept only in this dialog's state, gone when it closes. */
function CodeView({
  opened,
  row,
  onClose,
}: {
  opened: KioskOpened;
  row: ManualRow;
  onClose: () => void;
}) {
  const titleId = useId();
  const codeId = useId();
  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>
        <bdi>{text.title(`${row.employee.firstName} ${row.employee.lastName}`)}</bdi>
      </DialogTitle>
      <DialogContent>
        <Typography id={codeId} variant="body2" color="text.secondary">
          {text.codeLabel}
        </Typography>
        <Box
          aria-labelledby={codeId}
          dir="ltr"
          sx={{
            my: 1,
            py: 2,
            textAlign: 'center',
            fontFamily: 'monospace',
            fontSize: '2rem',
            fontWeight: 700,
            letterSpacing: '0.15em',
            bgcolor: 'action.hover',
            borderRadius: 1,
          }}
        >
          {formatKioskShortCode(opened.shortCode)}
        </Box>
        <Typography sx={{ fontWeight: 700, mb: 1 }}>
          {text.validUntil(formatTime(opened.expiresAt))}
        </Typography>
        <Typography sx={{ mb: 1 }}>
          {text.instructions(`${window.location.origin}${KIOSK_PAGE_PATH}`)}
        </Typography>
        {row.locked && <Alert severity="info">{text.ownAttempts}</Alert>}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {text.replaces}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          {text.close}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * The office signing station (FR-MAN-4, 5.7 decision D1), managers: asks first (a new code ends
 * the earlier one), then shows the short code with "valid until HH:MM" and where to type it on
 * the office computer. The code lives only in this component's state: never in the address, the
 * data cache, browser storage or a notice. Closing doesn't end it. A row that can still be
 * unlocked gets the unlock first (409 `ASSIGNMENT_LOCKED`): its text and a link to the round.
 */
export function KioskCodeDialog({ row, onClose }: { row: ManualRow; onClose: () => void }) {
  const { busy, run } = useAction();
  const [opened, setOpened] = useState<KioskOpened | null>(null);
  const [lockedFirst, setLockedFirst] = useState(false);

  const open = async () => {
    const result = await run(() => openKiosk(row.assignmentId), {
      done: () => null,
      onError: (error) => {
        if (!isApiRequestError(error) || error.code !== 'ASSIGNMENT_LOCKED') return false;
        setLockedFirst(true);
        return true;
      },
    });
    if (result) setOpened(result);
  };

  if (opened) return <CodeView opened={opened} row={row} onClose={onClose} />;
  return (
    <ConfirmDialog
      open
      title={text.title(`${row.employee.firstName} ${row.employee.lastName}`)}
      text={text.hint}
      confirmLabel={text.label}
      cancelLabel={he.rounds.actions.keep}
      busy={busy}
      confirmDisabled={lockedFirst}
      onConfirm={() => void open()}
      onClose={onClose}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {text.replaces}
      </Typography>
      {lockedFirst && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {text.lockedFirst}{' '}
          <Link component={RouterLink} to={`/rounds/${row.round.id}`}>
            {text.toRound}
          </Link>
        </Alert>
      )}
    </ConfirmDialog>
  );
}
