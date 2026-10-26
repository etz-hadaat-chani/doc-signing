import { TEMPLATE_MAX_FILE_BYTES, TEMPLATE_NAME_MAX_LENGTH } from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { errorContent } from '../../components/feedback/error-content';
import { DepartmentPicker } from '../../components/forms/DepartmentPicker';
import { useNotify } from '../../components/notifications/notify-context';
import { FileDropZone } from '../../components/upload/FileDropZone';
import { he } from '../../i18n/he';
import { useDepartments } from '../employees/use-departments';
import {
  checkUpload,
  serverFieldErrors,
  type TemplateFieldErrors,
  type UploadValues,
} from './template-form';
import { templateKeys, uploadTemplate } from './templates.api';

const text = he.templates.upload;
const ACCEPT = { extensions: ['.pdf'], label: text.accept };

/**
 * New template (A9, Flow 2 step 1), managers only: the department's PDF, a name and the
 * departments. The server checks the PDF's content; a refusal says what to do with the file,
 * and the file stays chosen. Version 1 has no positions yet, so it isn't ready.
 */
export function TemplateUploadPage() {
  const navigate = useNavigate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const departments = useDepartments();
  const [values, setValues] = useState<UploadValues>({ name: '', departmentIds: [] });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<TemplateFieldErrors>({});
  // A second click before the answer must not upload the file twice.
  const sending = useRef(false);
  const upload = useMutation({ mutationFn: uploadTemplate });

  const showErrors = (found: TemplateFieldErrors) => {
    setErrors(found);
    if (found.name) document.getElementById('template-name')?.focus();
    else if (found.departmentIds) document.getElementById('template-departments')?.focus();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending.current) return;
    const { input, errors: found } = checkUpload(values, file);
    if (!input || !file) {
      showErrors(found);
      return;
    }
    sending.current = true;
    try {
      const created = await upload.mutateAsync({ file, ...input });
      await queryClient.invalidateQueries({ queryKey: templateKeys.all });
      notify.success(text.created);
      await navigate(`/templates/${created.id}`);
    } catch (error) {
      const fieldErrors = serverFieldErrors(error);
      if (fieldErrors) showErrors(fieldErrors);
      else notify.error(errorContent(error).message);
    } finally {
      sending.current = false;
    }
  };

  const fieldErrorShown = Boolean(errors.name ?? errors.departmentIds);

  return (
    <Box sx={{ maxWidth: 960 }}>
      <Typography variant="h1" sx={{ mb: 3 }}>
        {text.title}
      </Typography>
      <Box
        component="form"
        method="post"
        noValidate
        aria-label={text.title}
        onSubmit={(event: FormEvent<HTMLFormElement>) => void handleSubmit(event)}
        sx={{ display: 'grid', gap: 3 }}
      >
        <Typography>{text.intro}</Typography>
        <Alert severity="info" role="note">
          {text.afterUpload}
        </Alert>
        {fieldErrorShown && (
          <Alert severity="error" role="alert">
            {he.templates.form.fixFields}
          </Alert>
        )}
        <Paper variant="outlined" sx={{ p: 3, display: 'grid', gap: 2.5 }}>
          <TextField
            id="template-name"
            name="name"
            label={text.name}
            value={values.name}
            onChange={(event) => {
              setValues((current) => ({ ...current, name: event.target.value }));
              setErrors((current) => ({ ...current, name: undefined }));
            }}
            required
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
            error={errors.departmentIds}
          />
          <Box>
            <Typography component="h2" variant="h3" sx={{ mb: 1 }}>
              {text.file}
            </Typography>
            <FileDropZone
              accept={ACCEPT}
              maxBytes={TEMPLATE_MAX_FILE_BYTES}
              file={file}
              onFileChange={(next) => {
                setFile(next);
                setErrors((current) => ({ ...current, file: undefined }));
              }}
              disabled={upload.isPending}
            />
          </Box>
          {errors.file && (
            <Alert severity="error" role="alert">
              <AlertTitle>{text.failed}</AlertTitle>
              {errors.file}
            </Alert>
          )}
        </Paper>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={upload.isPending}
            startIcon={
              upload.isPending ? (
                <CircularProgress size={16} color="inherit" aria-hidden />
              ) : undefined
            }
          >
            {upload.isPending ? text.submitting : text.submit}
          </Button>
          <Button variant="outlined" size="large" component={RouterLink} to="/templates">
            {he.common.cancel}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
