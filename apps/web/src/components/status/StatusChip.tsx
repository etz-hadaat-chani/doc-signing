import {
  type DisplayStatus,
  ROUND_STATUS_LABELS,
  type RoundStatus,
  STATUS_LABELS,
} from '@doc-signing/shared';
import Box from '@mui/material/Box';
import type SvgIcon from '@mui/material/SvgIcon';
import { tokens } from '../../theme/tokens';
import { DISPLAY_STATUS_LOOKS, ROUND_STATUS_LOOKS, TONE_STYLES, type Tone } from './status-tones';

const { font, radius } = tokens;

/** A label with a tone and an icon: the one chip look (statuses, email status, …). */
export function ToneChip({
  label,
  tone,
  icon: Icon,
}: {
  label: string;
  tone: Tone;
  icon: typeof SvgIcon;
}) {
  const style = TONE_STYLES[tone];
  return (
    <Box
      component="span"
      data-tone={tone}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.25,
        border: `1px ${style.borderStyle} ${style.border}`,
        borderRadius: `${radius.control}px`,
        backgroundColor: style.background,
        color: style.color,
        fontSize: font.size.small,
        fontWeight: font.weight.semibold,
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
      }}
    >
      <Icon aria-hidden sx={{ fontSize: font.size.body }} />
      {label}
    </Box>
  );
}

/**
 * An assignment's status as the API reports it: the value of `displayStatus()` (locked, expired
 * and the other flags are already in it). Shows it, never works it out.
 */
export function StatusChip({ status }: { status: DisplayStatus }) {
  const look = DISPLAY_STATUS_LOOKS[status];
  return <ToneChip label={STATUS_LABELS[status]} tone={look.tone} icon={look.icon} />;
}

/** A send round's status (A3). */
export function RoundStatusChip({ status }: { status: RoundStatus }) {
  const look = ROUND_STATUS_LOOKS[status];
  return <ToneChip label={ROUND_STATUS_LABELS[status]} tone={look.tone} icon={look.icon} />;
}
