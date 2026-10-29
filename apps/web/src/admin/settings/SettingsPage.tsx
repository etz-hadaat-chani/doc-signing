import {
  HR_CONTACT_NAME_MAX_LENGTH,
  SENDER_NAME_MAX_LENGTH,
  type SettingsItem,
} from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog';
import { errorContent } from '../../components/feedback/error-content';
import { ErrorState } from '../../components/feedback/ErrorState';
import { PageLoader } from '../../components/feedback/PageLoader';
import { useNotify } from '../../components/notifications/notify-context';
import { he } from '../../i18n/he';
import { useUnsavedGuard } from '../templates/editor/use-unsaved-guard';
import { EmployerSignatureSection } from './EmployerSignatureSection';
import { fetchSettings, settingsKeys, updateSettings } from './settings.api';
import {
  checkSettingsPage,
  serverSettingsErrors,
  SETTINGS_PAGE_FIELDS,
  type SettingsPageErrors,
  type SettingsPageField,
  settingsPageFrom,
  type SettingsPageValues,
} from './settings-page-form';
import { SkipDatesEditor } from './SkipDatesEditor';

const text = he.settings;
const numbers = he.newRound.settings;

const fieldId = (field: SettingsPageField) => `settings-${field}`;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Paper
      component="section"
      aria-labelledby={id}
      variant="outlined"
      sx={{ p: 3, display: 'grid', gap: 2 }}
    >
      <Typography id={id} component="h2" variant="h3">
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

/** The editable settings: one form, one save, only what changed is sent. */
function SettingsForm({ stored }: { stored: SettingsItem }) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<SettingsPageValues>(() => settingsPageFrom(stored));
  const [errors, setErrors] = useState<SettingsPageErrors>({});
  const [unchangedNote, setUnchangedNote] = useState(false);
  // A second click before the answer must not save twice.
  const saving = useRef(false);
  const save = useMutation({ mutationFn: updateSettings });

  // Stored values read again (after a save, or changed elsewhere): refill only an untouched form.
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    if (checkSettingsPage(values, seen).unchanged) setValues(settingsPageFrom(stored));
  }
  const dirty = !checkSettingsPage(values, stored).unchanged;

  const { blocker } = useUnsavedGuard(dirty);

  const change = (patch: Partial<SettingsPageValues>, ...cleared: SettingsPageField[]) => {
    setValues((current) => ({ ...current, ...patch }));
    setUnchangedNote(false);
    if (cleared.length > 0) {
      setErrors((current) => {
        const next = { ...current };
        for (const field of cleared) delete next[field];
        return next;
      });
    }
  };

  const showErrors = (found: SettingsPageErrors) => {
    setErrors(found);
    const first = SETTINGS_PAGE_FIELDS.find((field) => found[field] !== undefined);
    if (first) document.getElementById(fieldId(first))?.focus();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving.current) return;
    const { input, errors: found, unchanged } = checkSettingsPage(values, stored);
    if (unchanged) {
      setUnchangedNote(true);
      return;
    }
    if (!input) {
      showErrors(found);
      return;
    }
    saving.current = true;
    try {
      const answer = await save.mutateAsync(input);
      setValues(settingsPageFrom(answer));
      setErrors({});
      queryClient.setQueryData(settingsKeys.all, answer);
      // Exact: the image link under this key must not be asked for again (a logged view).
      await queryClient.invalidateQueries({ queryKey: settingsKeys.all, exact: true });
      notify.success(text.saved);
    } catch (error) {
      const fieldErrors = serverSettingsErrors(error);
      if (fieldErrors) showErrors(fieldErrors);
      else notify.error(errorContent(error).message);
    } finally {
      saving.current = false;
    }
  };

  const textField = (
    field: Exclude<SettingsPageField, 'reminderSkipDates'>,
    label: string,
    options: { ltr?: boolean; numeric?: boolean; maxLength?: number; required?: boolean } = {},
  ) => (
    <TextField
      id={fieldId(field)}
      label={label}
      value={values[field]}
      onChange={(event) => change({ [field]: event.target.value }, field)}
      error={errors[field] !== undefined}
      helperText={errors[field]}
      required={options.required ?? false}
      autoComplete="off"
      slotProps={{
        htmlInput: {
          ...(options.ltr && { dir: 'ltr' }),
          ...(options.numeric && { inputMode: 'numeric' }),
          ...(options.maxLength !== undefined && { maxLength: options.maxLength }),
        },
      }}
      sx={{ maxWidth: options.numeric ? 280 : 480 }}
    />
  );

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <Box
      component="form"
      method="post"
      noValidate
      aria-label={text.title}
      onSubmit={(event: FormEvent<HTMLFormElement>) => void handleSubmit(event)}
      sx={{ display: 'grid', gap: 3 }}
    >
      {hasErrors && (
        <Alert severity="error" role="alert">
          {text.fixFields}
        </Alert>
      )}

      <Section id="settings-reminders" title={text.reminders.title}>
        <Typography color="text.secondary">{text.reminders.intro}</Typography>
        {textField('reminderIntervalDays', numbers.reminderIntervalDays, {
          ltr: true,
          numeric: true,
          required: true,
        })}
        <FormControl>
          <FormLabel id="settings-max-reminders">{numbers.maxRemindersLabel}</FormLabel>
          <RadioGroup
            aria-labelledby="settings-max-reminders"
            value={values.limitReminders ? 'limited' : 'unlimited'}
            onChange={(_event, value) =>
              change({ limitReminders: value === 'limited' }, 'maxReminders')
            }
          >
            <FormControlLabel value="unlimited" control={<Radio />} label={numbers.unlimited} />
            <FormControlLabel value="limited" control={<Radio />} label={numbers.limited} />
          </RadioGroup>
        </FormControl>
        {values.limitReminders &&
          textField('maxReminders', numbers.maxReminders, {
            ltr: true,
            numeric: true,
            required: true,
          })}
        {textField('linkExpiryDays', numbers.linkExpiryDays, {
          ltr: true,
          numeric: true,
          required: true,
        })}
        <Typography color="text.secondary">{numbers.expiryHint}</Typography>
      </Section>

      <Section id="settings-sender" title={text.sender.title}>
        <Typography color="text.secondary">{text.sender.hint}</Typography>
        {textField('senderName', text.sender.label, {
          maxLength: SENDER_NAME_MAX_LENGTH,
          required: true,
        })}
      </Section>

      <Section id="settings-hr-contact" title={text.hrContact.title}>
        <Alert severity="info" role="note">
          {text.hrContact.note}
        </Alert>
        <Typography color="text.secondary">{text.hrContact.phoneOrEmail}</Typography>
        {textField('hrName', text.hrContact.name, {
          maxLength: HR_CONTACT_NAME_MAX_LENGTH,
          required: true,
        })}
        {textField('hrPhone', text.hrContact.phone, { ltr: true })}
        {textField('hrEmail', text.hrContact.email, { ltr: true })}
      </Section>

      <Section id="settings-skip-dates" title={text.skipDates.title}>
        <SkipDatesEditor
          value={values.reminderSkipDates}
          onChange={(reminderSkipDates) => change({ reminderSkipDates }, 'reminderSkipDates')}
          error={errors.reminderSkipDates}
        />
      </Section>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={save.isPending}
          startIcon={
            save.isPending ? <CircularProgress size={16} color="inherit" aria-hidden /> : undefined
          }
        >
          {save.isPending ? text.saving : text.save}
        </Button>
        {dirty && <Typography color="text.secondary">{text.unsaved}</Typography>}
        {unchangedNote && !dirty && (
          <Typography role="status" color="text.secondary">
            {text.unchanged}
          </Typography>
        )}
      </Box>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title={text.leaveTitle}
        text={text.leaveText}
        confirmLabel={text.leaveConfirm}
        cancelLabel={text.stay}
        danger
        onConfirm={() => blocker.proceed?.()}
        onClose={() => blocker.reset?.()}
      />
    </Box>
  );
}

/**
 * Settings (A11, FR-ADM-2), managers only: round defaults, sender name, HR contact, no-reminder
 * dates, and the employer signature image (its own upload, outside the form's save).
 */
export function SettingsPage() {
  const settings = useQuery({
    queryKey: settingsKeys.all,
    queryFn: ({ signal }) => fetchSettings(signal),
  });

  return (
    <Box sx={{ maxWidth: 960, display: 'grid', gap: 3 }}>
      <Typography variant="h1">{text.title}</Typography>
      {settings.isPending ? (
        <PageLoader />
      ) : settings.isError ? (
        <ErrorState
          {...errorContent(settings.error)}
          title={text.loadFailed}
          headingComponent="h2"
          onRetry={() => void settings.refetch()}
        />
      ) : (
        <>
          <Typography>{text.intro}</Typography>
          <SettingsForm stored={settings.data} />
          <EmployerSignatureSection summary={settings.data.employerSignature} />
        </>
      )}
    </Box>
  );
}
