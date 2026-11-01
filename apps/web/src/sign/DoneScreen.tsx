import type { SignHrContact } from '@doc-signing/shared';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { type ReactNode, useEffect } from 'react';
import { he } from '../i18n/he';
import { tokens } from '../theme/tokens';
import { HrContact } from './HrContact';

const text = he.sign.done;

interface DoneScreenProps {
  /**
   * Where the signed copy goes: `link` (the address the link was sent to, FR-SGN-6), `kiosk`
   * (the address she confirmed, or none for "office", FR-MAN-4), or `none` when the document
   * was found already signed (a scan sends no copy, so none is promised).
   */
  copy: 'link' | 'kiosk' | 'none';
  hrContact: SignHrContact | null;
  /** A button under the text (the office computer's "a new code"). */
  action?: ReactNode;
}

/**
 * B4 (FR-SGN-7, Flow 4 step 6): the document was signed, where its copy goes, whom to ask. No
 * answer, address or name of hers is shown: by now they are dropped from memory. Shown from the
 * top (she pressed "סיום וחתימה" at the bottom of the form).
 */
export function DoneScreen({ copy, hrContact, action }: DoneScreenProps) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return (
    <Box role="status" sx={{ textAlign: 'center' }}>
      <CheckCircleOutlined aria-hidden sx={{ fontSize: 56, color: tokens.color.success, mb: 1 }} />
      <Typography variant="h1" sx={{ mb: 2 }}>
        {text.title}
      </Typography>
      <Typography>{text.saved}</Typography>
      {copy !== 'none' && (
        <Typography sx={{ mt: 2 }}>{copy === 'link' ? text.linkCopy : text.kioskCopy}</Typography>
      )}
      {hrContact && (
        <Box sx={{ textAlign: 'start' }}>
          <HrContact contact={hrContact} />
        </Box>
      )}
      {action && <Box sx={{ mt: 4 }}>{action}</Box>}
    </Box>
  );
}
