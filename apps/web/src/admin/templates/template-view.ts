import {
  hasOwnKey,
  type TemplateField,
  type TemplateItem,
  TEMPLATE_NOT_READY_MESSAGES,
  type TemplateNotReadyCode,
} from '@doc-signing/shared';
import type { TemplateState } from '../../components/status/status-tones';
import { he } from '../../i18n/he';

const text = he.templates;

/** Out of use first (archived, then an older version), else whether it may go in a round. */
export function templateState(
  item: Pick<TemplateItem, 'isArchived' | 'isLatest' | 'isReady'>,
): TemplateState {
  if (item.isArchived) return 'archived';
  if (!item.isLatest) return 'old_version';
  return item.isReady ? 'ready' : 'not_ready';
}

/** Only the latest version that isn't archived can be changed (the API answers 409 otherwise). */
export function isEditable(item: Pick<TemplateItem, 'isArchived' | 'isLatest'>): boolean {
  return !item.isArchived && item.isLatest;
}

/**
 * Left to right inside a Hebrew line (LRI … PDI), so a key like box_1 keeps its place when the
 * line is plain text (a list item, a notification).
 */
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);
export const isolateLtr = (value: string) => LRI + value + PDI;

/**
 * A box by its key, in Hebrew: the type's name, plus the key for the boxes the employee fills in
 * (several of one type can exist). A key no position has (it shouldn't happen) shows as it is.
 */
export function boxName(fields: readonly Pick<TemplateField, 'fieldType' | 'key'>[], key: string) {
  const field = fields.find((item) => item.key === key);
  if (!field) return key;
  const type = text.fieldTypes[field.fieldType];
  return hasOwnKey(field.fieldType) ? type : text.boxName(type, isolateLtr(key));
}

export interface ReasonLine {
  code: TemplateNotReadyCode;
  /** Our Hebrew text by code (never text from the answer). */
  message: string;
  /** The boxes involved, in Hebrew; empty when the reason names none. */
  boxes: string[];
}

/** Every "ready" reason (FR-TPL-8) as a line to show. */
export function reasonLines(item: Pick<TemplateItem, 'fields' | 'notReadyReasons'>): ReasonLine[] {
  return item.notReadyReasons.map(({ code, keys }) => ({
    code,
    message: TEMPLATE_NOT_READY_MESSAGES[code],
    boxes: keys.map((key) => boxName(item.fields, key)),
  }));
}

/** A reason as one line of text: "message (box, box)". */
export function reasonText(line: ReasonLine): string {
  return line.boxes.length === 0
    ? line.message
    : `${line.message} ${text.reasonKeys(line.boxes.join(', '))}`;
}

/**
 * The versions of one template, newest first: from `id` up the `parentTemplateId` chain to
 * version 1, and down to the newest (each version has at most one child, a unique parent).
 * `items` = every version (`fetchAllTemplateVersions`); a version missing from it ends the chain.
 */
export function versionChain(items: readonly TemplateItem[], id: string): TemplateItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const childOf = new Map<string, TemplateItem>();
  for (const item of items) {
    if (item.parentTemplateId !== null) childOf.set(item.parentTemplateId, item);
  }
  const start = byId.get(id);
  if (!start) return [];
  const chain: TemplateItem[] = [start];
  const seen = new Set([start.id]);
  for (let older = start; older.parentTemplateId !== null;) {
    const parent = byId.get(older.parentTemplateId);
    if (!parent || seen.has(parent.id)) break;
    chain.push(parent);
    seen.add(parent.id);
    older = parent;
  }
  for (let newer = childOf.get(start.id); newer && !seen.has(newer.id);) {
    chain.unshift(newer);
    seen.add(newer.id);
    newer = childOf.get(newer.id);
  }
  return chain;
}

/** The departments as "15 - name", sorted by code (PRD §7). */
export function departmentLabels(item: Pick<TemplateItem, 'departments'>): string[] {
  return [...item.departments].sort((a, b) => a.code - b.code).map(({ label }) => label);
}
