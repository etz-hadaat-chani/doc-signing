import fontkit from '@pdf-lib/fontkit';
import bidiModule from 'bidi-js';
import {
  type FieldValues,
  isSystemValueType,
  type TemplateFieldSettings,
} from '@doc-signing/shared';

// bidi-js is CommonJS: Node hands its factory over as the default import, while its type file
// declares it as an ES module's `default`. Same function either way.
const bidiFactory = bidiModule as unknown as typeof bidiModule.default;
const bidi = bidiFactory();

/** Text starts at this size and shrinks in steps down to the minimum (FR-TPL-9). */
export const TEXT_MAX_SIZE = 11;
export const TEXT_MIN_SIZE = 6;
const SIZE_STEP = 0.5;
/** Space kept between text and the left and right edges of its box. */
export const TEXT_PADDING = 2;
/** Lines of wrapped text are this many times the font size apart. */
const LINE_SPACING = 1.25;

/**
 * Hebrew punctuation the font may lack, and the plain character drawn instead. Heebo has all
 * three; the replacement only matters if the font is ever changed.
 */
const PUNCTUATION_FALLBACK: Readonly<Record<string, string>> = {
  '\u05F3': "'", // geresh ׳
  '\u05F4': '"', // gershayim ״
  '\u05BE': '-', // maqaf ־
};
/** Drawn for a character the font lacks (emoji, Arabic…): visible, never a crash. */
export const UNSUPPORTED_MARK = '?';

/**
 * Line breaks and tabs become spaces; other control characters and the invisible direction marks
 * (the drawing does its own bidi ordering) are dropped.
 */
// eslint-disable-next-line no-control-regex
const DROPPED = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * The embedded font, read once (NFR "PDF": the font is loaded once). Measures text without a PDF,
 * so a text check can run per recipient (3.8, 3.10); `bytes` is what each PDF embeds as a subset.
 */
export class TextFont {
  private readonly font: fontkit.Font;

  constructor(readonly bytes: Uint8Array) {
    this.font = fontkit.create(bytes);
  }

  hasChar(codePoint: number): boolean {
    return this.font.hasGlyphForCodePoint(codePoint);
  }

  /** Width in points of `text` drawn as one piece at `size`. */
  widthOf(text: string, size: number): number {
    return (this.font.layout(text).advanceWidth * size) / this.font.unitsPerEm;
  }

  /**
   * Whether the font's own shaping reverses this text. fontkit lays out a piece whose script is
   * right to left (Hebrew) in reverse, so such a piece is handed over reversed (`drawPieces`).
   */
  reverses(text: string): boolean {
    return this.font.layout(text).direction === 'rtl';
  }

  /** Height of a capital / Hebrew letter at `size`, for centring a line in its box. */
  capHeightAt(size: number): number {
    return (this.font.capHeight * size) / this.font.unitsPerEm;
  }

  /** How far below the baseline the lowest letters reach at `size` (positive). */
  descentAt(size: number): number {
    return (-this.font.descent * size) / this.font.unitsPerEm;
  }
}

export interface PreparedText {
  text: string;
  /** Some character was drawn as `?` because the font lacks it. */
  unsupported: boolean;
}

/** Cleans the text and replaces each character the font lacks (see the constants above). */
export function prepareText(text: string, font: TextFont): PreparedText {
  let unsupported = false;
  let result = '';
  for (const char of text.replace(/[\r\n\t]+/g, ' ').replace(DROPPED, '')) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (font.hasChar(codePoint)) {
      result += char;
      continue;
    }
    const fallback = PUNCTUATION_FALLBACK[char];
    if (fallback !== undefined && font.hasChar(fallback.codePointAt(0) ?? 0)) {
      result += fallback;
    } else {
      result += UNSUPPORTED_MARK;
      unsupported = true;
    }
  }
  return { text: result, unsupported };
}

/** One piece of a line in left-to-right drawing order, with what to hand to the font. */
export interface LinePiece {
  /** The piece as it should appear, left to right. */
  visual: string;
  /** The text to draw: `visual`, reversed when the font reverses it again. */
  draw: string;
  width: number;
}

export interface LaidOutLine {
  pieces: LinePiece[];
  width: number;
}

/**
 * Orders one line for drawing (NFR-HEB-3): Unicode bidi with a right-to-left paragraph, so Hebrew
 * reads right to left while numbers, phones, Latin names and emails keep their own left-to-right
 * order inside it; brackets in right-to-left parts are mirrored. Returns pieces of one direction
 * in left-to-right drawing order. Expects `prepareText` output.
 */
export function layoutLine(text: string, font: TextFont, size: number): LaidOutLine {
  if (text === '') return { pieces: [], width: 0 };
  // Characters outside the BMP are already `?` (the font has none), so indices are characters.
  const levels = bidi.getEmbeddingLevels(text, 'rtl');
  const mirrored = bidi.getMirroredCharactersMap(text, levels.levels);
  const order = bidi.getReorderedIndices(text, levels);

  const runs: string[] = [];
  let current = '';
  let currentLevel = -1;
  for (const index of order) {
    const level = levels.levels[index] ?? 0;
    if (level !== currentLevel && current !== '') {
      runs.push(current);
      current = '';
    }
    currentLevel = level;
    current += mirrored.get(index) ?? text[index] ?? '';
  }
  if (current !== '') runs.push(current);

  const pieces = runs.map((visual) => ({
    visual,
    draw: font.reverses(visual) ? [...visual].reverse().join('') : visual,
    width: font.widthOf(visual, size),
  }));
  return { pieces, width: pieces.reduce((sum, piece) => sum + piece.width, 0) };
}

/** The visual order of a line as one string (left to right); for tests and checks. */
export function visualOrder(text: string, font: TextFont): string {
  return layoutLine(prepareText(text, font).text, font, TEXT_MAX_SIZE)
    .pieces.map(({ visual }) => visual)
    .join('');
}

export interface BoxSize {
  width: number;
  height: number;
}

/** The room text has in a box: its width less the padding on both sides. */
export function textArea(box: BoxSize): BoxSize {
  return { width: Math.max(box.width - 2 * TEXT_PADDING, 1), height: box.height };
}

/** The largest size that fits the box height, at most TEXT_MAX_SIZE, never under the minimum. */
function startSize(font: TextFont, height: number, lines = 1): number {
  const unit = font.capHeightAt(1) + font.descentAt(1);
  const perLine = lines === 1 ? unit : LINE_SPACING;
  const bySize = height / (perLine * lines);
  return Math.max(TEXT_MIN_SIZE, Math.min(TEXT_MAX_SIZE, Math.floor(bySize / SIZE_STEP) * SIZE_STEP));
}

export interface FittedLine {
  line: LaidOutLine;
  size: number;
  /** Still wider than the box at the minimum size: drawn whole anyway, never cut. */
  tooLong: boolean;
}

/** One line (FR-TPL-9): shrinks in steps down to the minimum until it fits the box width. */
export function fitLine(text: string, font: TextFont, box: BoxSize): FittedLine {
  for (let size = startSize(font, box.height); ; size -= SIZE_STEP) {
    const line = layoutLine(text, font, size);
    if (line.width <= box.width) return { line, size, tooLong: false };
    if (size - SIZE_STEP < TEXT_MIN_SIZE) return { line, size, tooLong: true };
  }
}

/**
 * Splits text into lines no wider than `width` at `size`: at spaces, and inside a word only when
 * the word alone is too wide. Each line is then ordered on its own (`layoutLine`).
 */
export function wrapText(text: string, font: TextFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ').filter((part) => part !== '')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (font.widthOf(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line !== '') lines.push(line);
    line = '';
    // A word wider than the box is broken by characters.
    for (const char of word) {
      if (line !== '' && font.widthOf(line + char, size) > width) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

export interface FittedBlock {
  lines: LaidOutLine[];
  size: number;
  lineHeight: number;
  /** More lines than the box holds at the minimum size: all are drawn, never cut. */
  tooLong: boolean;
}

/** Long text (FR-TPL-9): wrapped, shrinking in steps down to the minimum until it fits. */
export function fitBlock(text: string, font: TextFont, box: BoxSize): FittedBlock {
  for (let size = startSize(font, box.height); ; size -= SIZE_STEP) {
    const wrapped = wrapText(text, font, size, box.width);
    const lineHeight = size * LINE_SPACING;
    const fits = wrapped.length * lineHeight <= box.height;
    if (fits || size - SIZE_STEP < TEXT_MIN_SIZE) {
      return {
        lines: wrapped.map((part) => layoutLine(part, font, size)),
        size,
        lineHeight,
        tooLong: !fits,
      };
    }
  }
}

/** The keys (never the values) whose text can't be drawn as it is. */
export interface TextFitReport {
  /** Wider than its box even at the minimum size. */
  tooLong: string[];
  /** Has characters the font lacks (drawn as `?`). */
  unsupported: string[];
}

/** The text a position shows from the saved values (3.6), or null when it shows no text. */
export function textValueOf(
  field: Pick<TemplateFieldSettings, 'fieldType' | 'key' | 'fillMode'>,
  fieldValues: FieldValues,
): string | null {
  const isText = isSystemValueType(field.fieldType) || field.fieldType === 'pension_fund_name';
  if (!isText || field.fillMode === 'employee') return null;
  const value = fieldValues.values[field.key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Checks every system text of one employee against its boxes, with the font only (no PDF): fast
 * enough to run per recipient before a send (3.8, 3.10), so the manager sees these first. Checks
 * positions with a condition too, since the signed document (3.7) may show them.
 */
export function checkTextFit(
  fields: readonly (TemplateFieldSettings & BoxSize)[],
  fieldValues: FieldValues,
  font: TextFont,
): TextFitReport {
  const tooLong = new Set<string>();
  const unsupported = new Set<string>();
  for (const field of fields) {
    const value = textValueOf(field, fieldValues);
    if (value === null) continue;
    const prepared = prepareText(value, font);
    if (prepared.unsupported) unsupported.add(field.key);
    if (fitLine(prepared.text, font, textArea(field)).tooLong) tooLong.add(field.key);
  }
  return { tooLong: [...tooLong], unsupported: [...unsupported] };
}
