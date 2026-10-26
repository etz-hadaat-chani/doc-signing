import type { Department } from '@doc-signing/shared';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import { useMemo } from 'react';
import { he } from '../../i18n/he';
import { departmentOptions, type FilterOption } from '../table/departments';

const text = he.departmentPicker;

interface DepartmentPickerProps {
  id: string;
  departments: readonly Department[];
  /** The chosen department ids. */
  value: readonly string[];
  onChange: (ids: string[]) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  /** Shown under the field, marked as an error. */
  error?: string;
  helperText?: string;
}

/**
 * Pick one or more departments: typed to filter, sorted by code and shown as "15 - name"
 * (PRD §7). The chosen ones stay in code order whatever order they were picked in.
 */
export function DepartmentPicker({
  id,
  departments,
  value,
  onChange,
  label = text.label,
  required = false,
  disabled = false,
  error,
  helperText,
}: DepartmentPickerProps) {
  const options = useMemo(() => departmentOptions(departments), [departments]);
  // A chosen id the list doesn't have (yet) is kept, so loading the list never drops a choice.
  const chosen = useMemo(() => {
    const known = options.filter((option) => value.includes(option.value));
    const unknown = value
      .filter((departmentId) => !options.some((option) => option.value === departmentId))
      .map((departmentId) => ({ value: departmentId, label: departmentId }));
    return [...known, ...unknown];
  }, [options, value]);

  return (
    <Autocomplete<FilterOption, true>
      id={id}
      multiple
      options={options}
      value={chosen}
      onChange={(_event, next) => {
        const ids = new Set(next.map((option) => option.value));
        onChange(options.filter((option) => ids.has(option.value)).map((option) => option.value));
      }}
      isOptionEqualToValue={(option, selected) => option.value === selected.value}
      getOptionLabel={(option) => option.label}
      disableCloseOnSelect
      disabled={disabled}
      noOptionsText={text.noOptions}
      openText={text.open}
      closeText={text.close}
      clearText={text.clear}
      slotProps={{ chip: { size: 'small' } }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          error={Boolean(error)}
          helperText={error ?? helperText}
        />
      )}
    />
  );
}
