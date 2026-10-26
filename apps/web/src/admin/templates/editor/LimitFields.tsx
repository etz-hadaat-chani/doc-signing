import { SELECT_CHOICE_MAX_LENGTH, SELECT_MAX_CHOICES } from '@doc-signing/shared';
import AddOutlined from '@mui/icons-material/AddOutlined';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import IconButton from '@mui/material/IconButton';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import { he } from '../../../i18n/he';
import { boxFieldId, type BoxProp } from './editor-check';
import type { DateLimit, EditorBox } from './editor-state';

const text = he.templates.editor;
const DATE_KINDS = ['none', 'signing_day', 'fixed'] as const;

interface LimitProps {
  box: EditorBox;
  disabled: boolean;
  errors: Partial<Record<BoxProp, string>>;
  onChange: (change: Partial<EditorBox>) => void;
}

export function MaxLengthField({
  box,
  disabled,
  errors,
  onChange,
  max,
}: LimitProps & { max: number }) {
  return (
    <TextField
      id={boxFieldId(box.uid, 'maxLength')}
      size="small"
      label={text.maxLength(max)}
      value={box.maxLength}
      disabled={disabled}
      error={Boolean(errors.maxLength)}
      helperText={errors.maxLength}
      onChange={(event) => onChange({ maxLength: event.target.value })}
      slotProps={{ htmlInput: { inputMode: 'numeric', dir: 'ltr' } }}
      sx={{ maxWidth: 260 }}
    />
  );
}

/** A list's options: 2–30, unique, up to 100 characters each (FR-TPL-10). */
export function ChoicesField({ box, disabled, errors, onChange }: LimitProps) {
  const setChoice = (index: number, value: string) =>
    onChange({ choices: box.choices.map((choice, at) => (at === index ? value : choice)) });
  return (
    <FormControl
      component="fieldset"
      id={boxFieldId(box.uid, 'choices')}
      tabIndex={-1}
      error={Boolean(errors.choices)}
      disabled={disabled}
    >
      <FormLabel component="legend">{text.choices}</FormLabel>
      <FormHelperText sx={{ mx: 0 }}>{errors.choices ?? text.choicesHint}</FormHelperText>
      <Box sx={{ display: 'grid', gap: 1, mt: 1 }}>
        {box.choices.map((choice, index) => (
          // The list is edited in place; its order is its identity.
          <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField
              size="small"
              label={text.choice(index + 1)}
              value={choice}
              disabled={disabled}
              onChange={(event) => setChoice(index, event.target.value)}
              slotProps={{ htmlInput: { maxLength: SELECT_CHOICE_MAX_LENGTH } }}
              sx={{ flex: 1, maxWidth: 360 }}
            />
            <IconButton
              aria-label={text.removeChoice(index + 1)}
              disabled={disabled}
              onClick={() => onChange({ choices: box.choices.filter((_, at) => at !== index) })}
            >
              <DeleteOutlined />
            </IconButton>
          </Box>
        ))}
      </Box>
      <Box>
        <Button
          size="small"
          startIcon={<AddOutlined />}
          disabled={disabled || box.choices.length >= SELECT_MAX_CHOICES}
          onClick={() => onChange({ choices: [...box.choices, ''] })}
          sx={{ mt: 1 }}
        >
          {text.addChoice}
        </Button>
      </Box>
    </FormControl>
  );
}

function DateLimitField({
  box,
  prop,
  disabled,
  errors,
  onChange,
}: LimitProps & { prop: 'minDate' | 'maxDate' }) {
  const limit = box[prop];
  const set = (next: DateLimit) => onChange({ [prop]: next });
  return (
    <FormControl component="fieldset" disabled={disabled} error={Boolean(errors[prop])}>
      <FormLabel component="legend">{text[prop]}</FormLabel>
      <RadioGroup
        row
        value={limit.kind}
        onChange={(event) => {
          const kind = DATE_KINDS.find((item) => item === event.target.value);
          if (kind) set({ kind, text: limit.text });
        }}
      >
        {DATE_KINDS.map((kind) => (
          <FormControlLabel
            key={kind}
            value={kind}
            control={<Radio size="small" />}
            label={text.dateKinds[kind]}
          />
        ))}
      </RadioGroup>
      {limit.kind === 'fixed' && (
        <TextField
          id={boxFieldId(box.uid, prop)}
          size="small"
          label={text.dateText}
          value={limit.text}
          disabled={disabled}
          error={Boolean(errors[prop])}
          helperText={errors[prop]}
          onChange={(event) => set({ kind: 'fixed', text: event.target.value })}
          slotProps={{ htmlInput: { inputMode: 'numeric', dir: 'ltr' } }}
          sx={{ maxWidth: 220, mt: 1 }}
        />
      )}
      {limit.kind !== 'fixed' && errors[prop] && <FormHelperText>{errors[prop]}</FormHelperText>}
    </FormControl>
  );
}

/** The earliest and latest date of a date box: none, the signing day, or a fixed day. */
export function DateLimitsField(props: LimitProps) {
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <DateLimitField {...props} prop="minDate" />
      <DateLimitField {...props} prop="maxDate" />
    </Box>
  );
}
