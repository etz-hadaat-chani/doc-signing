import { MANUAL_SCAN_MAX_BYTES, type ManualRow } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog';
import { FileDropZone } from '../../components/upload/FileDropZone';
import { he } from '../../i18n/he';
import { useAction } from '../rounds/actions/use-action';
import { uploadScan } from './manual.api';

const text = he.manual.scan;
const ACCEPT = { extensions: ['.pdf'], label: text.accept };

/**
 * The scanned paper signature (FR-MAN-3): one PDF up to the shared limit; the server checks the
 * content. Done → "Signed manually", no signed copy is emailed.
 */
export function ScanUploadDialog({ row, onClose }: { row: ManualRow; onClose: () => void }) {
  const { busy, run } = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [missing, setMissing] = useState(false);

  const upload = async () => {
    if (file === null) {
      setMissing(true);
      return;
    }
    const stored = await run(() => uploadScan(row.assignmentId, file), {
      employees: true,
      done: () => text.done,
    });
    if (stored) onClose();
  };

  return (
    <ConfirmDialog
      open
      title={text.title(`${row.employee.firstName} ${row.employee.lastName}`)}
      text={text.text}
      confirmLabel={text.confirm}
      cancelLabel={he.rounds.actions.keep}
      busy={busy}
      onConfirm={() => void upload()}
      onClose={onClose}
    >
      <Box sx={{ mt: 2 }}>
        <FileDropZone
          accept={ACCEPT}
          maxBytes={MANUAL_SCAN_MAX_BYTES}
          file={file}
          onFileChange={(next) => {
            setFile(next);
            setMissing(false);
          }}
          disabled={busy}
        />
        {missing && (
          <Typography role="alert" color="error" variant="body2" sx={{ mt: 1 }}>
            {text.required}
          </Typography>
        )}
      </Box>
    </ConfirmDialog>
  );
}
