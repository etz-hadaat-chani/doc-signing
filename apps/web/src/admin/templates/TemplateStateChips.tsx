import type { TemplateItem } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import { ToneChip } from '../../components/status/StatusChip';
import { TEMPLATE_LOCKED_LOOK, TEMPLATE_STATE_LOOKS } from '../../components/status/status-tones';
import { he } from '../../i18n/he';
import { templateState } from './template-view';

type ChipItem = Pick<TemplateItem, 'isArchived' | 'isLatest' | 'isReady' | 'isLocked'>;

/** The version's state, plus "locked" when a round uses it (label and icon, never color alone). */
export function TemplateStateChips({ item }: { item: ChipItem }) {
  const state = templateState(item);
  const look = TEMPLATE_STATE_LOOKS[state];
  return (
    <Box component="span" sx={{ display: 'inline-flex', flexWrap: 'wrap', gap: 1 }}>
      <ToneChip label={he.templates.status[state]} tone={look.tone} icon={look.icon} />
      {item.isLocked && (
        <ToneChip
          label={he.templates.status.locked}
          tone={TEMPLATE_LOCKED_LOOK.tone}
          icon={TEMPLATE_LOCKED_LOOK.icon}
        />
      )}
    </Box>
  );
}
