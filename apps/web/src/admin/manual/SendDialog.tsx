import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog';
import { useNotify } from '../../components/notifications/notify-context';
import { formatNumber } from '../../i18n/format';
import { he } from '../../i18n/he';
import { useAction } from '../rounds/actions/use-action';
import { type RefusedRow, sendFailure } from './manual-row';
import { sendManual } from './manual.api';

const text = he.manual.send;

/**
 * The one-click send (FR-MAN-1, FR-EMP-6) for one row or the selected ones: all or none. A 409
 * keeps the dialog open with every refused row and why (nothing was sent); any answer that isn't
 * a 4xx in our format may have sent them, so the list is fetched again and nothing is resent.
 */
export function SendDialog({
  assignmentIds,
  nameOf,
  onClose,
  onSent,
}: {
  assignmentIds: readonly string[];
  /** The employee's name for a refused row (from the rows the manager saw). */
  nameOf: (assignmentId: string) => string;
  onClose: () => void;
  /** Sent, or maybe sent: the selection is cleared. */
  onSent: () => void;
}) {
  const notify = useNotify();
  const { busy, run } = useAction();
  const [refused, setRefused] = useState<RefusedRow[] | null>(null);
  const count = assignmentIds.length;
  const only = assignmentIds[0];

  const send = async () => {
    const sent = await run(() => sendManual(assignmentIds), {
      employees: true,
      done: (result) => {
        const noEmail = result.items.filter(({ status }) => status === 'no_email').length;
        const emailed = result.items.length - noEmail;
        if (noEmail > 0) notify.success(text.noEmailNow(formatNumber(noEmail)));
        return emailed === 0 ? null : text.done(emailed, formatNumber(emailed));
      },
      onError: (error) => {
        const failure = sendFailure(error);
        if (failure.kind === 'refused') {
          setRefused(failure.rows);
          return true;
        }
        notify.error(failure.kind === 'maybe' ? text.maybe : failure.message);
        if (failure.kind === 'maybe') onSent();
        onClose();
        return true;
      },
    });
    if (sent) {
      onSent();
      onClose();
    }
  };

  return (
    <ConfirmDialog
      open
      title={text.title}
      text={count === 1 && only ? text.one(nameOf(only)) : text.many(formatNumber(count))}
      confirmLabel={count === 1 ? text.label : text.selected}
      cancelLabel={refused ? text.close : he.rounds.actions.keep}
      busy={busy}
      confirmDisabled={refused !== null}
      onConfirm={() => void send()}
      onClose={onClose}
    >
      {refused && (
        <Alert severity="error" sx={{ mt: 2 }}>
          <Typography sx={{ fontWeight: 700 }}>{text.refusedTitle}</Typography>
          <Box component="ul" sx={{ m: 0, paddingInlineStart: 3 }}>
            {refused.map((row) => (
              <li key={row.assignmentId}>
                <bdi>{nameOf(row.assignmentId)}</bdi>: {row.message}
                {row.missing.length > 0 && ` (${row.missing.join(', ')})`}
              </li>
            ))}
          </Box>
        </Alert>
      )}
    </ConfirmDialog>
  );
}
