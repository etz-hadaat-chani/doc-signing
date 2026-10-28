import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type Dispatch, useEffect, useReducer, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { ConfirmDialog } from '../../../components/dialogs/ConfirmDialog';
import { useNotify } from '../../../components/notifications/notify-context';
import { he } from '../../../i18n/he';
import { employeeKeys, fetchEmployee } from '../../employees/employees.api';
import { useUnsavedGuard } from '../../templates/editor/use-unsaved-guard';
import { previewRecipients, type RoundSelectionBody } from '../rounds.api';
import { DocumentStep } from './DocumentStep';
import { NameModeStep } from './NameModeStep';
import { RecipientsStep } from './RecipientsStep';
import { StepSection } from './StepSection';
import { SummaryStep } from './SummaryStep';
import {
  canLeaveSummary,
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
  settings: texts.steps[4],
  preview: texts.steps[5],
  send: texts.steps[6],
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
  const { blocker } = useUnsavedGuard(state.touched);

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

  const next = () => {
    const step = state.step;
    if (stepProblem(state, step) !== null) {
      setTried(new Set(tried).add(step));
      return;
    }
    const following = WIZARD_STEPS[index + 1];
    if (!following) return;
    goTo(following);
    // The summary's preview: on entering it, only when there is none for this choice.
    if (following === 'summary' && previewStatus(state) !== 'current') runPreview();
  };

  const problem = (step: WizardStep) => (tried.has(step) ? stepProblem(state, step) : null);
  const nextDisabled =
    (state.step === 'summary' && !canLeaveSummary(state)) ||
    index > WIZARD_STEPS.indexOf('summary');

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
    default:
      content = <Typography>{texts.nextPart}</Typography>;
  }

  return (
    <>
      <Typography variant="h1" sx={{ mb: 3 }}>
        {he.nav.newRound}
      </Typography>
      <Stepper
        activeStep={index}
        alternativeLabel
        aria-label={texts.stepsLabel}
        sx={{ mb: 4, maxWidth: 960 }}
      >
        {texts.steps.map((label, stepIndex) => (
          <Step key={label} completed={stepIndex < index}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {preselectFailed && (
        <Alert severity="error" role="alert" sx={{ mb: 3 }}>
          {texts.recipients.preselectFailed}
        </Alert>
      )}

      <StepSection key={state.step} title={STEP_TITLES[state.step]} focusOnOpen={opened}>
        {content}
      </StepSection>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 4 }}>
        {index > 0 && (
          <Button
            variant="outlined"
            onClick={() => goTo(WIZARD_STEPS[index - 1] ?? 'name')}
            disabled={preview.isPending}
          >
            {texts.back}
          </Button>
        )}
        <Button variant="contained" onClick={next} disabled={nextDisabled || preview.isPending}>
          {texts.next}
        </Button>
      </Box>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title={texts.leaveTitle}
        text={texts.leaveText}
        confirmLabel={texts.leaveConfirm}
        cancelLabel={texts.stay}
        danger
        onConfirm={() => blocker.proceed?.()}
        onClose={() => blocker.reset?.()}
      />
    </>
  );
}
