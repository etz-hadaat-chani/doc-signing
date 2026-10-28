import type { Department } from '@doc-signing/shared';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import Box from '@mui/material/Box';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { he } from '../../i18n/he';
import { departmentOptions, type FilterOption } from './departments';

/** Wait after the last key press before searching. */
export const SEARCH_DELAY_MS = 400;

/** The row of filters above a table. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <Box
      role="group"
      aria-label={he.filters.label}
      sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2 }}
    >
      {children}
    </Box>
  );
}

interface SelectFilterBase {
  label: string;
  options: readonly FilterOption[];
}

interface SingleSelectFilterProps extends SelectFilterBase {
  multiple?: false;
  /** undefined = "הכול". */
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

interface MultipleSelectFilterProps extends SelectFilterBase {
  /** Several choices at once (e.g. a table's statuses); none chosen = "הכול". */
  multiple: true;
  /** [] = "הכול". */
  value: readonly string[];
  /** [] when "הכול" is picked or the last choice is removed; else in the options' order. */
  onChange: (values: string[]) => void;
}

/** One choice from a list (or several, with `multiple`), or "הכול". */
export function SelectFilter(props: SingleSelectFilterProps | MultipleSelectFilterProps) {
  const { label, options } = props;
  const items = [
    <MenuItem key="" value="">
      {he.filters.all}
    </MenuItem>,
    ...options.map((option) => (
      <MenuItem key={option.value} value={option.value}>
        {option.label}
      </MenuItem>
    )),
  ];

  if (props.multiple) {
    const { value, onChange } = props;
    const labels = new Map(options.map((option) => [option.value, option.label]));
    return (
      <TextField
        select
        label={label}
        value={[...value]}
        onChange={(event) => {
          const raw: unknown = event.target.value;
          const picked = Array.isArray(raw) ? raw.map(String) : String(raw).split(',');
          // "הכול" clears every choice; otherwise keep the options' order.
          onChange(
            picked.includes('')
              ? []
              : options.map((option) => option.value).filter((item) => picked.includes(item)),
          );
        }}
        sx={{ minWidth: 200, maxWidth: 360 }}
        slotProps={{
          select: {
            multiple: true,
            displayEmpty: true,
            renderValue: (selected) => {
              const chosen = selected as string[];
              return chosen.length === 0
                ? he.filters.all
                : chosen.map((item) => labels.get(item) ?? item).join(', ');
            },
          },
          inputLabel: { shrink: true },
        }}
      >
        {items}
      </TextField>
    );
  }

  const { value, onChange } = props;
  return (
    <TextField
      select
      label={label}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
      sx={{ minWidth: 200 }}
    >
      {items}
    </TextField>
  );
}

/** Departments sorted by code, shown as "15 - name". */
export function DepartmentFilter({
  departments,
  value,
  onChange,
}: {
  departments: readonly Department[];
  value: string | undefined;
  onChange: (departmentId: string | undefined) => void;
}) {
  return (
    <SelectFilter
      label={he.filters.department}
      value={value}
      options={departmentOptions(departments)}
      onChange={onChange}
    />
  );
}

/**
 * Search text, kept only in this component's memory: never in the address, router state or
 * browser storage (it may be an ID number). The screen sends it in a POST body. Calls
 * `onSearch` on Enter, or after a short pause in typing.
 */
export function SearchField({ onSearch }: { onSearch: (text: string) => void }) {
  const [value, setValue] = useState('');
  const sent = useRef('');
  const latestOnSearch = useRef(onSearch);
  useEffect(() => {
    latestOnSearch.current = onSearch;
  });

  // Refs only, so this stays the same function and the timer effect needs no other input.
  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed === sent.current) return;
    sent.current = trimmed;
    latestOnSearch.current(trimmed);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => send(value), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value, send]);

  return (
    <TextField
      type="search"
      label={he.filters.search}
      placeholder={he.filters.searchHint}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') send(value);
      }}
      autoComplete="off"
      sx={{ minWidth: 280 }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchOutlined aria-hidden />
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
