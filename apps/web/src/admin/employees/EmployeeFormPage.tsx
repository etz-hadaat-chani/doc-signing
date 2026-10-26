import { type EmployeeCard, hoursBaseLabel } from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { errorContent } from '../../components/feedback/error-content';
import { ErrorState } from '../../components/feedback/ErrorState';
import { PageLoader } from '../../components/feedback/PageLoader';
import { useNotify } from '../../components/notifications/notify-context';
import { departmentOptions } from '../../components/table/departments';
import { he } from '../../i18n/he';
import { dashboardKeys } from '../dashboard/dashboard.api';
import {
  checkEdit,
  checkNew,
  emptyForm,
  type FieldErrors,
  type FormField,
  formFromCard,
  type FormValues,
  isRequired,
  serverFieldErrors,
} from './employee-form';
import { createEmployee, employeeKeys, fetchEmployee, updateEmployee } from './employees.api';
import { useDepartments } from './use-departments';

const fields = he.employees.fields;
const text = he.employees.form;

/** Typed left to right: digits, phones, the email address and the date. */
const LTR_FIELDS: ReadonlySet<FormField> = new Set([
  'employeeNumber',
  'idNumber',
  'email',
  'landline',
  'mobile',
  'birthDate',
  'jobPercent',
  'hoursBaseCode',
]);

const SECTIONS: readonly { title: string; fields: readonly FormField[] }[] = [
  {
    title: text.mainSection,
    fields: ['employeeNumber', 'idNumber', 'firstName', 'lastName', 'departmentId'],
  },
  { title: text.contactSection, fields: ['email', 'landline', 'mobile', 'address', 'city'] },
  {
    title: text.jobSection,
    fields: [
      'birthDate',
      'jobTitle',
      'employmentStatus',
      'jobPercent',
      'workDays',
      'hoursBaseCode',
      'pensionFundA',
      'pensionFundB',
      'studyFund',
    ],
  },
];

const LABELS: Record<FormField, string> = {
  ...fields,
  departmentId: fields.department,
};

/** Under a field: its error, else a hint (date shape, hours base, the locked number). */
function hintFor(field: FormField, values: FormValues, isEdit: boolean): string | undefined {
  if (field === 'birthDate') return text.dateFormat;
  if (field === 'employeeNumber' && isEdit) return text.employeeNumberLocked;
  if (field === 'hoursBaseCode' && /^\d+$/.test(values.hoursBaseCode.trim())) {
    const label = hoursBaseLabel(Number(values.hoursBaseCode));
    return label === null ? undefined : text.hoursBase(label);
  }
  return undefined;
}

interface EmployeeFormProps {
  /** The stored employee when editing; undefined when adding. */
  stored?: EmployeeCard;
}

function EmployeeForm({ stored }: EmployeeFormProps) {
  const isEdit = stored !== undefined;
  const navigate = useNavigate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const departments = useDepartments();
  const [values, setValues] = useState<FormValues>(() =>
    stored ? formFromCard(stored) : emptyForm(),
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  const save = useMutation({ mutationFn: (send: () => Promise<EmployeeCard>) => send() });

  const change = (field: FormField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const showErrors = (found: FieldErrors) => {
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) document.getElementById(`employee-${first}`)?.focus();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let send: () => Promise<EmployeeCard>;
    if (stored) {
      const { input, errors: found, unchanged } = checkEdit(values, stored);
      if (unchanged) {
        notify.success(text.noChanges);
        return;
      }
      if (!input) {
        showErrors(found);
        return;
      }
      send = () => updateEmployee(stored.id, input);
    } else {
      const { input, errors: found } = checkNew(values);
      if (!input) {
        showErrors(found);
        return;
      }
      send = () => createEmployee(input);
    }
    try {
      const saved = await save.mutateAsync(send);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: employeeKeys.all }),
        queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
      ]);
      notify.success(isEdit ? text.saved : text.created);
      await navigate(`/employees/${saved.id}`);
    } catch (error) {
      const found = serverFieldErrors(error);
      if (found) showErrors(found);
      else notify.error(errorContent(error).message);
    }
  };

  const departmentChoices = departmentOptions(departments);

  return (
    <Box
      component="form"
      method="post"
      noValidate
      aria-label={isEdit ? he.nav.employeeEdit : he.nav.employeeNew}
      onSubmit={(event: FormEvent<HTMLFormElement>) => void handleSubmit(event)}
      sx={{ display: 'grid', gap: 3 }}
    >
      {/* A standing reminder, not an announcement: no "alert" role. */}
      <Alert severity="info" role="note">
        {text.harGalReminder}
      </Alert>
      {Object.values(errors).some(Boolean) && (
        <Alert severity="error" role="alert">
          {text.fixFields}
        </Alert>
      )}
      {SECTIONS.map((section) => (
        <Paper key={section.title} variant="outlined" component="fieldset" sx={{ p: 3, m: 0 }}>
          <Typography component="legend" variant="h2" sx={{ px: 1 }}>
            {section.title}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
              gap: 2.5,
              mt: 1,
            }}
          >
            {section.fields.map((field) => {
              const error = errors[field];
              const isDepartment = field === 'departmentId';
              return (
                <TextField
                  key={field}
                  id={`employee-${field}`}
                  name={field}
                  label={LABELS[field]}
                  value={values[field]}
                  onChange={(event) => change(field, event.target.value)}
                  select={isDepartment}
                  required={isRequired(field, isEdit)}
                  disabled={field === 'employeeNumber' && isEdit}
                  error={Boolean(error)}
                  helperText={error ?? hintFor(field, values, isEdit)}
                  autoComplete="off"
                  fullWidth
                  slotProps={{
                    htmlInput: LTR_FIELDS.has(field) ? { dir: 'ltr' } : {},
                  }}
                >
                  {isDepartment &&
                    departmentChoices.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                </TextField>
              );
            })}
          </Box>
        </Paper>
      ))}
      {isEdit && (
        <Box>
          <FormControlLabel
            control={
              <Checkbox
                checked={values.isActive}
                onChange={(event) =>
                  setValues((current) => ({ ...current, isActive: event.target.checked }))
                }
              />
            }
            label={fields.isActive}
          />
          <Typography variant="body2" color="text.secondary">
            {text.inactiveHint}
          </Typography>
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button type="submit" variant="contained" size="large" disabled={save.isPending}>
          {save.isPending ? text.saving : text.save}
        </Button>
        <Button
          variant="outlined"
          size="large"
          component={RouterLink}
          to={stored ? `/employees/${stored.id}` : '/employees'}
        >
          {he.common.cancel}
        </Button>
      </Box>
    </Box>
  );
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

/**
 * Add (`/employees/new`) or edit (`/employees/:employeeId/edit`) one employee: managers only
 * (the route's role check; the API refuses officers too). The same rules as the server: the
 * shared schemas.
 */
export function EmployeeFormPage() {
  const { employeeId } = useParams();
  const isEdit = employeeId !== undefined;
  const validId = isEdit && isUuid(employeeId);
  const card = useQuery({
    queryKey: employeeKeys.card(employeeId ?? ''),
    queryFn: ({ signal }) => fetchEmployee(employeeId ?? '', signal),
    enabled: validId,
  });

  let content;
  if (!isEdit) {
    content = <EmployeeForm />;
  } else if (!validId) {
    return (
      <ErrorState
        variant="notFound"
        title={he.feedback.notFoundTitle}
        message={he.feedback.notFoundText}
      />
    );
  } else if (card.isPending) {
    return <PageLoader />;
  } else if (!card.data) {
    return <ErrorState {...errorContent(card.error)} onRetry={() => void card.refetch()} />;
  } else {
    // Keyed by the save time, so a reopened form starts from what is stored now.
    content = <EmployeeForm key={card.data.updatedAt} stored={card.data} />;
  }

  const title =
    isEdit && card.data
      ? text.editTitle(`${card.data.firstName} ${card.data.lastName}`)
      : text.addTitle;
  return (
    <Box sx={{ maxWidth: 960 }}>
      <Typography variant="h1" sx={{ mb: 3 }}>
        {title}
      </Typography>
      {content}
    </Box>
  );
}
