import { REMIND_SKIP_REASONS, type RoundDetails, type RoundReminded } from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useId, useState } from 'react';
import { ConfirmDialog } from '../../../components/dialogs/ConfirmDialog';
import { formatNumber } from '../../../i18n/format';
import { he } from '../../../i18n/he';
import { sendOutcome, type SendOutcome } from '../new/send-flow';
import { cancelRound, sendRound } from '../rounds.api';
import { DraftPanel, OutdatedPanel } from '../send-panels';
import { remindRound } from './actions.api';
import { useAction } from './use-action';

const text = he.rounds.actions;

type Confirming = 'remindAll' | 'cancelRound' | 'send' | 'cancelDraft';

/** "Sent N reminders" and each skip reason with rows, in Hebrew. */
function RemindResult({ result, onClose }: { result: RoundReminded; onClose: () => void }) {
  const skipped = REMIND_SKIP_REASONS.filter((reason) => result.skipped[reason] > 0);
  return (
    <Alert
      severity="info"
      role="status"
      onClose={onClose}
      slotProps={{ closeButton: { 'aria-label': text.remindAll.close } }}
    >
      <Typography>{text.remindAll.queued(result.queued, formatNumber(result.queued))}</Typography>
      {skipped.length > 0 && (
        <>
          <Typography sx={{ mt: 1 }}>{text.remindAll.skippedTitle}</Typography>
          <Box component="ul" sx={{ m: 0, paddingInlineStart: 3 }}>
            {skipped.map((reason) => (
              <li key={reason}>
                {text.remindAll.skipped[reason](formatNumber(result.skipped[reason]))}
              </li>
            ))}
          </Box>
        </>
      )}
    </Alert>
  );
}

/**
 * The round's own actions next to "רענון" (managers only; the API decides). A sent round:
 * "remind everyone" (the counts in Hebrew) and "cancel the round" (typed confirmation: it can't be
 * undone). A draft: send it (3.10, the wizard's outcomes and panels) or cancel it.
 */
export function RoundActions({ round }: { round: RoundDetails }) {
  const wordId = useId();
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [typed, setTyped] = useState('');
  const [reminded, setReminded] = useState<RoundReminded | null>(null);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const { busy, run } = useAction();

  const isDraft = round.status === 'draft';
  const isSent = round.status === 'sending' || round.status === 'active';
  if (!isDraft && !isSent) return null;

  const close = () => setConfirming(null);

  const remindAll = async () => {
    const result = await run(() => remindRound(round.id));
    if (result) setReminded(result);
    close();
  };

  const cancel = async () => {
    await run(() => cancelRound(round.id), {
      employees: true,
      done: (result) =>
        isDraft
          ? text.draft.cancelled
          : text.cancelRound.done(
              formatNumber(result.cancelled),
              formatNumber(result.signedUntouched),
            ),
    });
    setOutcome(null);
    close();
  };

  /** One press of "send" on the draft; `confirmOutdatedTemplateIds` from the outdated panel. */
  const send = async (confirmOutdatedTemplateIds: readonly string[] = []) => {
    let failed: SendOutcome | null = null;
    const sent = await run(() => sendRound(round.id, confirmOutdatedTemplateIds), {
      employees: true,
      done: () => text.draft.sent,
      onError: (error) => {
        failed = sendOutcome(round.id, error);
        return true;
      },
    });
    setOutcome(sent ? null : failed);
    close();
  };

  const confirmTexts: Record<Confirming, { title: string; text: string; confirm: string }> = {
    remindAll: {
      title: text.remindAll.title,
      text: text.remindAll.text,
      confirm: text.remindAll.confirm,
    },
    cancelRound: {
      title: text.cancelRound.label,
      text: text.cancelRound.text,
      confirm: text.cancelRound.label,
    },
    send: {
      title: text.draft.send,
      text: text.draft.sendText(formatNumber(round.counts.total)),
      confirm: text.draft.confirm,
    },
    cancelDraft: {
      title: text.draft.cancel,
      text: text.draft.cancelText,
      confirm: text.draft.cancel,
    },
  };
  const onConfirm: Record<Confirming, () => Promise<void>> = {
    remindAll,
    cancelRound: cancel,
    send: () => send(),
    cancelDraft: cancel,
  };
  const wordTyped = typed.trim() === text.cancelRound.word;
  const dialog = confirming === null ? null : confirmTexts[confirming];

  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {isSent && (
          <>
            <Button variant="outlined" onClick={() => setConfirming('remindAll')} disabled={busy}>
              {text.remindAll.label}
            </Button>
            <Button
              variant="outlined"
              color="error"
              onClick={() => {
                setTyped('');
                setConfirming('cancelRound');
              }}
              disabled={busy}
            >
              {text.cancelRound.label}
            </Button>
          </>
        )}
        {isDraft && outcome === null && (
          <>
            <Button variant="contained" onClick={() => setConfirming('send')} disabled={busy}>
              {text.draft.send}
            </Button>
            <Button
              variant="outlined"
              color="error"
              onClick={() => setConfirming('cancelDraft')}
              disabled={busy}
            >
              {text.draft.cancel}
            </Button>
          </>
        )}
      </Box>

      {reminded && <RemindResult result={reminded} onClose={() => setReminded(null)} />}
      {isDraft && outcome?.kind === 'outdated' && (
        <OutdatedPanel
          outcome={outcome}
          busy={busy}
          onSend={() => void send(outcome.templates.map(({ id }) => id))}
          onStop={() =>
            setOutcome({
              kind: 'draft',
              roundId: round.id,
              reason: 'failed',
              templates: [],
              message: he.newRound.send.stopped,
            })
          }
        />
      )}
      {isDraft && outcome?.kind === 'draft' && (
        <DraftPanel
          outcome={outcome}
          busy={busy}
          onRetry={() => void send()}
          onCancel={() => setConfirming('cancelDraft')}
        />
      )}

      {confirming !== null && dialog && (
        <ConfirmDialog
          open
          title={dialog.title}
          text={dialog.text}
          confirmLabel={dialog.confirm}
          cancelLabel={text.keep}
          danger={confirming === 'cancelRound' || confirming === 'cancelDraft'}
          busy={busy}
          confirmDisabled={confirming === 'cancelRound' && !wordTyped}
          onConfirm={() => void onConfirm[confirming]()}
          onClose={close}
        >
          {confirming === 'cancelRound' && (
            <TextField
              id={wordId}
              label={text.cancelRound.typeLabel(text.cancelRound.word)}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              fullWidth
              sx={{ mt: 2 }}
            />
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
