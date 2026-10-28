import { formatDate, linkExpiresAtFrom } from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { ConfirmDialog } from '../../../components/dialogs/ConfirmDialog';
import { useNotify } from '../../../components/notifications/notify-context';
import { CountTiles } from '../../../components/stats/CountTiles';
import { formatNumber } from '../../../i18n/format';
import { he } from '../../../i18n/he';
import { dashboardKeys } from '../../dashboard/dashboard.api';
import { employeeKeys } from '../../employees/employees.api';
import { templateKeys } from '../../templates/templates.api';
import { cancelRound, createRound, roundKeys, sendRound } from '../rounds.api';
import { runSend, type SendOutcome } from './send-flow';
import type { RoundSettings } from './settings-form';
import { reasonTexts, summaryTiles } from './summary-view';
import { createBody, previewTemplates, type WizardAction, type WizardState } from './wizard-state';

const texts = he.newRound.send;

/** What the summary should say when the send step sends the manager back to it. */
export type SummaryNotice = 'notCreated' | 'maybeCreated' | 'draftCancelled';

function Review({ state, settings }: { state: WizardState; settings: RoundSettings }) {
  const documents = previewTemplates(state)
    .map((template) =>
      template.name === null
        ? he.newRound.preview.chosenTemplate
        : he.newRound.summary.templateName(template.name, template.version ?? 1),
    )
    .join(', ');
  const rows: [string, string][] = [
    [texts.name, state.name.trim()],
    [texts.mode, he.newRound.name.modes[state.mode]],
    [texts.documents, documents],
    [
      texts.reminders,
      settings.remindersEnabled
        ? texts.remindersText(settings.reminderIntervalDays, settings.maxReminders)
        : texts.remindersOff,
    ],
    [
      texts.expiry,
      texts.expiryText(
        settings.linkExpiryDays,
        formatDate(linkExpiresAtFrom(new Date(), settings.linkExpiryDays)),
      ),
    ],
  ];
  return (
    <Box
      component="dl"
      aria-label={texts.reviewLabel}
      sx={{ m: 0, display: 'grid', gridTemplateColumns: { sm: 'max-content 1fr' }, gap: 1.5 }}
    >
      {rows.map(([term, value]) => (
        <Box key={term} sx={{ display: 'contents' }}>
          <Typography component="dt" sx={{ fontWeight: 700 }}>
            {term}
          </Typography>
          <Typography component="dd" sx={{ m: 0 }}>
            <bdi>{value}</bdi>
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function OutdatedPanel({
  outcome,
  busy,
  onSend,
  onStop,
}: {
  outcome: Extract<SendOutcome, { kind: 'outdated' }>;
  busy: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  return (
    <Alert severity="warning" role="alert" data-testid="round-outdated">
      <AlertTitle>{texts.outdatedTitle}</AlertTitle>
      <Typography sx={{ mb: 1 }}>{texts.outdatedText}</Typography>
      <Box component="ul" sx={{ m: 0, mb: 2, paddingInlineStart: 3 }}>
        {outcome.templates.map((template) => (
          <li key={template.id}>
            {texts.outdatedLine(
              template.name,
              template.version,
              texts.outdatedReasons[template.reason](template.newestVersion),
              template.assignmentCount,
              formatNumber(template.assignmentCount),
            )}
          </li>
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Button variant="contained" color="warning" onClick={onSend} disabled={busy}>
          {busy ? texts.sending : texts.sendOutdated}
        </Button>
        <Button variant="outlined" color="inherit" onClick={onStop} disabled={busy}>
          {texts.stop}
        </Button>
      </Box>
    </Alert>
  );
}

function DraftPanel({
  outcome,
  busy,
  onRetry,
  onCancel,
}: {
  outcome: Extract<SendOutcome, { kind: 'draft' }>;
  busy: boolean;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <Alert severity="error" role="alert" data-testid="round-draft">
      <AlertTitle>{texts.draftTitle}</AlertTitle>
      <Typography sx={{ mb: 1 }}>{outcome.message}</Typography>
      {outcome.templates.length > 0 && (
        <>
          <Typography sx={{ fontWeight: 700 }}>{texts.notReadyTitle}</Typography>
          <Box component="ul" sx={{ m: 0, mb: 1, paddingInlineStart: 3 }}>
            {outcome.templates.map((template) => (
              <li key={template.id}>
                {he.newRound.summary.templateName(template.name, template.version)}
                <Box component="ul" sx={{ m: 0, paddingInlineStart: 3 }}>
                  {reasonTexts(template.reasons).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </Box>
              </li>
            ))}
          </Box>
        </>
      )}
      <Typography sx={{ mb: 2 }}>{texts.draftText}</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Button variant="contained" onClick={onRetry} disabled={busy}>
          {busy ? texts.sending : texts.retry}
        </Button>
        <Button variant="outlined" color="error" onClick={onCancel} disabled={busy}>
          {texts.cancelDraft}
        </Button>
      </Box>
    </Alert>
  );
}

/**
 * Step 7 (FR-RND-6): a last look, then "send" behind a confirmation with the counts. The draft is
 * created once (`roundId` kept at once); a failed send keeps it and offers retry or cancel. Every
 * outcome is decided in `send-flow.ts`. One press at a time (a ref, also before the next render).
 */
export function SendStep({
  state,
  settings,
  dispatch,
  onBackToSummary,
}: {
  state: WizardState;
  settings: RoundSettings;
  dispatch: (action: WizardAction) => void;
  onBackToSummary: (notice: SummaryNotice) => void;
}) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const refreshLists = () => {
    for (const queryKey of [dashboardKeys.all, roundKeys.all, employeeKeys.all, templateKeys.all]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };

  const go = async (confirmOutdatedTemplateIds: readonly string[] = []) => {
    const body = createBody(state, settings);
    if (body === null || running.current) return;
    running.current = true;
    setBusy(true);
    const result = await runSend(
      { roundId: state.roundId, body },
      {
        createRound,
        sendRound,
        onCreated: (roundId) => dispatch({ type: 'created', roundId }),
      },
      confirmOutdatedTemplateIds,
    );
    running.current = false;
    setBusy(false);
    setConfirming(false);
    if (result.kind === 'sent') {
      refreshLists();
      dispatch({ type: 'sent', sent: result.sent });
    } else if (result.kind === 'maybeCreated') {
      refreshLists();
      onBackToSummary('maybeCreated');
    } else if (result.kind === 'notCreated' && result.backToSummary) {
      onBackToSummary('notCreated');
    } else {
      if (result.kind !== 'notCreated') refreshLists();
      setOutcome(result);
    }
  };

  const cancel = useMutation({
    mutationFn: cancelRound,
    onSuccess: () => {
      setCancelling(false);
      refreshLists();
      dispatch({ type: 'draftCancelled' });
      onBackToSummary('draftCancelled');
    },
    onError: (error) => notify.error(error.message),
  });

  const report = state.preview?.report;
  const draftId = outcome && 'roundId' in outcome ? outcome.roundId : state.roundId;

  return (
    <>
      <Typography color="text.secondary">{texts.intro}</Typography>
      <Review state={state} settings={settings} />
      {report && (
        <CountTiles label={he.newRound.summary.countsLabel} tiles={summaryTiles(report)} fit />
      )}

      {outcome?.kind === 'notCreated' && (
        <Alert severity="error" role="alert">
          <AlertTitle>{texts.notCreated}</AlertTitle>
          {outcome.message}
        </Alert>
      )}
      {outcome?.kind === 'outdated' && (
        <OutdatedPanel
          outcome={outcome}
          busy={busy}
          onSend={() => void go(outcome.templates.map(({ id }) => id))}
          onStop={() =>
            setOutcome({
              kind: 'draft',
              roundId: outcome.roundId,
              reason: 'failed',
              templates: [],
              message: texts.stopped,
            })
          }
        />
      )}
      {outcome?.kind === 'draft' && (
        <DraftPanel
          outcome={outcome}
          busy={busy || cancel.isPending}
          onRetry={() => void go()}
          onCancel={() => setCancelling(true)}
        />
      )}
      {outcome?.kind === 'alreadySent' && (
        <Alert severity="info" role="alert">
          {texts.alreadySent}{' '}
          <Link component={RouterLink} to={`/rounds/${outcome.roundId}`}>
            {texts.toRound}
          </Link>
        </Alert>
      )}

      {(outcome === null || outcome.kind === 'notCreated') && (
        <Box>
          <Button
            variant="contained"
            size="large"
            onClick={() => setConfirming(true)}
            disabled={busy || report === undefined}
          >
            {texts.send}
          </Button>
        </Box>
      )}

      <ConfirmDialog
        open={confirming}
        title={texts.confirmTitle}
        text={texts.confirmText(
          report?.counts.inRound ?? 0,
          report?.counts.willSendEmail ?? 0,
          formatNumber,
        )}
        confirmLabel={texts.confirm}
        busy={busy}
        onConfirm={() => void go()}
        onClose={() => setConfirming(false)}
      />
      <ConfirmDialog
        open={cancelling}
        title={texts.cancelTitle}
        text={texts.cancelText}
        confirmLabel={texts.cancelDraft}
        cancelLabel={texts.keepDraft}
        danger
        busy={cancel.isPending}
        onConfirm={() => {
          if (draftId !== null && !cancel.isPending) cancel.mutate(draftId);
        }}
        onClose={() => setCancelling(false)}
      />
    </>
  );
}
