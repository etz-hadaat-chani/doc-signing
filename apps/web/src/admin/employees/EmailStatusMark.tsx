import type { EmailStatus } from '@doc-signing/shared';
import { ToneChip } from '../../components/status/StatusChip';
import { EMAIL_STATUS_LOOKS, INACTIVE_LOOK } from '../../components/status/status-tones';
import { he } from '../../i18n/he';
import { emailStatusLabel } from './email-status';

/** An employee's email status: color, icon and text, never the address itself. */
export function EmailStatusMark({ status }: { status: EmailStatus }) {
  const look = EMAIL_STATUS_LOOKS[status];
  return <ToneChip label={emailStatusLabel(status)} tone={look.tone} icon={look.icon} />;
}

/** "פעיל" as plain text; "לא פעיל" as a neutral chip, so it stands out in a long list. */
export function ActiveMark({ isActive }: { isActive: boolean }) {
  if (isActive) return <>{he.employees.active}</>;
  return (
    <ToneChip label={he.employees.inactive} tone={INACTIVE_LOOK.tone} icon={INACTIVE_LOOK.icon} />
  );
}
