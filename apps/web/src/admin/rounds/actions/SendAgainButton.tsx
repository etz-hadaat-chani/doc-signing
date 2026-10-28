import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { z } from 'zod';
import { isApiRequestError } from '../../../api/api-error';
import { ConfirmDialog } from '../../../components/dialogs/ConfirmDialog';
import { he } from '../../../i18n/he';
import { sendAgain } from './actions.api';
import { useAction } from './use-action';

const text = he.rounds.actions.sendAgain;

const existsDetails = z.object({ roundId: z.uuid() });

/**
 * "Send again" of a returned row (3.16 part B2, managers): a correction round for this employee,
 * created and sent at once. A correction round that already exists (409
 * `CORRECTION_ROUND_EXISTS`) is shown as a link to it; so is the new one.
 */
export function SendAgainButton({ assignmentId }: { assignmentId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const { busy, run } = useAction();

  const confirm = async () => {
    const result = await run(() => sendAgain(assignmentId), {
      employees: true,
      done: () => text.done,
      onError: (error) => {
        if (!isApiRequestError(error) || error.code !== 'CORRECTION_ROUND_EXISTS') return false;
        const details = existsDetails.safeParse(error.details);
        if (!details.success) return false;
        setExists(true);
        setRoundId(details.data.roundId);
        return true;
      },
    });
    if (result) setRoundId(result.roundId);
    setConfirming(false);
  };

  if (roundId !== null) {
    return (
      <Box role="status">
        {exists && (
          <Typography variant="body2" component="span">
            {text.exists}{' '}
          </Typography>
        )}
        <Link component={RouterLink} to={`/rounds/${roundId}`}>
          {text.toRound}
        </Link>
      </Box>
    );
  }

  return (
    <>
      <Button size="small" variant="outlined" onClick={() => setConfirming(true)} disabled={busy}>
        {text.label}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={text.label}
        text={text.text}
        confirmLabel={text.label}
        cancelLabel={he.rounds.actions.keep}
        busy={busy}
        onConfirm={() => void confirm()}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
