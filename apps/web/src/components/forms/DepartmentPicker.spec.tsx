import { screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DEPARTMENTS } from '../../admin/employees/employees.fixtures';
import { he } from '../../i18n/he';
import { renderComponent } from '../../test/render';
import { DepartmentPicker } from './DepartmentPicker';

const [dept19, dept15] = DEPARTMENTS;

function Picker({ onChange, error }: { onChange: (ids: string[]) => void; error?: string }) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <DepartmentPicker
      id="picker"
      departments={DEPARTMENTS}
      value={value}
      onChange={(ids) => {
        setValue(ids);
        onChange(ids);
      }}
      error={error}
    />
  );
}

const combobox = () => screen.getByRole('combobox', { name: he.departmentPicker.label });

describe('DepartmentPicker', () => {
  it('offers departments by code as "code - name" and keeps the chosen ones in code order', async () => {
    const onChange = vi.fn();
    const { user } = renderComponent(<Picker onChange={onChange} />);
    await user.click(combobox());
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '15 - מחלקה לדוגמה א',
      '19 - מחלקה לדוגמה ב',
    ]);
    await user.click(screen.getByRole('option', { name: '19 - מחלקה לדוגמה ב' }));
    await user.click(screen.getByRole('option', { name: '15 - מחלקה לדוגמה א' }));
    expect(onChange).toHaveBeenLastCalledWith([dept15?.id, dept19?.id]);
  });

  it('filters by typed text', async () => {
    const { user } = renderComponent(<Picker onChange={vi.fn()} />);
    await user.type(combobox(), '19');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '19 - מחלקה לדוגמה ב',
    ]);
  });

  it('shows the error under the field', () => {
    renderComponent(<Picker onChange={vi.fn()} error="יש לבחור מחלקה" />);
    expect(combobox()).toHaveAccessibleDescription('יש לבחור מחלקה');
  });
});
