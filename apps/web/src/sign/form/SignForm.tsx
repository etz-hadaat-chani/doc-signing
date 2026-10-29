import {
  type EmailChoice,
  errorMessage,
  type SignFormResult,
  type TemplateFieldSettings,
} from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { type Dispatch, type SetStateAction, useMemo, useRef, useState } from 'react';
import { he } from '../../i18n/he';
import type { DocumentOutcome } from '../document-outcome';
import { BoxField } from './BoxField';
import { EmailSection } from './EmailSection';
import {
  checkAnswers,
  currentTooLong,
  EMAIL_CHOICE_ITEM,
  EMAIL_FIT_KEY,
  EMAIL_ITEM,
  emailValue,
  fitTextOf,
  type FormDraft,
  formItems,
  isFitChecked,
  isShown,
  withHiddenDropped,
} from './form-draft';
import { SignatureStepPlaceholder } from './SignatureStepPlaceholder';
import { type FitCall, useFitCheck } from './use-fit-check';

const text = he.sign.form;

/** What can take the focus inside a box (not the hidden date field or MUI's hidden inputs). */
const FOCUSABLE =
  'input:not([disabled]):not([aria-hidden="true"]):not([tabindex="-1"]), ' +
  'textarea:not([aria-hidden="true"]), [role="combobox"], button';

interface SignFormProps {
  form: SignFormResult;
  draft: FormDraft;
  onDraftChange: Dispatch<SetStateAction<FormDraft>>;
  fit: FitCall;
  onSessionEnded: () => void;
  onRefused: (outcome: Extract<DocumentOutcome, { kind: 'refused' | 'gone' }>) => void;
}

/**
 * B3, the form half (FR-SGN-4, FR-SGN-9, FR-TPL-9, FR-TPL-10): the correction note, then the
 * boxes and the email section in the template's order; a box with a condition appears and
 * disappears as she answers (its answer dropped). "Check" runs the server's own schema and
 * shows each Hebrew error next to its box, scrolling to the first; after that the errors follow
 * her edits. The answers live in the caller's state (`draft`), nowhere else.
 */
export function SignForm(props: SignFormProps) {
  const { form, draft, onDraftChange, fit, onSessionEnded, onRefused } = props;
  const [checked, setChecked] = useState(false);
  const { tooLong, schedule } = useFitCheck({ fit, onSessionEnded, onRefused });
  const containers = useRef(new Map<string, HTMLElement>());
  const items = useMemo(() => formItems(form.fields), [form.fields]);

  const errors = useMemo(
    () => (checked ? checkAnswers(form, draft, tooLong) : new Map<string, string>()),
    [checked, form, draft, tooLong],
  );
  const warnings = useMemo(() => currentTooLong(form, draft, tooLong), [form, draft, tooLong]);
  const tooLongText = (item: string) =>
    warnings.has(item) ? errorMessage('ANSWER_DOES_NOT_FIT') : null;

  const update = (change: (current: FormDraft) => FormDraft) =>
    onDraftChange((current) => withHiddenDropped(form, change(current)));

  const setAnswer = (box: TemplateFieldSettings, value: string | boolean) => {
    if (box.fieldType === 'drawing') {
      update((current) => ({
        ...current,
        drawings: { ...current.drawings, [box.key]: typeof value === 'string' ? value : '' },
      }));
      return;
    }
    update((current) => ({ ...current, answers: { ...current.answers, [box.key]: value } }));
    if (typeof value === 'string' && isFitChecked(box)) schedule(box.key, fitTextOf(box, value));
  };

  const setChoice = (choice: EmailChoice) => {
    update((current) => ({ ...current, emailChoice: choice }));
    if (choice === 'office') schedule(EMAIL_FIT_KEY, '');
    else schedule(EMAIL_FIT_KEY, emailValue(form, draft).trim());
  };

  const setEmail = (email: string) => {
    update((current) => ({ ...current, email }));
    schedule(EMAIL_FIT_KEY, email.trim());
  };

  const register = (keys: string[]) => (element: HTMLElement | null) => {
    for (const key of keys) {
      if (element) containers.current.set(key, element);
      else containers.current.delete(key);
    }
  };

  const check = () => {
    setChecked(true);
    const found = checkAnswers(form, draft, tooLong);
    const first = items
      .map((item) => (item.kind === 'box' ? [item.box.key] : [EMAIL_CHOICE_ITEM, EMAIL_ITEM]))
      .flat()
      .find((key) => found.has(key));
    const element = first === undefined ? undefined : containers.current.get(first);
    if (!element) return;
    element.scrollIntoView?.({ block: 'center' });
    const target =
      first === EMAIL_ITEM
        ? element.querySelector<HTMLElement>('input[type="email"]')
        : element.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus({ preventScroll: true });
  };

  const shownItems = items.filter(
    (item) => item.kind === 'email' || isShown(item.box, form, draft),
  );

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Typography variant="h1">{text.title}</Typography>
      {form.correctionNote !== null && (
        <Alert severity="warning">
          <AlertTitle sx={{ fontSize: 'inherit' }}>{text.correction}</AlertTitle>
          <Box component="span" sx={{ whiteSpace: 'pre-line' }}>
            {form.correctionNote}
          </Box>
        </Alert>
      )}
      <Typography>{text.intro}</Typography>
      {shownItems.map((item) =>
        item.kind === 'email' ? (
          <Box key={EMAIL_ITEM} ref={register([EMAIL_CHOICE_ITEM, EMAIL_ITEM])}>
            <EmailSection
              choice={draft.emailChoice}
              email={emailValue(form, draft)}
              prefilled={form.emailPrefill !== null}
              choiceError={errors.get(EMAIL_CHOICE_ITEM) ?? null}
              emailError={errors.get(EMAIL_ITEM) ?? null}
              tooLong={tooLongText(EMAIL_ITEM)}
              onChoice={setChoice}
              onEmail={setEmail}
            />
          </Box>
        ) : (
          <Box key={item.box.key} ref={register([item.box.key])} data-box={item.box.key}>
            <BoxField
              box={item.box}
              value={
                item.box.fieldType === 'drawing'
                  ? draft.drawings[item.box.key]
                  : draft.answers[item.box.key]
              }
              error={errors.get(item.box.key) ?? null}
              tooLong={errors.has(item.box.key) ? null : tooLongText(item.box.key)}
              signingDay={form.signingDay}
              onChange={(value) => setAnswer(item.box, value)}
            />
          </Box>
        ),
      )}
      <SignatureStepPlaceholder />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
        <Button variant="contained" onClick={check}>
          {text.check}
        </Button>
        {checked && (
          <Typography
            role="status"
            color={errors.size === 0 ? 'success.main' : 'error.main'}
            sx={{ fontWeight: 600 }}
          >
            {errors.size === 0 ? text.allGood : text.toFix(errors.size)}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
