import {
  EMPLOYER_SIGNATURE_MODES,
  type EmployerSignatureMode,
  type TemplateItem,
  TEMPLATE_NAME_MAX_LENGTH,
  type TemplateUpdateInput,
} from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { isApiRequestError } from '../../api/api-error';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog';
import { errorContent } from '../../components/feedback/error-content';
import { DepartmentPicker } from '../../components/forms/DepartmentPicker';
import { useNotify } from '../../components/notifications/notify-context';
import { he } from '../../i18n/he';
import { useDepartments } from '../employees/use-departments';
import {
  checkSettings,
  formFromItem,
  serverFieldErrors,
  type SettingsValues,
  type TemplateFieldErrors,
} from './template-form';
import { isEditable } from './template-view';
import { templateKeys, updateTemplate } from './templates.api';

const text = he.templates.details;
const modes = he.templates.employerModes;

/** Someone else changed or archived this version first: show it again from the server. */
const CONFLICT_CODES = new Set(['TEMPLATE_HAS_NEWER_VERSION', 'TEMPLATE_ARCHIVED']);

interface SettingsFormProps {
  item: TemplateItem;
  /** The newest version's id, when this one isn't it (from the version history). */
  latestId: string | null;
}

/**
 * Name, departments and the employer-signature setting (FR-TPL-1, FR-TPL-7). Only changes are
 * sent. On a locked version a change to the name or the employer signature makes the next
 * version, so the manager confirms that first (FR-TPL-4); departments alone change in place.
 */
export function TemplateSettingsForm({ item, latestId }: SettingsFormProps) {
  const navigate = useNavigate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const departments = useDepartments();
  const editable = isEditable(item);
  const [values, setValues] = useState<SettingsValues>(() => formFromItem(item));
  const [errors, setErrors] = useState<TemplateFieldErrors>({});
  const [pending, setPending] = useState<TemplateUpdateInput | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (input: TemplateUpdateInput) => updateTemplate(item.id, input),
  });

  const showErrors = (found: TemplateFieldErrors) => {
    setErrors(found);
    if (found.name) document.getElementById('template-name')?.focus();
    else if (found.departmentIds) document.getElementById('template-departments')?.focus();
  };

  const send = async (input: TemplateUpdateInput) => {
    try {
      const saved = await save.mutateAsync(input);
      await queryClient.invalidateQueries({ queryKey: templateKeys.all });
      setPending(null);
      if (saved.id === item.id) {
        notify.success(text.saved);
      } else {
        notify.success(text.versionCreated(saved.version));
        await navigate(`/templates/${saved.id}`);
      }
    } catch (error) {
      setPending(null);
      const found = serverFieldErrors(error);
      if (found) {
        showErrors(found);
      } else if (isApiRequestError(error) && error.code && CONFLICT_CODES.has(error.code)) {
        setConflict(error.message);
        await queryClient.invalidateQueries({ queryKey: templateKeys.all });
      } else {
        notify.error(errorContent(error).message);
      }
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (save.isPending) return;
    const check = checkSettings(values, item);
    if (check.unchanged) {
      notify.success(text.noChanges);
      return;
    }
    if (!check.input) {
      showErrors(check.errors);
      return;
    }
    if (check.createsVersion) setPending(check.input);
    else void send(check.input);
  };

  let readOnlyNote: string | null = null;
  if (item.isArchived) readOnlyNote = text.readOnlyArchived;
  else if (!item.isLatest) readOnlyNote = text.readOnlyOld;

  return (
    <Paper variant="outlined" component="section" aria-labelledby="template-settings" sx={{ p: 3 }}>
      <Typography id="template-settings" variant="h2" sx={{ mb: 2 }}>
        {text.settingsTitle}
      </Typography>
      <Box
        component="form"
        method="post"
        noValidate
        aria-labelledby="template-settings"
        onSubmit={handleSubmit}
        sx={{ display: 'grid', gap: 2.5 }}
      >
        {readOnlyNote && (
          <Alert severity="info" role="note">
            {readOnlyNote}
            {latestId && (
              <>
                {' '}
                <Link component={RouterLink} to={`/templates/${latestId}`}>
                  {text.toLatest}
                </Link>
              </>
            )}
          </Alert>
        )}
        {editable && item.isLocked && (
          <Alert severity="warning" role="note">
            {text.lockedNote}
          </Alert>
        )}
        {conflict && (
          <Alert severity="error" role="alert">
            {conflict}
          </Alert>
        )}
        <TextField
          id="template-name"
          name="name"
          label={he.templates.upload.name}
          value={values.name}
          onChange={(event) => {
            setValues((current) => ({ ...current, name: event.target.value }));
            setErrors((current) => ({ ...current, name: undefined }));
          }}
          required
          disabled={!editable}
          error={Boolean(errors.name)}
          helperText={errors.name}
          autoComplete="off"
          fullWidth
          slotProps={{ htmlInput: { maxLength: TEMPLATE_NAME_MAX_LENGTH } }}
        />
        <DepartmentPicker
          id="template-departments"
          departments={departments}
          value={values.departmentIds}
          onChange={(departmentIds) => {
            setValues((current) => ({ ...current, departmentIds }));
            setErrors((current) => ({ ...current, departmentIds: undefined }));
          }}
          required
          disabled={!editable}
          error={errors.departmentIds}
        />
        <FormControl component="fieldset" disabled={!editable}>
          <FormLabel component="legend">{text.employerSignature}</FormLabel>
          <RadioGroup
            name="employerSignatureMode"
            value={values.employerSignatureMode}
            onChange={(event) => {
              const mode = EMPLOYER_SIGNATURE_MODES.find((m) => m === event.target.value);
              if (mode) setValues((current) => ({ ...current, employerSignatureMode: mode }));
            }}
          >
            {EMPLOYER_SIGNATURE_MODES.map((mode: EmployerSignatureMode) => (
              <FormControlLabel
                key={mode}
                value={mode}
                control={<Radio />}
                sx={{ alignItems: 'flex-start', mb: 1 }}
                label={
                  <Box sx={{ pt: 1 }}>
                    <Typography component="span" sx={{ display: 'block' }}>
                      {modes[mode]}
                    </Typography>
                    <Typography component="span" variant="body2" color="text.secondary">
                      {he.templates.employerModeHints[mode]}
                    </Typography>
                  </Box>
                }
              />
            ))}
          </RadioGroup>
        </FormControl>
        {editable && (
          <Box>
            <Button type="submit" variant="contained" size="large" disabled={save.isPending}>
              {save.isPending ? text.saving : text.save}
            </Button>
          </Box>
        )}
      </Box>
      <ConfirmDialog
        open={pending !== null}
        title={text.versionDialogTitle}
        text={text.versionDialogText(item.version, item.version + 1)}
        confirmLabel={text.versionDialogConfirm}
        busy={save.isPending}
        onConfirm={() => {
          if (pending && !save.isPending) void send(pending);
        }}
        onClose={() => setPending(null)}
      />
    </Paper>
  );
}
