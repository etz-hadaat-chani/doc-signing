import {
  formatDate,
  formatDepartment,
  formatTime,
  type ImportCommitResult,
  type ImportPreview,
} from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '../../../components/dialogs/ConfirmDialog';
import { useNotify } from '../../../components/notifications/notify-context';
import { formatNumber } from '../../../i18n/format';
import { he } from '../../../i18n/he';
import { tokens } from '../../../theme/tokens';
import { dashboardKeys } from '../../dashboard/dashboard.api';
import { employeeKeys } from '../employees.api';
import { commitImport } from './import.api';
import { canConfirm, confirmableUntil, needsNewUpload } from './import-view';
import { ImportCounts } from './ImportCounts';
import { ImportReport } from './ImportReport';

const texts = he.employeeImport;

function errorsSkippedText(count: number): string {
  return count === 1 ? texts.oneErrorSkipped : texts.errorsSkipped(formatNumber(count));
}

/** What the confirm will do, in the dialog: counts, departments, and that nothing is sent. */
function dialogText({ counts }: ImportPreview): string {
  return [
    counts.rowsNew > 0 && texts.dialogNew(formatNumber(counts.rowsNew)),
    counts.rowsUpdated > 0 && texts.dialogUpdated(formatNumber(counts.rowsUpdated)),
    counts.rowsFailed > 0 && texts.dialogSkipped(formatNumber(counts.rowsFailed)),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Step 2: the check report and the confirm. The preview lives only on the server and in this
 * component; leaving changes nothing. Rows with errors are skipped, the rest are imported.
 */
export function PreviewStep({
  preview,
  receivedAt,
  onStartOver,
  onDone,
}: {
  preview: ImportPreview;
  receivedAt: Date;
  onStartOver: () => void;
  onDone: (result: ImportCommitResult) => void;
}) {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Two clicks before the next render must still send one commit.
  const sending = useRef(false);

  const commit = useMutation({
    mutationFn: commitImport,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: employeeKeys.all });
      void queryClient.invalidateQueries({ queryKey: employeeKeys.departments });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      notify.success(texts.doneNotify);
      onDone(result);
    },
    onError: (error) => {
      setDialogOpen(false);
      if (needsNewUpload(error)) setRefusal(error.message);
      else notify.error(error.message);
    },
    onSettled: () => {
      sending.current = false;
    },
  });

  const until = confirmableUntil(receivedAt);
  const allowed = canConfirm(preview) && refusal === null;
  const { counts } = preview;

  return (
    <Box component="section" aria-labelledby="import-preview" sx={{ display: 'grid', gap: 3 }}>
      <Box>
        <Typography variant="h2" id="import-preview">
          {texts.previewTitle}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {texts.fileName}: <bdi>{preview.fileName}</bdi>
        </Typography>
      </Box>

      <ImportCounts counts={counts} labels={texts.counts} label={texts.countsLabel} />

      {refusal !== null ? (
        <Alert
          severity="error"
          role="alert"
          action={
            <Button color="inherit" variant="outlined" onClick={onStartOver}>
              {texts.uploadAgain}
            </Button>
          }
        >
          {refusal}
        </Alert>
      ) : (
        canConfirm(preview) && (
          <Typography>{texts.confirmableUntil(formatDate(until), formatTime(until))}</Typography>
        )
      )}

      <ImportReport preview={preview} />

      <Alert severity="info" role="note">
        {texts.leaveNote}
      </Alert>

      <Box sx={{ display: 'grid', gap: 1 }}>
        {!canConfirm(preview) && <Typography>{texts.nothingToImport}</Typography>}
        {allowed && counts.rowsFailed > 0 && (
          <Typography>{errorsSkippedText(counts.rowsFailed)}</Typography>
        )}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          <Button variant="contained" disabled={!allowed} onClick={() => setDialogOpen(true)}>
            {texts.confirm}
          </Button>
          <Button variant="outlined" onClick={onStartOver} disabled={commit.isPending}>
            {texts.uploadOther}
          </Button>
        </Box>
      </Box>

      <ConfirmDialog
        open={dialogOpen}
        title={texts.dialogTitle}
        text={dialogText(preview)}
        confirmLabel={texts.dialogConfirm}
        busy={commit.isPending}
        onConfirm={() => {
          if (sending.current) return;
          sending.current = true;
          commit.mutate(preview.batchId);
        }}
        onClose={() => setDialogOpen(false)}
      >
        {preview.newDepartments.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography>{texts.dialogNewDepartments}</Typography>
            <Box component="ul" sx={{ m: 0, paddingInlineStart: 3 }}>
              {preview.newDepartments.map((d) => (
                <li key={d.code}>{formatDepartment(d.code, d.name)}</li>
              ))}
            </Box>
          </Box>
        )}
        {preview.renamedDepartments.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography>{texts.dialogRenamedDepartments}</Typography>
            <Box component="ul" sx={{ m: 0, paddingInlineStart: 3 }}>
              {preview.renamedDepartments.map((d) => (
                <li key={d.code}>
                  <bdi>{formatDepartment(d.code, d.from)}</bdi>
                  {` ${texts.arrow} `}
                  <bdi>{formatDepartment(d.code, d.to)}</bdi>
                </li>
              ))}
            </Box>
          </Box>
        )}
        <Typography sx={{ mt: 2, fontWeight: tokens.font.weight.medium }}>
          {texts.nothingSent}
        </Typography>
      </ConfirmDialog>
    </Box>
  );
}
