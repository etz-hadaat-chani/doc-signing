import { describe, expect, it } from 'vitest';
import { NAME_PART_MAX, UniqueNames, windowsSafeName } from './zip-names.js';

describe('windowsSafeName', () => {
  it('keeps Hebrew, digits and the department hyphen', () => {
    expect(windowsSafeName('15 - ממלאות מקום ירושלים')).toBe('15 - ממלאות מקום ירושלים');
  });

  it('replaces the characters Windows forbids and control characters', () => {
    expect(windowsSafeName('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(windowsSafeName('שם\tעם\nשורה')).toBe('שם_עם_שורה');
  });

  it('drops trailing dots and spaces, and never returns an empty name', () => {
    expect(windowsSafeName('מחלקה. . ')).toBe('מחלקה');
    expect(windowsSafeName('...')).toBe('_');
    expect(windowsSafeName('')).toBe('_');
  });

  it('cuts long names at whole characters', () => {
    const long = 'א'.repeat(NAME_PART_MAX + 20);
    expect([...windowsSafeName(long)]).toHaveLength(NAME_PART_MAX);
    expect([...windowsSafeName('😀'.repeat(5), 3)]).toEqual(['😀', '😀', '😀']);
  });
});

describe('UniqueNames', () => {
  it('numbers repeats, ignoring case like Windows', () => {
    const names = new UniqueNames();
    expect(names.take('15 - א/1_a b.pdf')).toBe('15 - א/1_a b.pdf');
    expect(names.take('15 - א/1_A B.pdf')).toBe('15 - א/1_A B (2).pdf');
    expect(names.take('15 - א/1_a b.pdf')).toBe('15 - א/1_a b (3).pdf');
    expect(names.take('16 - ב/1_a b.pdf')).toBe('16 - ב/1_a b.pdf');
  });

  it('handles a name without an extension', () => {
    const names = new UniqueNames();
    names.take('a.b/c');
    expect(names.take('a.b/c')).toBe('a.b/c (2)');
  });
});
