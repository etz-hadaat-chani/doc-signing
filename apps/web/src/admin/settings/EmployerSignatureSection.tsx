import {
  EMPLOYER_SIGNATURE_MAX_BYTES,
  EMPLOYER_SIGNATURE_MAX_PIXELS,
  EMPLOYER_SIGNATURE_MIN_PIXELS,
  type EmployerSignatureSummary,
  formatDate,
  formatTime,
} from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { errorContent } from '../../components/feedback/error-content';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog';
import { useNotify } from '../../components/notifications/notify-context';
import { formatFileSize } from '../../components/upload/file-checks';
import { FileDropZone } from '../../components/upload/FileDropZone';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { fetchEmployerSignatureLink, settingsKeys, uploadEmployerSignature } from './settings.api';

const text = he.settings.employerSignature;
const ACCEPT = { extensions: ['.png'], label: text.accept };
/** Ask for a new link a little before the old one stops working. */
const LINK_MARGIN_MS = 30_000;
const LINK_LIFETIME_MS = 5 * 60_000;

/**
 * The employer signature and stamp image (FR-ADM-2, FR-TPL-7). The current image is asked for
 * only on "show": each link is a logged view, so no request on load, on window focus or on a
 * save of the form, and a link is reused until it expires. A new image applies only to documents
 * sent from now on (3.18 note: sent documents keep the image saved with them).
 */
export function EmployerSignatureSection({
  summary,
}: {
  summary: EmployerSignatureSummary | null;
}) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [shown, setShown] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // A second click before the answer must not upload twice.
  const sending = useRef(false);

  const link = useQuery({
    queryKey: settingsKeys.employerSignature,
    queryFn: ({ signal }) => fetchEmployerSignatureLink(signal),
    enabled: shown && summary !== null,
    staleTime: (query) => {
      const expiresAt = query.state.data?.expiresAt;
      return expiresAt ? Math.max(0, Date.parse(expiresAt) - Date.now() - LINK_MARGIN_MS) : 0;
    },
    gcTime: LINK_LIFETIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const upload = useMutation({ mutationFn: uploadEmployerSignature });

  const runUpload = async () => {
    if (sending.current || !file) return;
    sending.current = true;
    try {
      await upload.mutateAsync(file);
      setFile(null);
      setConfirming(false);
      // The old link shows the old image: drop it; "show" asks for the new one.
      setShown(false);
      queryClient.removeQueries({ queryKey: settingsKeys.employerSignature });
      await queryClient.invalidateQueries({ queryKey: settingsKeys.all, exact: true });
      notify.success(text.uploaded);
    } catch (error) {
      setConfirming(false);
      setUploadError(errorContent(error).message);
    } finally {
      sending.current = false;
    }
  };

  return (
    <Paper
      component="section"
      aria-labelledby="settings-employer-signature"
      variant="outlined"
      sx={{ p: 3, display: 'grid', gap: 2 }}
    >
      <Typography id="settings-employer-signature" component="h2" variant="h3">
        {text.title}
      </Typography>
      <Typography color="text.secondary">{text.intro}</Typography>

      {summary === null ? (
        <Typography>{text.none}</Typography>
      ) : (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <Typography>
            {text.current(formatDate(summary.uploadedAt), formatTime(summary.uploadedAt))}{' '}
            {text.size}{' '}
            <bdi dir="ltr">
              {summary.width}×{summary.height}
            </bdi>
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Button variant="outlined" onClick={() => setShown((current) => !current)}>
              {shown ? text.hide : text.show}
            </Button>
            <Typography variant="body2" color="text.secondary">
              {text.viewLogged}
            </Typography>
          </Box>
          {shown && link.isPending && (
            <CircularProgress size={24} aria-label={he.feedback.loading} />
          )}
          {shown && link.isError && (
            <Alert severity="error" role="alert">
              <AlertTitle>{text.showFailed}</AlertTitle>
              {errorContent(link.error).message}
            </Alert>
          )}
          {shown && link.data && (
            <Box
              sx={{
                justifySelf: 'start',
                p: 2,
                border: `1px solid ${tokens.color.border}`,
                borderRadius: `${tokens.radius.control}px`,
                bgcolor: tokens.color.surface,
              }}
            >
              <Box
                component="img"
                src={link.data.url}
                alt={text.imageAlt}
                referrerPolicy="no-referrer"
                sx={{ display: 'block', maxWidth: '100%', maxHeight: 240 }}
              />
            </Box>
          )}
        </Box>
      )}

      <Typography component="h3" variant="body1" sx={{ fontWeight: 'medium', mt: 1 }}>
        {text.uploadTitle}
      </Typography>
      <Typography color="text.secondary">
        {text.requirements(
          formatFileSize(EMPLOYER_SIGNATURE_MAX_BYTES),
          EMPLOYER_SIGNATURE_MIN_PIXELS,
          EMPLOYER_SIGNATURE_MAX_PIXELS,
        )}
      </Typography>
      <Alert severity="info" role="note">
        {text.newOnly}
      </Alert>
      <FileDropZone
        accept={ACCEPT}
        maxBytes={EMPLOYER_SIGNATURE_MAX_BYTES}
        file={file}
        onFileChange={(next) => {
          setFile(next);
          setUploadError(null);
        }}
        disabled={upload.isPending}
      />
      {uploadError !== null && (
        <Alert severity="error" role="alert">
          <AlertTitle>{text.failed}</AlertTitle>
          {uploadError}
        </Alert>
      )}
      <Box>
        <Button
          variant="contained"
          disabled={file === null || upload.isPending}
          onClick={() => setConfirming(true)}
        >
          {text.upload}
        </Button>
      </Box>
      <ConfirmDialog
        open={confirming}
        title={text.confirmTitle}
        text={text.newOnly}
        confirmLabel={text.confirm}
        busy={upload.isPending}
        onConfirm={() => void runUpload()}
        onClose={() => setConfirming(false)}
      />
    </Paper>
  );
}
