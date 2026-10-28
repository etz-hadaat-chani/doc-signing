import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { errorContent } from '../../../components/feedback/error-content';
import { ErrorState } from '../../../components/feedback/ErrorState';
import { PageLoader } from '../../../components/feedback/PageLoader';
import { he } from '../../../i18n/he';
import { fetchSettings, settingsKeys } from '../../settings/settings.api';
import {
  expiryExample,
  type SettingsErrors,
  type SettingsField,
  settingsFormFrom,
  type SettingsFormValues,
} from './settings-form';
import type { WizardAction } from './wizard-state';

const texts = he.newRound.settings;

function NumberField({
  field,
  label,
  values,
  errors,
  disabled = false,
  onChange,
}: {
  field: SettingsField;
  label: string;
  values: SettingsFormValues;
  errors: SettingsErrors;
  disabled?: boolean;
  onChange: (values: SettingsFormValues) => void;
}) {
  const error = errors[field];
  return (
    <TextField
      label={label}
      value={values[field]}
      onChange={(event) => onChange({ ...values, [field]: event.target.value })}
      error={error !== undefined}
      helperText={error}
      disabled={disabled}
      required
      slotProps={{ htmlInput: { inputMode: 'numeric', dir: 'ltr' } }}
      sx={{ maxWidth: 280 }}
    />
  );
}

/**
 * Step 5 (FR-RND-5): reminders, their interval and limit, and the link expiry, prefilled from the
 * settings once. The expiry counts from the send, shown as "if sent today: valid until …".
 */
export function SettingsStep({
  values,
  errors,
  dispatch,
}: {
  values: SettingsFormValues | null;
  /** Shown after the first "next". */
  errors: SettingsErrors;
  dispatch: (action: WizardAction) => void;
}) {
  const settings = useQuery({
    queryKey: settingsKeys.all,
    queryFn: ({ signal }) => fetchSettings(signal),
    enabled: values === null,
  });
  useEffect(() => {
    if (settings.data)
      dispatch({ type: 'settingsLoaded', values: settingsFormFrom(settings.data) });
  }, [settings.data, dispatch]);

  if (values === null) {
    if (settings.isError) {
      return (
        <ErrorState
          {...errorContent(settings.error)}
          title={texts.loadFailed}
          headingComponent="h3"
          onRetry={() => void settings.refetch()}
        />
      );
    }
    return <PageLoader />;
  }

  const change = (next: SettingsFormValues) => dispatch({ type: 'settings', values: next });
  const example = expiryExample(values.linkExpiryDays);

  return (
    <>
      <Typography color="text.secondary">{texts.intro}</Typography>
      <Box sx={{ display: 'grid', gap: 2 }}>
        <FormControlLabel
          control={
            <Checkbox
              checked={values.remindersEnabled}
              onChange={(event) => change({ ...values, remindersEnabled: event.target.checked })}
            />
          }
          label={texts.remindersEnabled}
        />
        {/* Off: the values stay (all four are always sent), shown but not editable. */}
        {!values.remindersEnabled && (
          <Typography color="text.secondary">{texts.remindersOff}</Typography>
        )}
        <NumberField
          field="reminderIntervalDays"
          label={texts.reminderIntervalDays}
          values={values}
          errors={errors}
          disabled={!values.remindersEnabled}
          onChange={change}
        />
        <FormControl disabled={!values.remindersEnabled}>
          <FormLabel id="round-max-reminders">{texts.maxRemindersLabel}</FormLabel>
          <RadioGroup
            aria-labelledby="round-max-reminders"
            value={values.limitReminders ? 'limited' : 'unlimited'}
            onChange={(_event, value) => change({ ...values, limitReminders: value === 'limited' })}
          >
            <FormControlLabel value="unlimited" control={<Radio />} label={texts.unlimited} />
            <FormControlLabel value="limited" control={<Radio />} label={texts.limited} />
          </RadioGroup>
        </FormControl>
        {values.limitReminders && (
          <NumberField
            field="maxReminders"
            label={texts.maxReminders}
            values={values}
            errors={errors}
            disabled={!values.remindersEnabled}
            onChange={change}
          />
        )}
      </Box>
      <Box sx={{ display: 'grid', gap: 1 }}>
        <NumberField
          field="linkExpiryDays"
          label={texts.linkExpiryDays}
          values={values}
          errors={errors}
          onChange={change}
        />
        <Typography color="text.secondary">{texts.expiryHint}</Typography>
        {example !== null && (
          <Typography data-testid="expiry-example">{texts.expiryExample(example)}</Typography>
        )}
      </Box>
    </>
  );
}
