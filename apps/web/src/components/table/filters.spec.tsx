import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { he } from '../../i18n/he';
import { renderComponent } from '../../test/render';
import { departmentOptions } from './departments';
import { DepartmentFilter, SelectFilter } from './filters';

const departments = [
  { id: 'b', code: 15, name: 'מחלקה לדוגמה ב', isActive: true },
  { id: 'c', code: 120, name: 'מחלקה לדוגמה ג', isActive: true },
  { id: 'a', code: 3, name: 'מחלקה לדוגמה א', isActive: true },
];

describe('departmentOptions', () => {
  it('sorts by code (as numbers) and shows "code - name"', () => {
    expect(departmentOptions(departments).map((option) => option.label)).toEqual([
      '3 - מחלקה לדוגמה א',
      '15 - מחלקה לדוגמה ב',
      '120 - מחלקה לדוגמה ג',
    ]);
  });

  it('does not reorder the list it was given', () => {
    departmentOptions(departments);
    expect(departments.map((department) => department.code)).toEqual([15, 120, 3]);
  });
});

describe('filters', () => {
  it('department filter: "all" first, then departments by code; picking one gives its id', async () => {
    const onChange = vi.fn();
    const { user } = renderComponent(
      <DepartmentFilter departments={departments} value={undefined} onChange={onChange} />,
    );
    await user.click(screen.getByRole('combobox', { name: he.filters.department }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      he.filters.all,
      '3 - מחלקה לדוגמה א',
      '15 - מחלקה לדוגמה ב',
      '120 - מחלקה לדוגמה ג',
    ]);
    await user.click(screen.getByRole('option', { name: '15 - מחלקה לדוגמה ב' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('choosing "all" clears the filter', async () => {
    const onChange = vi.fn();
    const { user } = renderComponent(
      <SelectFilter
        label={he.filters.status}
        value="sent"
        options={[{ value: 'sent', label: 'נשלח' }]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: he.filters.status }));
    await user.click(screen.getByRole('option', { name: he.filters.all }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
