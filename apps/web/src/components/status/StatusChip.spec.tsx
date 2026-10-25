import {
  DISPLAY_STATUSES,
  ROUND_STATUS_LABELS,
  ROUND_STATUSES,
  STATUS_LABELS,
} from '@doc-signing/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderComponent } from '../../test/render';
import { DISPLAY_STATUS_LOOKS, TONE_STYLES } from './status-tones';
import { RoundStatusChip, StatusChip } from './StatusChip';

describe('StatusChip', () => {
  it.each(DISPLAY_STATUSES)('shows %s with its shared Hebrew label and an icon', (status) => {
    renderComponent(<StatusChip status={status} />);
    const chip = screen.getByText(STATUS_LABELS[status]);
    expect(chip).toHaveAttribute('data-tone', DISPLAY_STATUS_LOOKS[status].tone);
    // The icon is decoration: the label carries the meaning, not the color.
    const icon = chip.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows the flag it is given (locked) and not the stored status', () => {
    renderComponent(<StatusChip status="locked" />);
    expect(screen.getByText(STATUS_LABELS.locked)).toBeInTheDocument();
    expect(screen.queryByText(STATUS_LABELS.sent)).not.toBeInTheDocument();
  });

  it('is not a button and not focusable', () => {
    renderComponent(<StatusChip status="signed" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(STATUS_LABELS.signed)).not.toHaveAttribute('tabindex');
  });

  it('neutral chips have a dashed border, the others a solid one', () => {
    for (const [tone, style] of Object.entries(TONE_STYLES)) {
      expect(style.borderStyle, tone).toBe(tone === 'neutral' ? 'dashed' : 'solid');
    }
  });
});

describe('RoundStatusChip', () => {
  it.each(ROUND_STATUSES)('shows the round status %s with its shared label', (status) => {
    renderComponent(<RoundStatusChip status={status} />);
    expect(screen.getByText(ROUND_STATUS_LABELS[status])).toBeInTheDocument();
  });
});
