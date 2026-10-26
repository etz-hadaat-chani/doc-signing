import type { DisplayStatus, EmailStatus, RoundStatus } from '@doc-signing/shared';
import BlockOutlined from '@mui/icons-material/BlockOutlined';
import CancelScheduleSendOutlined from '@mui/icons-material/CancelScheduleSendOutlined';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import DraftsOutlined from '@mui/icons-material/DraftsOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import EventBusyOutlined from '@mui/icons-material/EventBusyOutlined';
import HistoryEduOutlined from '@mui/icons-material/HistoryEduOutlined';
import HourglassEmptyOutlined from '@mui/icons-material/HourglassEmptyOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import MarkEmailReadOutlined from '@mui/icons-material/MarkEmailReadOutlined';
import OutboxOutlined from '@mui/icons-material/OutboxOutlined';
import PersonOffOutlined from '@mui/icons-material/PersonOffOutlined';
import PlayCircleOutlined from '@mui/icons-material/PlayCircleOutlined';
import ReplyOutlined from '@mui/icons-material/ReplyOutlined';
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import TaskAltOutlined from '@mui/icons-material/TaskAltOutlined';
import UndoOutlined from '@mui/icons-material/UndoOutlined';
import UnsubscribeOutlined from '@mui/icons-material/UnsubscribeOutlined';
import type SvgIcon from '@mui/material/SvgIcon';
import { tokens } from '../../theme/tokens';

/** The color family of a chip: done, in progress, needs a look, needs handling, or neither. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

interface ToneStyle {
  color: string;
  background: string;
  border: string;
  /** Neutral chips have a dashed border, so they differ from the others without color too. */
  borderStyle: 'solid' | 'dashed';
}

const { color } = tokens;

export const TONE_STYLES: Readonly<Record<Tone, ToneStyle>> = {
  neutral: {
    color: color.textSecondary,
    background: color.neutralTint,
    border: color.borderStrong,
    borderStyle: 'dashed',
  },
  info: { color: color.info, background: color.infoTint, border: color.info, borderStyle: 'solid' },
  success: {
    color: color.success,
    background: color.successTint,
    border: color.success,
    borderStyle: 'solid',
  },
  warning: {
    color: color.warning,
    background: color.warningTint,
    border: color.warning,
    borderStyle: 'solid',
  },
  error: {
    color: color.error,
    background: color.errorTint,
    border: color.error,
    borderStyle: 'solid',
  },
};

export interface StatusLook {
  tone: Tone;
  icon: typeof SvgIcon;
}

/** One entry per display value: a new status fails typecheck until it gets a look here. */
export const DISPLAY_STATUS_LOOKS: Readonly<Record<DisplayStatus, StatusLook>> = {
  pending: { tone: 'neutral', icon: ScheduleOutlined },
  send_failed: { tone: 'error', icon: ErrorOutlineOutlined },
  sent: { tone: 'info', icon: SendOutlined },
  opened: { tone: 'info', icon: DraftsOutlined },
  signed: { tone: 'success', icon: TaskAltOutlined },
  waiting_for_approval: { tone: 'warning', icon: HourglassEmptyOutlined },
  signed_manual: { tone: 'success', icon: HistoryEduOutlined },
  delivered: { tone: 'success', icon: MarkEmailReadOutlined },
  missing_data: { tone: 'warning', icon: ReportProblemOutlined },
  no_email: { tone: 'error', icon: UnsubscribeOutlined },
  invalid_email: { tone: 'error', icon: CancelScheduleSendOutlined },
  cancelled: { tone: 'neutral', icon: BlockOutlined },
  returned_for_correction: { tone: 'warning', icon: UndoOutlined },
  locked: { tone: 'error', icon: LockOutlined },
  expired: { tone: 'warning', icon: EventBusyOutlined },
};

export const ROUND_STATUS_LOOKS: Readonly<Record<RoundStatus, StatusLook>> = {
  draft: { tone: 'warning', icon: EditOutlined },
  sending: { tone: 'info', icon: OutboxOutlined },
  active: { tone: 'success', icon: PlayCircleOutlined },
  closed: { tone: 'neutral', icon: CheckCircleOutlined },
  cancelled: { tone: 'neutral', icon: BlockOutlined },
};

/** An employee's email status (A6, A7): only a valid address can get documents by email. */
export const EMAIL_STATUS_LOOKS: Readonly<Record<EmailStatus, StatusLook>> = {
  valid: { tone: 'success', icon: MarkEmailReadOutlined },
  missing: { tone: 'error', icon: UnsubscribeOutlined },
  invalid: { tone: 'error', icon: CancelScheduleSendOutlined },
  bounced: { tone: 'error', icon: ReplyOutlined },
};

/** An inactive employee (A6, A7): neutral, never picked into a new round. */
export const INACTIVE_LOOK: StatusLook = { tone: 'neutral', icon: PersonOffOutlined };
