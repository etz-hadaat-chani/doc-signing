import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { formatNumber } from '../../i18n/format';
import { he } from '../../i18n/he';
import type { SendOutcome } from './new/send-flow';
import { reasonTexts } from './new/summary-view';

const texts = he.newRound.send;

/**
 * What a failed send of a draft shows (3.10): the outdated templates with "send the round's
 * version", or the draft kept with retry / cancel. Used by the wizard's last step and by a
 * draft's round details (A4).
 */

export function OutdatedPanel({
  outcome,
  busy,
  onSend,
  onStop,
}: {
  outcome: Extract<SendOutcome, { kind: 'outdated' }>;
  busy: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  return (
    <Alert severity="warning" role="alert" data-testid="round-outdated">
      <AlertTitle>{texts.outdatedTitle}</AlertTitle>
      <Typography sx={{ mb: 1 }}>{texts.outdatedText}</Typography>
      <Box component="ul" sx={{ m: 0, mb: 2, paddingInlineStart: 3 }}>
        {outcome.templates.map((template) => (
          <li key={template.id}>
            {texts.outdatedLine(
              template.name,
              template.version,
              texts.outdatedReasons[template.reason](template.newestVersion),
              template.assignmentCount,
              formatNumber(template.assignmentCount),
            )}
          </li>
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Button variant="contained" color="warning" onClick={onSend} disabled={busy}>
          {busy ? texts.sending : texts.sendOutdated}
        </Button>
        <Button variant="outlined" color="inherit" onClick={onStop} disabled={busy}>
          {texts.stop}
        </Button>
      </Box>
    </Alert>
  );
}

export function DraftPanel({
  outcome,
  busy,
  onRetry,
  onCancel,
}: {
  outcome: Extract<SendOutcome, { kind: 'draft' }>;
  busy: boolean;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <Alert severity="error" role="alert" data-testid="round-draft">
      <AlertTitle>{texts.draftTitle}</AlertTitle>
      <Typography sx={{ mb: 1 }}>{outcome.message}</Typography>
      {outcome.templates.length > 0 && (
        <>
          <Typography sx={{ fontWeight: 700 }}>{texts.notReadyTitle}</Typography>
          <Box component="ul" sx={{ m: 0, mb: 1, paddingInlineStart: 3 }}>
            {outcome.templates.map((template) => (
              <li key={template.id}>
                {he.newRound.summary.templateName(template.name, template.version)}
                <Box component="ul" sx={{ m: 0, paddingInlineStart: 3 }}>
                  {reasonTexts(template.reasons).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </Box>
              </li>
            ))}
          </Box>
        </>
      )}
      <Typography sx={{ mb: 2 }}>{texts.draftText}</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Button variant="contained" onClick={onRetry} disabled={busy}>
          {busy ? texts.sending : texts.retry}
        </Button>
        <Button variant="outlined" color="error" onClick={onCancel} disabled={busy}>
          {texts.cancelDraft}
        </Button>
      </Box>
    </Alert>
  );
}
