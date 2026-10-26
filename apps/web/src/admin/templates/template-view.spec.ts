import { TEMPLATE_NOT_READY_MESSAGES } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { he } from '../../i18n/he';
import {
  boxName,
  departmentLabels,
  isEditable,
  isolateLtr,
  reasonLines,
  reasonText,
  templateState,
  versionChain,
} from './template-view';
import {
  FIELDS,
  template,
  TEMPLATE_ID,
  VERSION_2_ID,
  VERSION_3_ID,
  versions,
} from './templates.fixtures';

describe('templateState', () => {
  it('puts archived first, then an old version, then ready / not ready', () => {
    const base = { isArchived: false, isLatest: true, isReady: true };
    expect(templateState(base)).toBe('ready');
    expect(templateState({ ...base, isReady: false })).toBe('not_ready');
    expect(templateState({ ...base, isLatest: false })).toBe('old_version');
    expect(templateState({ ...base, isLatest: false, isArchived: true })).toBe('archived');
  });

  it('only the latest version that is not archived is editable', () => {
    expect(isEditable({ isArchived: false, isLatest: true })).toBe(true);
    expect(isEditable({ isArchived: true, isLatest: true })).toBe(false);
    expect(isEditable({ isArchived: false, isLatest: false })).toBe(false);
  });
});

describe('reasons', () => {
  it('names a system value by its type, and an employee box by type and key', () => {
    expect(boxName(FIELDS, 'full_name')).toBe(he.templates.fieldTypes.full_name);
    expect(boxName(FIELDS, 'box_1')).toBe(
      he.templates.boxName(he.templates.fieldTypes.select, isolateLtr('box_1')),
    );
    expect(boxName(FIELDS, 'unknown_key')).toBe('unknown_key');
  });

  it('takes the Hebrew text by code, never from the answer', () => {
    const lines = reasonLines(template);
    expect(lines.map(({ code }) => code)).toEqual([
      'NO_MAIN_SIGNATURE',
      'LABEL_MISSING',
      'TOO_FEW_CHOICES',
    ]);
    expect(lines.every(({ message }) => message !== 'x')).toBe(true);
    const [first, second] = lines;
    expect(first && reasonText(first)).toBe(TEMPLATE_NOT_READY_MESSAGES.NO_MAIN_SIGNATURE);
    expect(second && reasonText(second)).toBe(
      `${TEMPLATE_NOT_READY_MESSAGES.LABEL_MISSING} (${he.templates.fieldTypes.select} – ${isolateLtr('box_1')})`,
    );
  });
});

describe('versionChain', () => {
  it('lists every version newest first, from any version', () => {
    const all = versions();
    const ids = (id: string) => versionChain(all, id).map((item) => item.version);
    expect(ids(TEMPLATE_ID)).toEqual([3, 2, 1]);
    expect(ids(VERSION_2_ID)).toEqual([3, 2, 1]);
    expect(ids(VERSION_3_ID)).toEqual([3, 2, 1]);
  });

  it('ignores other templates, and stops at a version it does not have', () => {
    const all = versions();
    const other = { ...template, id: '9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a', version: 1 };
    expect(versionChain([...all, other], VERSION_3_ID)).toHaveLength(3);
    expect(versionChain(all.slice(1), VERSION_3_ID).map((item) => item.version)).toEqual([3, 2]);
    expect(versionChain(all, other.id)).toEqual([]);
  });
});

describe('departmentLabels', () => {
  it('sorts by code and shows "code - name"', () => {
    expect(departmentLabels(template)).toEqual(['15 - מחלקה לדוגמה א', '19 - מחלקה לדוגמה ב']);
  });
});
