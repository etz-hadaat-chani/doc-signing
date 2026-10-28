import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { PageLoader } from '../../../components/feedback/PageLoader';
import { he } from '../../../i18n/he';
import { fetchInvitationPreview, templateKeys } from '../../templates/templates.api';

const texts = he.newRound.preview;

/**
 * The invitation as the employee would get it (Flow 3 step 6): a made-up name and a placeholder
 * link, no address. The HTML is shown in a sandboxed frame from `srcDoc` (no scripts, no requests
 * of its own) that ignores the pointer, so its link can't be followed.
 */
export function EmailPreview({
  templateId,
  linkExpiryDays,
}: {
  templateId: string;
  linkExpiryDays: number;
}) {
  const email = useQuery({
    queryKey: templateKeys.invitationPreview(templateId, linkExpiryDays),
    queryFn: ({ signal }) => fetchInvitationPreview(templateId, linkExpiryDays, signal),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  let content;
  if (email.isError) {
    content = <Alert severity="error">{texts.emailFailed}</Alert>;
  } else if (!email.data) {
    content = <PageLoader />;
  } else {
    content = (
      <>
        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1 }}>
          <Typography component="dt" sx={{ fontWeight: 700 }}>
            {texts.emailFrom}
          </Typography>
          <Typography component="dd" sx={{ m: 0 }}>
            <bdi>{email.data.senderName}</bdi>
          </Typography>
          <Typography component="dt" sx={{ fontWeight: 700 }}>
            {texts.emailSubject}
          </Typography>
          <Typography component="dd" sx={{ m: 0 }} data-testid="email-subject">
            <bdi>{email.data.subject}</bdi>
          </Typography>
        </Box>
        <Box
          component="iframe"
          title={texts.emailFrameTitle}
          sandbox=""
          srcDoc={email.data.html}
          tabIndex={-1}
          sx={{
            width: '100%',
            maxWidth: 720,
            height: 560,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'common.white',
            pointerEvents: 'none',
          }}
        />
      </>
    );
  }

  return (
    <Box component="section" aria-labelledby="round-email-title" sx={{ display: 'grid', gap: 2 }}>
      <Typography variant="h3" id="round-email-title">
        {texts.emailTitle}
      </Typography>
      <Typography color="text.secondary">{texts.emailIntro}</Typography>
      {content}
    </Box>
  );
}
