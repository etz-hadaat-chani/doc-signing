import {
  type EmailChoice,
  errorMessage,
  type SignFormResult,
  type SignPreviewInput,
  type TemplateFieldSettings,
} from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { he } from '../../i18n/he';
import type { DocumentOutcome } from '../document-outcome';
import { submitOutcome } from '../submit-outcome';
import { BoxField } from './BoxField';
import { EmailSection } from './EmailSection';
import {
  currentTooLong,
  EMAIL_CHOICE_ITEM,
  EMAIL_FIT_KEY,
  EMAIL_ITEM,
  emailValue,
  fitTextOf,
  type FormDraft,
  formItems,
  hasEmailSection,
  isFitChecked,
  isShown,
  SIGNATURE_ITEM,
  without,
  withHiddenDropped,
} from './form-draft';
import { hasEnoughInk, type Ink } from './ink';
import { SignatureField } from './SignatureSection';
import { checkPreview } from './submit-check';
import { type FitCall, useFitCheck } from './use-fit-check';

const text = he.sign.form;

/** What can take the focus inside a box (not the hidden date field or MUI's hidden inputs). */
const FOCUSABLE =
  'input:not([disabled]):not([aria-hidden="true"]):not([tabindex="-1"]), ' +
  'textarea:not([aria-hidden="true"]), [role="combobox"], button';

/** How the screen ends: signed by this press, or found already signed (no copy promised). */
export type SignedKind = 'signed' | 'alreadySigned';

/** A preview that failed and stays on B3: "try again", or wait out a 429 first. */
type Failure = { message: string; waitSeconds: number | null };

interface SignFormProps {
  form: SignFormResult;
  draft: FormDraft;
  onDraftChange: Dispatch<SetStateAction<FormDraft>>;
  fit: FitCall;
  /** `POST …/preview` of a link or of the office computer: the signed PDF, watermarked. */
  preview: (body: SignPreviewInput) => Promise<ArrayBuffer>;
  /** The preview arrived: B3a shows it (and keeps the body to sign with). */
  onPreviewed: (pdf: ArrayBuffer, body: SignPreviewInput) => void;
  /** The server's refusals handed back from B3a, shown at their items when B3 opens. */
  initialErrors?: ReadonlyMap<string, string>;
  /** Found already signed (a second tab, the office): done, no copy promised. */
  onSigned: (kind: SignedKind) => void;
  onSessionEnded: () => void;
  onRefused: (outcome: Extract<DocumentOutcome, { kind: 'refused' | 'gone' }>) => void;
}

/**
 * B3 (FR-SGN-4, FR-SGN-5, FR-SGN-9, FR-SGN-10, FR-TPL-9, FR-TPL-10): the correction note, the
 * boxes and the email section in the template's order (a box with a condition appears and
 * disappears as she answers, its answer dropped), then the signature pad and "המשך לתצוגה לפני
 * חתימה". The button waits for the email choice; pressed, it checks everything the server will
 * (`checkPreview`) and shows each Hebrew error at its item, scrolling to the first; after that
 * the errors follow her edits. Then the server builds the signed PDF (B3a, 6.5); its refusals
 * land at the same items. Everything she enters lives in the caller's state (`draft`).
 */
export function SignForm(props: SignFormProps) {
  const { form, draft, onDraftChange, fit, preview, onPreviewed, initialErrors } = props;
  const { onSigned, onSessionEnded, onRefused } = props;
  const [checked, setChecked] = useState(false);
  const [serverErrors, setServerErrors] = useState<Map<string, string>>(
    () => new Map(initialErrors),
  );
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [waiting, setWaiting] = useState(false);
  const sendingRef = useRef(false);
  const reasonId = useId();
  const { tooLong, schedule } = useFitCheck({ fit, onSessionEnded, onRefused });
  // The item containers by key, for the scroll to the first error (filled by their `ref`s).
  const [containers] = useState(() => new Map<string, HTMLElement>());
  const items = useMemo(() => formItems(form.fields), [form.fields]);

  const localErrors = useMemo(
    () => (checked ? checkPreview(form, draft, tooLong).errors : new Map<string, string>()),
    [checked, form, draft, tooLong],
  );
  const errors = useMemo(() => {
    const all = new Map(serverErrors);
    for (const [item, message] of localErrors) all.set(item, message);
    return all;
  }, [localErrors, serverErrors]);
  const warnings = useMemo(() => currentTooLong(form, draft, tooLong), [form, draft, tooLong]);
  const tooLongText = (item: string) =>
    warnings.has(item) ? errorMessage('ANSWER_DOES_NOT_FIT') : null;

  // A 429: the button waits out Retry-After; the timer ends with the screen.
  const waitSeconds = failure?.waitSeconds ?? null;
  useEffect(() => {
    if (waitSeconds === null) return undefined;
    const timer = setTimeout(() => setWaiting(false), waitSeconds * 1000);
    return () => clearTimeout(timer);
  }, [waitSeconds]);

  const update = (change: (current: FormDraft) => FormDraft, ...edited: string[]) => {
    onDraftChange((current) => withHiddenDropped(form, change(current)));
    if (edited.some((item) => serverErrors.has(item))) {
      setServerErrors((current) => new Map([...current].filter(([key]) => !edited.includes(key))));
    }
  };

  /** The "too little ink" mark of a pad, kept with its drawing. */
  const withInk = (current: FormDraft, pad: string, ink: Ink | null): FormDraft => ({
    ...current,
    faint:
      ink !== null && !hasEnoughInk(ink)
        ? { ...current.faint, [pad]: true }
        : without(current.faint, pad),
  });

  const setAnswer = (box: TemplateFieldSettings, value: string | boolean) => {
    if (box.fieldType === 'drawing') {
      const image = typeof value === 'string' ? value : '';
      update(
        (current) => ({ ...current, drawings: { ...current.drawings, [box.key]: image } }),
        box.key,
      );
      return;
    }
    update(
      (current) => ({ ...current, answers: { ...current.answers, [box.key]: value } }),
      box.key,
    );
    if (typeof value === 'string' && isFitChecked(box)) schedule(box.key, fitTextOf(box, value));
  };

  const setInk = (box: TemplateFieldSettings, ink: Ink | null) =>
    update((current) => withInk(current, box.key, ink), box.key);

  const setChoice = (choice: EmailChoice) => {
    update((current) => ({ ...current, emailChoice: choice }), EMAIL_CHOICE_ITEM, EMAIL_ITEM);
    if (choice === 'office') schedule(EMAIL_FIT_KEY, '');
    else schedule(EMAIL_FIT_KEY, emailValue(form, draft).trim());
  };

  const setEmail = (email: string) => {
    update((current) => ({ ...current, email }), EMAIL_ITEM);
    schedule(EMAIL_FIT_KEY, email.trim());
  };

  const setSignature = (png: string, ink: Ink | null) =>
    update(
      (current) => withInk({ ...current, signature: png }, SIGNATURE_ITEM, ink),
      SIGNATURE_ITEM,
    );

  const register = (keys: string[]) => (element: HTMLElement | null) => {
    for (const key of keys) {
      if (element) containers.set(key, element);
      else containers.delete(key);
    }
  };

  /** Scrolls to the first item with an error, in screen order, and puts the focus there. */
  const showFirst = (found: ReadonlyMap<string, string>) => {
    const order = items
      .map((item) => (item.kind === 'box' ? [item.box.key] : [EMAIL_CHOICE_ITEM, EMAIL_ITEM]))
      .flat()
      .concat(SIGNATURE_ITEM);
    const first = order.find((key) => found.has(key));
    const element = first === undefined ? undefined : containers.get(first);
    if (!element) return;
    element.scrollIntoView?.({ block: 'center' });
    const target =
      first === EMAIL_ITEM
        ? element.querySelector<HTMLElement>('input[type="email"]')
        : element.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus({ preventScroll: true });
  };

  const send = async (body: SignPreviewInput) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setFailure(null);
    try {
      const pdf = await preview(body);
      // The screen ends here (B3a opens); the button stays off until it does.
      onPreviewed(pdf, body);
      return;
    } catch (error) {
      const outcome = submitOutcome(error);
      if (outcome.kind === 'fields') {
        setServerErrors(outcome.errors);
        showFirst(new Map([...outcome.errors, ...localErrors]));
      } else if (outcome.kind === 'sessionEnded') onSessionEnded();
      else if (outcome.kind === 'alreadySigned') onSigned('alreadySigned');
      else if (outcome.kind === 'refused' || outcome.kind === 'gone') onRefused(outcome);
      else if (outcome.kind === 'wait') {
        const minutes = outcome.seconds === null ? null : Math.ceil(outcome.seconds / 60);
        setWaiting(outcome.seconds !== null);
        setFailure({
          message: minutes === null ? outcome.message : he.sign.document.wait(minutes),
          waitSeconds: outcome.seconds,
        });
      } else setFailure({ message: outcome.message, waitSeconds: null });
    }
    sendingRef.current = false;
    setSending(false);
  };

  /** "המשך לתצוגה לפני חתימה": everything checked here first; nothing is sent while anything is wrong. */
  const press = () => {
    if (sendingRef.current || waiting) return;
    setChecked(true);
    const { errors: found, body } = checkPreview(form, draft, tooLong);
    if (body === null) {
      showFirst(found);
      return;
    }
    void send(body);
  };

  // Refusals handed back from B3a: the first one is scrolled to and focused, as after a press.
  const showReturned = useEffectEvent(() => {
    if (initialErrors && initialErrors.size > 0) showFirst(initialErrors);
  });
  useEffect(() => {
    showReturned();
  }, []);

  const shownItems = items.filter(
    (item) => item.kind === 'email' || isShown(item.box, form, draft),
  );
  const needsChoice = hasEmailSection(form) && draft.emailChoice === null;

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
              onInk={(ink) => setInk(item.box, ink)}
            />
          </Box>
        ),
      )}
      <Box ref={register([SIGNATURE_ITEM])}>
        <SignatureField
          signature={draft.signature}
          error={errors.get(SIGNATURE_ITEM) ?? null}
          onSignature={setSignature}
        />
      </Box>
      {failure && (
        <Alert
          severity={failure.waitSeconds === null ? 'error' : 'warning'}
          role="alert"
          action={
            failure.waitSeconds === null && (
              <Button color="inherit" onClick={press} disabled={sending}>
                {text.submit.retry}
              </Button>
            )
          }
        >
          {failure.message}
        </Alert>
      )}
      <Box sx={{ display: 'grid', gap: 1, justifyItems: 'start' }}>
        <Button
          variant="contained"
          onClick={press}
          disabled={needsChoice || sending || waiting}
          aria-describedby={needsChoice ? reasonId : undefined}
        >
          {sending ? text.submit.sending : text.submit.button}
        </Button>
        {needsChoice && (
          <Typography id={reasonId} variant="body2" color="text.secondary">
            {text.submit.chooseFirst}
          </Typography>
        )}
        <Typography role="status" color="error.main" sx={{ fontWeight: 600 }}>
          {(checked || serverErrors.size > 0) && errors.size > 0 ? text.toFix(errors.size) : ''}
        </Typography>
      </Box>
    </Box>
  );
}
