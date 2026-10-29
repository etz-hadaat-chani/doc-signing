import {
  formatDayIL,
  SIGN_IMAGE_MAX_CHARS,
  SIGNING_DAY,
  type TemplateFieldSettings,
} from '@doc-signing/shared';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type ChangeEvent, useId, useRef, useState } from 'react';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { parseDay } from './date-text';
import { boxLabel, choiceSx, RADIO_MAX_CHOICES } from './box-ui';
import { DrawingPad } from './DrawingPad';

const text = he.sign.form;

/** A drawing box's pad on screen (CSS pixels). */
const DRAWING_PAD = { width: 400, height: 160 } as const;

export interface BoxFieldProps {
  box: TemplateFieldSettings;
  /** The draft's answer (a drawing box: its PNG data URL). */
  value: string | boolean | undefined;
  /** The Hebrew error next to the box, after "check". */
  error: string | null;
  /** "Too long for its place" while she types (never blocks). */
  tooLong: string | null;
  signingDay: string;
  onChange: (value: string | boolean) => void;
}

/** One box of B3 (FR-TPL-9), by its type. */
export function BoxField(props: BoxFieldProps) {
  switch (props.box.fieldType) {
    case 'long_text':
      return <TextBox {...props} multiline />;
    case 'select':
      return <SelectBox {...props} />;
    case 'checkbox':
      return <CheckboxBox {...props} />;
    case 'date_input':
      return <DateBox {...props} />;
    case 'drawing':
      return <DrawingBox {...props} />;
    default:
      // Short text, and a system value she fills in (one line).
      return <TextBox {...props} multiline={false} />;
  }
}

/** The fit warning under a box: it doesn't stop her typing. */
export function FitWarning({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <Alert severity="warning" role="status" sx={{ mt: 1 }}>
      {message}
    </Alert>
  );
}

function TextBox({
  box,
  value,
  error,
  tooLong,
  onChange,
  multiline,
}: BoxFieldProps & {
  multiline: boolean;
}) {
  const typed = typeof value === 'string' ? value : '';
  const maxLength = box.options?.maxLength;
  const left = maxLength === undefined ? null : Math.max(maxLength - typed.length, 0);
  const hint = multiline && left !== null ? text.charsLeft(left) : ' ';
  return (
    <Box>
      <TextField
        fullWidth
        label={boxLabel(box)}
        value={typed}
        multiline={multiline}
        minRows={multiline ? 4 : undefined}
        onChange={(event) =>
          onChange(multiline ? event.target.value : event.target.value.replace(/[\r\n]+/g, ' '))
        }
        error={error !== null}
        helperText={error ?? hint}
        autoComplete="off"
        slotProps={{ htmlInput: { maxLength, 'aria-invalid': error !== null } }}
      />
      {multiline && error !== null && left !== null && (
        <Typography variant="body2" color="text.secondary">
          {text.charsLeft(left)}
        </Typography>
      )}
      <FitWarning message={tooLong} />
    </Box>
  );
}

function SelectBox({ box, value, error, tooLong, onChange }: BoxFieldProps) {
  const choices = box.options?.choices ?? [];
  const chosen = typeof value === 'string' ? value : '';
  const labelId = useId();
  if (choices.length > RADIO_MAX_CHOICES) {
    return (
      <Box>
        <TextField
          select
          fullWidth
          label={boxLabel(box)}
          value={chosen}
          onChange={(event) => onChange(event.target.value)}
          error={error !== null}
          helperText={error ?? ' '}
          slotProps={{
            select: { MenuProps: { slotProps: { list: { dense: false } } } },
          }}
        >
          {choices.map((choice) => (
            <MenuItem
              key={choice}
              value={choice}
              sx={{ minHeight: 56, fontSize: tokens.sign.bodySize }}
            >
              {choice}
            </MenuItem>
          ))}
        </TextField>
        <FitWarning message={tooLong} />
      </Box>
    );
  }
  return (
    <Box>
      <FormControl component="fieldset" error={error !== null} fullWidth>
        <FormLabel component="legend" id={labelId}>
          {boxLabel(box)}
        </FormLabel>
        <RadioGroup
          aria-labelledby={labelId}
          value={chosen}
          onChange={(event) => onChange(event.target.value)}
        >
          {choices.map((choice) => (
            <FormControlLabel
              key={choice}
              value={choice}
              control={<Radio />}
              label={choice}
              sx={choiceSx}
            />
          ))}
        </RadioGroup>
        {error !== null && <FormHelperText>{error}</FormHelperText>}
      </FormControl>
      <FitWarning message={tooLong} />
    </Box>
  );
}

function CheckboxBox({ box, value, error, onChange }: BoxFieldProps) {
  return (
    <FormControl error={error !== null} fullWidth>
      <FormControlLabel
        control={
          <Checkbox
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
            slotProps={{ input: { 'aria-invalid': error !== null } }}
          />
        }
        label={boxLabel(box)}
        sx={choiceSx}
      />
      {error !== null && <FormHelperText>{error}</FormHelperText>}
    </FormControl>
  );
}

const canPickDate = () =>
  typeof HTMLInputElement !== 'undefined' && 'showPicker' in HTMLInputElement.prototype;

/** The allowed range in words, or null when the box has none. */
function dateRange(box: TemplateFieldSettings, signingDay: string): string | null {
  const limit = (day: string | undefined) =>
    day === undefined ? null : formatDayIL(day === SIGNING_DAY ? signingDay : day);
  const from = limit(box.options?.minDate);
  const until = limit(box.options?.maxDate);
  if (from && until) return text.dateBetween(from, until);
  if (from) return text.dateFrom(from);
  if (until) return text.dateUntil(until);
  return null;
}

/**
 * A date she types as DD/MM/YYYY (one-digit parts too), or picks with the browser's own
 * calendar (a hidden date field; the button is left out where the browser can't open it).
 */
function DateBox({ box, value, error, tooLong, signingDay, onChange }: BoxFieldProps) {
  const typed = typeof value === 'string' ? value : '';
  const picker = useRef<HTMLInputElement>(null);
  const limit = (day: string | undefined) =>
    day === undefined ? undefined : day === SIGNING_DAY ? signingDay : day;
  const range = dateRange(box, signingDay);
  const hint = range ? `${text.dateHint}. ${range}` : text.dateHint;
  return (
    <Box sx={{ position: 'relative' }}>
      <TextField
        fullWidth
        label={boxLabel(box)}
        value={typed}
        placeholder={text.datePlaceholder}
        onChange={(event) => onChange(event.target.value)}
        error={error !== null}
        helperText={error ?? hint}
        autoComplete="off"
        slotProps={{
          htmlInput: {
            dir: 'ltr',
            inputMode: 'numeric',
            maxLength: 10,
            'aria-invalid': error !== null,
          },
          input: canPickDate()
            ? {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={text.calendar}
                      onClick={() => {
                        try {
                          picker.current?.showPicker();
                        } catch {
                          // Not allowed here: she types the date.
                        }
                      }}
                      sx={{ width: 48, height: 48 }}
                    >
                      <CalendarMonthOutlined />
                    </IconButton>
                  </InputAdornment>
                ),
              }
            : undefined,
        }}
      />
      <Box
        component="input"
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        min={limit(box.options?.minDate)}
        max={limit(box.options?.maxDate)}
        value={parseDay(typed) ?? ''}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          if (event.target.value) onChange(formatDayIL(event.target.value));
        }}
        sx={{
          position: 'absolute',
          insetInlineEnd: 0,
          top: 56,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
          border: 0,
          p: 0,
        }}
      />
      <FitWarning message={tooLong} />
    </Box>
  );
}

/**
 * A drawing box (FR-TPL-9): its own small pad and "ניקוי". A drawing larger than the server
 * takes (`SIGN_IMAGE_MAX_CHARS`) is not saved; she is asked to clear and draw again.
 */
function DrawingBox({ box, value, error, onChange }: BoxFieldProps) {
  const [clearSignal, setClearSignal] = useState(0);
  const [tooLarge, setTooLarge] = useState(false);
  const labelId = useId();
  const shownError = tooLarge ? text.drawingTooLarge : error;
  return (
    <FormControl component="fieldset" error={shownError !== null} fullWidth>
      <FormLabel component="legend" id={labelId}>
        {boxLabel(box)}
      </FormLabel>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {text.drawingHint}
      </Typography>
      <DrawingPad
        value={typeof value === 'string' ? value : ''}
        label={text.drawingArea(boxLabel(box))}
        height={DRAWING_PAD.height}
        maxWidth={DRAWING_PAD.width}
        clearSignal={clearSignal}
        onDraw={(png) => {
          if (png.length > SIGN_IMAGE_MAX_CHARS) {
            setTooLarge(true);
            return;
          }
          setTooLarge(false);
          onChange(png);
        }}
      />
      <Box sx={{ mt: 1 }}>
        <Button
          variant="outlined"
          onClick={() => {
            setClearSignal((n) => n + 1);
            setTooLarge(false);
            onChange('');
          }}
        >
          {text.clear}
        </Button>
      </Box>
      {shownError !== null && <FormHelperText>{shownError}</FormHelperText>}
    </FormControl>
  );
}
