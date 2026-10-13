import { describe, expect, it } from 'vitest';
import { formatDepartment } from './department.js';

describe('formatDepartment', () => {
  it('shows "code - name"', () => {
    expect(formatDepartment(15, 'ממלאות מקום ירושלים')).toBe('15 - ממלאות מקום ירושלים');
  });

  it('keeps hyphens and digits in the name', () => {
    expect(formatDepartment(45, 'ממלאות מקום אלעד-45')).toBe('45 - ממלאות מקום אלעד-45');
  });
});
