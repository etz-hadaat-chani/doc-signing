import { SYSTEM_VALUE_NAMES, type TemplateFieldSettings } from '@doc-signing/shared';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';

/** A list with this many options or fewer is shown as radio buttons; more → a drop-down. */
export const RADIO_MAX_CHOICES = 5;

/** Radio buttons and checkboxes: a 32 px mark and a whole row of at least 48 px to click. */
export const choiceSx = {
  minHeight: 48,
  marginInlineStart: 0,
  '& .MuiSvgIcon-root': { fontSize: 32 },
  '& .MuiFormControlLabel-label': { fontSize: tokens.sign.bodySize },
} as const;

/** The box's Hebrew label (a system value without one: its own name), "(לא חובה)" if optional. */
export function boxLabel(box: TemplateFieldSettings): string {
  const names: Record<string, string> = SYSTEM_VALUE_NAMES;
  const name = box.label ?? names[box.key] ?? box.key;
  return box.isRequired ? name : `${name} ${he.sign.form.optional}`;
}
