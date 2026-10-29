import type { SignHrContact } from '@doc-signing/shared';
import BlockOutlined from '@mui/icons-material/BlockOutlined';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import EventBusyOutlined from '@mui/icons-material/EventBusyOutlined';
import LinkOffOutlined from '@mui/icons-material/LinkOffOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import Box from '@mui/material/Box';
import type SvgIcon from '@mui/material/SvgIcon';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { he } from '../i18n/he';
import { tokens } from '../theme/tokens';
import { HrContact } from './HrContact';

/** Every message screen (B5) of a link and of the office computer. */
export type SignMessageKind = keyof typeof he.sign.messages;

const ICONS: Record<SignMessageKind, typeof SvgIcon> = {
  signed: CheckCircleOutlined,
  cancelled: BlockOutlined,
  expired: EventBusyOutlined,
  locked: LockOutlined,
  notFound: LinkOffOutlined,
  kioskExpired: EventBusyOutlined,
  kioskLocked: LockOutlined,
  kioskCodeGone: LinkOffOutlined,
};

interface MessagePageProps {
  kind: SignMessageKind;
  /** Whom to ask; null when the API gave none (an unknown link). */
  hrContact: SignHrContact | null;
  /** A button under the text (the office computer's "another code"). */
  action?: ReactNode;
}

/**
 * B5 (FR-SGN-7): one clear title, one or two short lines and the HR contact. "Already signed"
 * is good news, so it has the success color; the others are calm, not error red.
 */
export function MessagePage({ kind, hrContact, action }: MessagePageProps) {
  const Icon = ICONS[kind];
  const message = he.sign.messages[kind];
  return (
    <Box role="status" sx={{ textAlign: 'center' }}>
      <Icon
        aria-hidden
        sx={{
          fontSize: 56,
          color: kind === 'signed' ? tokens.color.success : 'text.secondary',
          mb: 1,
        }}
      />
      <Typography variant="h1" sx={{ mb: 2 }}>
        {message.title}
      </Typography>
      <Typography>{message.text}</Typography>
      {hrContact && (
        <Box sx={{ textAlign: 'start' }}>
          <HrContact contact={hrContact} />
        </Box>
      )}
      {action && <Box sx={{ mt: 4 }}>{action}</Box>}
    </Box>
  );
}
