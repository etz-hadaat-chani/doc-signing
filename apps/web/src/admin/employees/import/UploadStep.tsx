import { IMPORT_MAX_FILE_BYTES, type ImportPreview } from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { errorContent } from '../../../components/feedback/error-content';
import { FileDropZone } from '../../../components/upload/FileDropZone';
import { he } from '../../../i18n/he';
import { previewImport } from './import.api';
import { columnNames } from './import-view';

const texts = he.employeeImport;
const ACCEPT = { extensions: ['.xlsx'], label: texts.accept };

/**
 * Step 1: pick the Har Gal export and send it for checking. A refused file shows the server's
 * reason by code; the file stays chosen so the check can run again.
 */
export function UploadStep({ onChecked }: { onChecked: (preview: ImportPreview) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const check = useMutation({ mutationFn: previewImport, onSuccess: onChecked });
  const columns = columnNames(check.error);

  return (
    <Box component="section" aria-labelledby="import-upload" sx={{ display: 'grid', gap: 2 }}>
      <Typography variant="h2" id="import-upload">
        {texts.steps[0]}
      </Typography>
      <Typography>{texts.uploadIntro}</Typography>
      <Alert severity="info" role="note">
        {texts.nothingSavedYet}
      </Alert>

      <FileDropZone
        accept={ACCEPT}
        maxBytes={IMPORT_MAX_FILE_BYTES}
        file={file}
        onFileChange={(next) => {
          setFile(next);
          check.reset();
        }}
        disabled={check.isPending}
      />

      {check.isError && (
        <Alert severity="error" role="alert">
          <AlertTitle>{texts.uploadFailed}</AlertTitle>
          {errorContent(check.error).message}
          {columns.length > 0 && <Box sx={{ mt: 0.5 }}>{texts.columns(columns.join(', '))}</Box>}
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Button
          variant="contained"
          disabled={!file || check.isPending}
          onClick={() => {
            if (file && !check.isPending) check.mutate(file);
          }}
          startIcon={
            check.isPending ? <CircularProgress size={16} color="inherit" aria-hidden /> : undefined
          }
        >
          {texts.check}
        </Button>
        {check.isPending && <Typography role="status">{texts.checking}</Typography>}
      </Box>
    </Box>
  );
}
