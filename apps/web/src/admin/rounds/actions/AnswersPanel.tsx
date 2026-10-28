import {
  type AssignmentResponses,
  type AssignmentRow,
  RETURN_NOTE_MAX_LENGTH,
  returnBodySchema,
} from '@doc-signing/shared';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { ConfirmDialog } from '../../../components/dialogs/ConfirmDialog';
import { errorContent } from '../../../components/feedback/error-content';
import { ErrorState } from '../../../components/feedback/ErrorState';
import { PageLoader } from '../../../components/feedback/PageLoader';
import { ToneChip } from '../../../components/status/StatusChip';
import { he } from '../../../i18n/he';
import { answersKeys, approveAssignment, fetchResponses, returnAssignment } from './actions.api';
import { answerText, canSendAgain, drawingsExpireAt, returnedText } from './row-actions';
import { SendAgainButton } from './SendAgainButton';
import { useAction } from './use-action';

const text = he.rounds.actions;
const panel = text.panel;

/**
 * Fetches the answers again when the drawings' short-lived links expire, so the images keep
 * showing while the panel is open; in a hidden tab, once it is visible again.
 */
function useDrawingRefresh(expiresAt: number | null, refetch: () => unknown) {
  useEffect(() => {
    if (expiresAt === null) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisible);
      refetch();
    };
    const timer = window.setTimeout(
      () => {
        document.addEventListener('visibilitychange', onVisible);
        onVisible();
      },
      Math.max(0, expiresAt - Date.now()),
    );
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [expiresAt, refetch]);
}

function Answers({ data }: { data: AssignmentResponses }) {
  if (data.answers.length === 0 && data.emailAnswer === null) {
    return <Typography color="text.secondary">{panel.empty}</Typography>;
  }
  return (
    <Box component="dl" sx={{ m: 0, display: 'grid', gap: 1.5 }}>
      {data.answers.map((answer) => (
        <Box key={answer.key}>
          <Typography component="dt" sx={{ fontWeight: 700 }}>
            <bdi>{answer.label}</bdi>
            {answer.needsApproval && (
              <Box component="span" sx={{ marginInlineStart: 1 }}>
                <ToneChip label={panel.needsApproval} tone="warning" icon={ErrorOutlineOutlined} />
              </Box>
            )}
          </Typography>
          <Typography component="dd" sx={{ m: 0, whiteSpace: 'pre-line' }}>
            {answer.drawing ? (
              <Box
                component="img"
                src={answer.drawing.url}
                alt={panel.drawingAlt(answer.label)}
                sx={{ maxWidth: '100%', maxHeight: 120, border: 1, borderColor: 'divider' }}
              />
            ) : (
              <bdi>{answerText(answer)}</bdi>
            )}
          </Typography>
        </Box>
      ))}
      {data.emailAnswer && (
        <Box>
          <Typography component="dt" sx={{ fontWeight: 700 }}>
            {panel.emailTitle}
          </Typography>
          <Typography component="dd" sx={{ m: 0 }}>
            {data.emailAnswer.choiceLabel}
            {data.emailAnswer.email !== null && (
              <>
                {': '}
                <bdi dir="ltr">{data.emailAnswer.email}</bdi>
              </>
            )}
          </Typography>
          {data.emailAnswer.differsFromStored && (
            <ToneChip
              label={he.rounds.table.emailDiffers}
              tone="warning"
              icon={ErrorOutlineOutlined}
            />
          )}
        </Box>
      )}
    </Box>
  );
}

/** Approve / return for correction of an answer waiting for approval (managers). */
function ApprovalButtons({ assignmentId }: { assignmentId: string }) {
  const queryClient = useQueryClient();
  const noteId = useId();
  const [confirming, setConfirming] = useState<'approve' | 'return' | null>(null);
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  const noteValid = returnBodySchema.safeParse({ note }).success;

  const confirm = async () => {
    if (confirming === 'approve') {
      await run(() => approveAssignment(assignmentId), {
        employees: true,
        done: () => text.approve.done,
      });
    } else if (confirming === 'return' && noteValid) {
      await run(() => returnAssignment(assignmentId, note.trim()), {
        employees: true,
        done: () => text.returnForCorrection.done,
      });
    }
    setConfirming(null);
    // The answer's state changed (approved, returned with its note): one more view.
    void queryClient.invalidateQueries({ queryKey: answersKeys.one(assignmentId) });
  };

  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Button variant="contained" onClick={() => setConfirming('approve')} disabled={busy}>
          {text.approve.label}
        </Button>
        <Button
          variant="outlined"
          color="error"
          onClick={() => {
            setNote('');
            setConfirming('return');
          }}
          disabled={busy}
        >
          {text.returnForCorrection.label}
        </Button>
      </Box>
      <ConfirmDialog
        open={confirming === 'approve'}
        title={text.approve.title}
        text={text.approve.text}
        confirmLabel={text.approve.label}
        cancelLabel={text.keep}
        busy={busy}
        onConfirm={() => void confirm()}
        onClose={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === 'return'}
        title={text.returnForCorrection.label}
        text={text.returnForCorrection.text}
        confirmLabel={text.returnForCorrection.label}
        cancelLabel={text.keep}
        danger
        busy={busy}
        confirmDisabled={!noteValid}
        onConfirm={() => void confirm()}
        onClose={() => setConfirming(null)}
      >
        <TextField
          id={noteId}
          label={text.returnForCorrection.note}
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, RETURN_NOTE_MAX_LENGTH))}
          required
          multiline
          minRows={3}
          fullWidth
          sx={{ mt: 2 }}
          helperText={text.returnForCorrection.noteHelp(note.length, RETURN_NOTE_MAX_LENGTH)}
          slotProps={{ htmlInput: { maxLength: RETURN_NOTE_MAX_LENGTH } }}
        />
      </ConfirmDialog>
    </>
  );
}

function ApprovalState({
  data,
  row,
  isManager,
}: {
  data: AssignmentResponses;
  row: AssignmentRow;
  isManager: boolean;
}) {
  if (data.returnedAt !== null) {
    const correctionRound = row.returned?.correctionRound ?? null;
    return (
      <Alert severity="warning" sx={{ '& .MuiAlert-message': { width: '100%' } }}>
        <Typography sx={{ fontWeight: 700 }}>{returnedText(data.returnedAt)}</Typography>
        {data.returnNote !== null && (
          <>
            <Typography sx={{ mt: 1 }}>{panel.returnNote}</Typography>
            {/* The manager's note: plain React text, never HTML; its line breaks kept. */}
            <Typography sx={{ whiteSpace: 'pre-line' }}>{data.returnNote}</Typography>
          </>
        )}
        <Box sx={{ mt: 1 }}>
          {correctionRound ? (
            <Typography variant="body2">
              {he.rounds.table.sentAgainIn}{' '}
              <Link component={RouterLink} to={`/rounds/${correctionRound.id}`}>
                <bdi>{correctionRound.name}</bdi>
              </Link>
            </Typography>
          ) : (
            isManager && canSendAgain(row) && <SendAgainButton assignmentId={row.assignmentId} />
          )}
        </Box>
      </Alert>
    );
  }
  if (data.approval === 'approved') return <Alert severity="success">{panel.approved}</Alert>;
  if (data.approval === 'waiting') {
    return (
      <Alert severity="info" sx={{ '& .MuiAlert-message': { width: '100%' } }}>
        <Typography sx={{ mb: isManager ? 1 : 0 }}>{panel.waiting}</Typography>
        {isManager && <ApprovalButtons assignmentId={row.assignmentId} />}
      </Alert>
    );
  }
  return null;
}

function PanelBody({ row, isManager }: { row: AssignmentRow; isManager: boolean }) {
  const answers = useQuery({
    queryKey: answersKeys.one(row.assignmentId),
    queryFn: ({ signal }) => fetchResponses(row.assignmentId, signal),
    // Every fetch is an audit row: fetched on opening, after this panel's own actions and when
    // the drawing links expire. Never on focus, never by a round action (its own key).
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const { refetch } = answers;
  useDrawingRefresh(answers.data ? drawingsExpireAt(answers.data.answers) : null, refetch);

  if (answers.isPending) return <PageLoader />;
  if (!answers.data) {
    return (
      <ErrorState
        {...errorContent(answers.error)}
        headingComponent="h3"
        onRetry={() => void refetch()}
      />
    );
  }
  return (
    <>
      <ApprovalState data={answers.data} row={row} isManager={isManager} />
      <Answers data={answers.data} />
    </>
  );
}

/**
 * The answers of one row (A4, FR-TRK-2, FR-TRK-6): labels and values in the template's order,
 * drawings as images, the email section; the approval state with approve / return / send again
 * for managers (officers see the same panel without buttons). Fetched only on opening.
 */
export function AnswersPanel({
  row,
  isManager,
  onClose,
}: {
  row: AssignmentRow | null;
  isManager: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  return (
    <Drawer
      anchor="left"
      open={row !== null}
      onClose={onClose}
      slotProps={{ paper: { 'aria-labelledby': titleId, sx: { width: { xs: '100%', sm: 440 } } } }}
    >
      {row && (
        <Box sx={{ p: 3, display: 'grid', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h2" id={titleId} sx={{ flex: 1 }}>
              <bdi>{text.answersFor(`${row.firstName} ${row.lastName}`)}</bdi>
            </Typography>
            <IconButton aria-label={panel.close} onClick={onClose}>
              <CloseOutlined />
            </IconButton>
          </Box>
          <PanelBody key={row.assignmentId} row={row} isManager={isManager} />
        </Box>
      )}
    </Drawer>
  );
}
