import type { ShowWhen } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { he } from '../../../i18n/he';
import type { ConditionTarget } from './editor-rules';

const text = he.templates.editor;
const ALWAYS = '';

interface ConditionFieldsProps {
  /** Ids for the two selects; the first one also takes the focus of an error. */
  id: string;
  value: ShowWhen | null;
  targets: readonly ConditionTarget[];
  disabled: boolean;
  error?: string;
  onChange: (value: ShowWhen | null) => void;
}

/**
 * "Shown only when" (FR-TPL-10): pick a checkbox, a list or the email choice, then its value.
 * A condition that points to a box no longer there still shows, so it can be changed.
 */
export function ConditionFields({
  id,
  value,
  targets,
  disabled,
  error,
  onChange,
}: ConditionFieldsProps) {
  const shown =
    value && !targets.some(({ key }) => key === value.key)
      ? [...targets, { key: value.key, name: text.conditionMissing(value.key), values: [] }]
      : targets;
  const target = value ? shown.find(({ key }) => key === value.key) : undefined;
  const values =
    value && target && !target.values.some((item) => item.value === value.equals)
      ? [...target.values, { value: value.equals, label: value.equals }]
      : (target?.values ?? []);

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
      <TextField
        id={id}
        select
        size="small"
        label={text.condition}
        value={value?.key ?? ALWAYS}
        disabled={disabled}
        error={Boolean(error)}
        helperText={error}
        onChange={(event) => {
          const key = event.target.value;
          if (key === ALWAYS) {
            onChange(null);
            return;
          }
          const next = shown.find((item) => item.key === key);
          onChange({ key, equals: next?.values[0]?.value ?? '' });
        }}
        sx={{ minWidth: 220 }}
      >
        <MenuItem value={ALWAYS}>{text.conditionAlways}</MenuItem>
        {shown.map((item) => (
          <MenuItem key={item.key} value={item.key}>
            {item.name}
          </MenuItem>
        ))}
      </TextField>
      {value && (
        <TextField
          id={`${id}-value`}
          select
          size="small"
          label={text.conditionValue}
          value={values.some((item) => item.value === value.equals) ? value.equals : ''}
          disabled={disabled}
          onChange={(event) => onChange({ key: value.key, equals: event.target.value })}
          sx={{ minWidth: 200 }}
        >
          {values.map((item) => (
            <MenuItem key={item.value} value={item.value}>
              {item.label}
            </MenuItem>
          ))}
        </TextField>
      )}
    </Box>
  );
}
