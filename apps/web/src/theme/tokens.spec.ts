import { describe, expect, it } from 'vitest';
import { TONE_STYLES } from '../components/status/status-tones';
import { tokens } from './tokens';

/** WCAG 2 relative luminance of a #RRGGBB color. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const { color } = tokens;

describe('design tokens: text contrast (WCAG AA, 4.5:1)', () => {
  it.each([
    ['text on background', color.text, color.background],
    ['text on surface', color.text, color.surface],
    ['secondary text on background', color.textSecondary, color.background],
    ['secondary text on surface', color.textSecondary, color.surface],
    ['white on the brand button', color.surface, color.brand],
    ['white on the brand button (hover)', color.surface, color.brandHover],
    ['brand links on surface', color.brand, color.surface],
    ['brand active item on its hover tint', color.brand, color.brandTint],
    ['error text on surface', color.error, color.surface],
    ['error text on its tint', color.error, color.errorTint],
    ['warning text on surface', color.warning, color.surface],
    ['warning text on its tint', color.warning, color.warningTint],
    ['success text on surface', color.success, color.surface],
    ['success text on its tint', color.success, color.successTint],
    ['info text on surface', color.info, color.surface],
    ['info text on its tint', color.info, color.infoTint],
    ['secondary text on the neutral tint', color.textSecondary, color.neutralTint],
    ['text on the neutral tint', color.text, color.neutralTint],
    // 4.3: the warm background, the accent tint and the dark top bar.
    ['brand links on background', color.brand, color.background],
    ['error text on background', color.error, color.background],
    ['warning text on background', color.warning, color.background],
    ['success text on background', color.success, color.background],
    ['info text on background', color.info, color.background],
    ['text on the accent tint', color.text, color.accentTint],
    ['secondary text on the accent tint', color.textSecondary, color.accentTint],
    ['accent text on the accent tint', color.accentText, color.accentTint],
    ['text on the top bar', color.onTopBar, color.topBar],
    ['muted text on the top bar', color.onTopBarMuted, color.topBar],
    ['top bar text on its hover (brand)', color.onTopBar, color.brand],
  ])('%s', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('design tokens: lines, edges and focus rings (WCAG non-text, 3:1)', () => {
  it.each([
    ['accent edge on surface', color.accent, color.surface],
    ['accent bar on background', color.accent, color.background],
    ['accent bar on the active menu tint', color.accent, color.brandTint],
    ['accent edge on the accent tint', color.accent, color.accentTint],
    ['wordmark rule on the top bar', color.accentOnTopBar, color.topBar],
    ['focus ring on surface', color.brand, color.surface],
    ['focus ring on background', color.brand, color.background],
    ['focus ring on the menu tint', color.brand, color.brandTint],
    ['focus ring on the top bar', color.onTopBar, color.topBar],
  ])('%s', (_name, line, background) => {
    expect(contrast(line, background)).toBeGreaterThanOrEqual(3);
  });

  // Dashboard tiles (StatTiles) take their status tone color as the start edge.
  it.each(Object.entries(TONE_STYLES))('%s tile edge on surface', (_tone, style) => {
    expect(contrast(style.color, color.surface)).toBeGreaterThanOrEqual(3);
  });
});
