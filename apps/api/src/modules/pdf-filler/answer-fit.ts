import {
  employeeMayFill,
  type FieldValues,
  formatDayIL,
  type TemplateFieldInput,
} from '@doc-signing/shared';
import {
  fitBlock,
  fitLine,
  prepareText,
  type TextFont,
  textArea,
  textValueOf,
} from './pdf-text.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** How a box shows text the employee typed, or null when it shows none. */
function textKind(field: TemplateFieldInput, fieldValues: FieldValues): 'line' | 'block' | null {
  switch (field.fieldType) {
    case 'text':
    case 'select':
    case 'date_input':
    case 'email_input':
      return 'line';
    case 'long_text':
      return 'block';
    default:
      // A system value she may fill in, drawn only when the saved value is empty (3.7).
      return employeeMayFill(field) && textValueOf(field, fieldValues) === null ? 'line' : null;
  }
}

/**
 * The keys whose typed text would not fit its box even at the smallest font (FR-TPL-9), measured
 * with the same steps the signed PDF draws with (`drawTextLine` / `drawTextBlock` /
 * `drawDate`), so the signing screen's warning (3.13 `fit`) and the 400 `ANSWER_DOES_NOT_FIT` at
 * submit agree. Every position of a key counts, also one hidden by a condition now (she may still
 * change the answer it depends on). `answers` is keyed like the form (`email_input` = the email).
 * No PDF; the text is never logged.
 */
export function answerFitKeys(
  fields: readonly TemplateFieldInput[],
  fieldValues: FieldValues,
  answers: Readonly<Record<string, string>>,
  font: TextFont,
): string[] {
  const tooLong = new Set<string>();
  for (const field of fields) {
    const value = answers[field.key]?.trim();
    if (!value || tooLong.has(field.key)) continue;
    const kind = textKind(field, fieldValues);
    if (kind === null) continue;
    if (field.fieldType === 'date_input' && !DAY.test(value)) continue;
    // Drawn as the PDF draws it: a date as DD/MM/YYYY, the email lowercased.
    const shownText =
      field.fieldType === 'date_input'
        ? formatDayIL(value)
        : field.fieldType === 'email_input'
          ? value.toLowerCase()
          : value;
    const { text } = prepareText(shownText, font);
    const area = textArea(field);
    const fits =
      kind === 'block' ? !fitBlock(text, font, area).tooLong : !fitLine(text, font, area).tooLong;
    if (!fits) tooLong.add(field.key);
  }
  return [...tooLong];
}
