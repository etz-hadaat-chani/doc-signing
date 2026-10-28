import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type Dispatch, useEffect, useReducer, useRef, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { ConfirmDialog } from '../../../components/dialogs/ConfirmDialog';
import { useNotify } from '../../../components/notifications/notify-context';
import { he } from '../../../i18n/he';
import { employeeKeys, fetchEmployee } from '../../employees/employees.api';
import { useUnsavedGuard } from '../../templates/editor/use-unsaved-guard';
import { previewRecipients, type RoundSelectionBody } from '../rounds.api';
import { DocumentStep } from './DocumentStep';
import { DoneStep } from './DoneStep';
import { NameModeStep } from './NameModeStep';
import { PreviewStep } from './PreviewStep';
import { RecipientsStep } from './RecipientsStep';
import { SendStep, type SummaryNotice } from './SendStep';
import { SettingsStep } from './SettingsStep';
import { checkSettings } from './settings-form';
import { StepSection } from './StepSection';
import { SummaryStep } from './SummaryStep';
import {
  canLeaveSummary,
  guardsLeaving,
  initialWizardState,
  pickedFrom,
  previewStatus,
  selectionBody,
  stepProblem,
  WIZARD_STEPS,
  type WizardAction,
  type WizardStep,
  wizardReducer,
} from './wizard-state';

const texts = he.newRound;

/** The card's "send document" shortcut passes `{ employeeId }` in router state, never the address. */
const preselectStateSchema = z.object({ employeeId: z.uuid() });

const STEP_TITLES: Record<WizardStep, string> = {
  name: texts.name.title,
  document: texts.document.title,
  recipients: texts.recipients.title,
  summary: texts.summary.title,
  settings: texts.settings.title,
  preview: texts.preview.title,
  send: texts.send.title,
};

/**
 * Reads the employee the card's shortcut passed, adds them as a hand-picked recipient, then
 * clears the router state (a reload doesn't add them again). Only the fields the wizard shows
 * are kept: never the ID number the card holds for managers.
 */
function usePreselectedEmployee(dispatch: Dispatch<WizardAction>) {
  const location = useLocation();
  const navigate = useNavigate();
  const [employeeId] = useState(() => {
    const parsed = preselectStateSchema.safeParse(location.state);
    return parsed.success ? parsed.data.employeeId : null;
  });
  const card = useQuery({
    queryKey: employeeKeys.card(employeeId ?? ''),
    queryFn: ({ signal }) => fetchEmployee(employeeId ?? '', signal),
    enabled: employeeId !== null,
  });
  useEffect(() => {
    if (employeeId !== null) void navigate('.', { replace: true, state: null });
  }, [employeeId, navigate]);
  useEffect(() => {
    if (card.data) dispatch({ type: 'preselect', employee: pickedFrom(card.data) });
  }, [card.data, dispatch]);
  return card.isError;
}

/** Why the send step sent the manager back to the summary. */
function SummaryNoticeAlert({ notice }: { notice: SummaryNotice }) {
  if (notice === 'draftCancelled') {
    return (
      <Alert severity="info" role="status" sx={{ mb: 3 }}>
        {texts.send.cancelled}
      </Alert>
    );
  }
  if (notice === 'notCreated') {
    return (
      <Alert severity="error" role="alert" sx={{ mb: 3 }}>
        {texts.send.notCreatedSummary}
      </Alert>
    );
  }
  return (
    <Alert severity="warning" role="alert" sx={{ mb: 3 }} data-testid="round-maybe-created">
      {texts.send.maybeCreated}{' '}
      <Link component={RouterLink} to="/rounds?status=draft">
        {texts.send.draftsLink}
      </Link>
    </Alert>
  );
}

/**
 * New round wizard (A5, Flow 3): name and mode → document → recipients → summary → settings →
 * preview → send. Everything entered stays in this component's memory: nothing in the address,
 * nothing in browser storage.
 */
export function NewRoundPage() {
  const notify = useNotify();
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialWizardState);
  const preselectFailed = usePreselectedEmployee(dispatch);
  const [tried, setTried] = useState<ReadonlySet<WizardStep>>(new Set());
  const [opened, setOpened] = useState(false);
  const [notice, setNotice] = useState<SummaryNotice | null>(null);
  const { blocker } = useUnsavedGuard(guardsLeaving(state));

  // One preview at a time, also for two clicks before the next render.
  const previewing = useRef(false);
  const preview = useMutation({
    mutationFn: previewRecipients,
    onSuccess: (report, body) =>
      dispatch({ type: 'previewed', result: { body, report, receivedAt: new Date() } }),
    onError: (error) => notify.error(error.message),
    onSettled: () => {
      previewing.current = false;
    },
  });
  const runPreview = (body: RoundSelectionBody | null = selectionBody(state)) => {
    if (body === null || previewing.current) return;
    previewing.current = true;
    preview.mutate(body);
  };

  const index = WIZARD_STEPS.indexOf(state.step);
  const goTo = (step: WizardStep) => {
    setOpened(true);
    dispatch({ type: 'goTo', step });
  };

  const settingsCheck = state.settings === null ? null : checkSettings(state.settings);

  const next = () => {
    const step = state.step;
    const settingsBlocked = step === 'settings' && !settingsCheck?.input;
    if (stepProblem(state, step) !== null || settingsBlocked) {
      setTried(new Set(tried).add(step));
      return;
    }
    const following = WIZARD_STEPS[index + 1];
    if (!following) return;
    setNotice(null);
    goTo(following);
    // The summary's preview: on entering it, only when there is none for this choice.
    if (following === 'summary' && previewStatus(state) !== 'current') runPreview();
  };

  /** From the send step: the summary again, computed afresh (the data may have changed). */
  const backToSummary = (reason: SummaryNotice) => {
    setNotice(reason);
    goTo('summary');
    runPreview();
  };

  const startAgain = () => {
    dispatch({ type: 'reset' });
    setTried(new Set());
    setNotice(null);
    setOpened(true);
  };

  const problem = (step: WizardStep) => (tried.has(step) ? stepProblem(state, step) : null);
  const nextDisabled = state.step === 'summary' && !canLeaveSummary(state);
  // Once the draft exists, the steps it was made from can't be changed: no way back.
  const showBack = index > 0 && state.roundId === null && state.sent === null;
  const showNext = state.step !== 'send';

  let content;
  switch (state.step) {
    case 'name':
      content = (
        <NameModeStep
          name={state.name}
          mode={state.mode}
          problem={problem('name')}
          onName={(name) => dispatch({ type: 'name', name })}
          onMode={(mode) => dispatch({ type: 'mode', mode })}
        />
      );
      break;
    case 'document':
      content = (
        <DocumentStep
          mode={state.mode}
          templateId={state.templateId}
          problem={problem('document')}
          onTemplate={(templateId) => dispatch({ type: 'template', templateId })}
        />
      );
      break;
    case 'recipients':
      content = (
        <RecipientsStep state={state} problem={problem('recipients')} dispatch={dispatch} />
      );
      break;
    case 'summary':
      content = (
        <SummaryStep
          state={state}
          pending={preview.isPending}
          error={preview.error}
          onRefresh={() => runPreview()}
          dispatch={dispatch}
        />
      );
      break;
    case 'settings':
      content = (
        <SettingsStep
          values={state.settings}
          errors={tried.has('settings') ? (settingsCheck?.errors ?? {}) : {}}
          dispatch={dispatch}
        />
      );
      break;
    case 'preview':
      content = settingsCheck?.input ? (
        <PreviewStep
          state={state}
          linkExpiryDays={settingsCheck.input.linkExpiryDays}
          dispatch={dispatch}
        />
      ) : null;
      break;
    case 'send':
      content = settingsCheck?.input ? (
        <SendStep
          state={state}
          settings={settingsCheck.input}
          dispatch={dispatch}
          onBackToSummary={backToSummary}
        />
      ) : null;
      break;
  }

  return (
    <>
      <Typography variant="h1" sx={{ mb: 3 }}>
        {he.nav.newRound}
      </Typography>
      <Stepper
        activeStep={state.sent ? WIZARD_STEPS.length : index}
        alternativeLabel
        aria-label={texts.stepsLabel}
        sx={{ mb: 4, maxWidth: 960 }}
      >
        {texts.steps.map((label, stepIndex) => (
          <Step key={label} completed={state.sent !== null || stepIndex < index}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {preselectFailed && (
        <Alert severity="error" role="alert" sx={{ mb: 3 }}>
          {texts.recipients.preselectFailed}
        </Alert>
      )}
      {notice !== null && state.step === 'summary' && <SummaryNoticeAlert notice={notice} />}

      {state.sent ? (
        <StepSection key="done" title={texts.done.title} focusOnOpen>
          <DoneStep sent={state.sent} onNewRound={startAgain} />
        </StepSection>
      ) : (
        <StepSection key={state.step} title={STEP_TITLES[state.step]} focusOnOpen={opened}>
          {content}
        </StepSection>
      )}

      {state.sent === null && (showBack || showNext) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 4 }}>
          {showBack && (
            <Button
              variant="outlined"
              onClick={() => goTo(WIZARD_STEPS[index - 1] ?? 'name')}
              disabled={preview.isPending}
            >
              {texts.back}
            </Button>
          )}
          {showNext && (
            <Button variant="contained" onClick={next} disabled={nextDisabled || preview.isPending}>
              {texts.next}
            </Button>
          )}
        </Box>
      )}

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title={texts.leaveTitle}
        text={state.roundId === null ? texts.leaveText : texts.leaveDraftText}
        confirmLabel={texts.leaveConfirm}
        cancelLabel={texts.stay}
        danger
        onConfirm={() => blocker.proceed?.()}
        onClose={() => blocker.reset?.()}
      />
    </>
  );
}
