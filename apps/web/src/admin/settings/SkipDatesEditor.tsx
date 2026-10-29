import { formatDayIL, REMINDER_SKIP_DATES_MAX } from '@doc-signing/shared';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { addSkipDate, removeSkipDate } from './skip-dates';

const text = he.settings.skipDates;

/**
 * The no-reminder dates (3.14, FR-REM-1): type a day as DD/MM/YYYY, add it, remove one. The list
 * is part of the settings form; the whole list is sent with the save.
 */
export function SkipDatesEditor({
  value,
  onChange,
  error,
}: {
  /** `YYYY-MM-DD`, sorted. */
  value: string[];
  onChange: (value: string[]) => void;
  /** A problem with the list itself (from the save). */
  error?: string;
}) {
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | null>(null);
  const full = value.length >= REMINDER_SKIP_DATES_MAX;

  const add = () => {
    const result = addSkipDate(value, typed);
    if ('error' in result) {
      setTypedError(result.error);
      return;
    }
    setTyped('');
    setTypedError(null);
    onChange(result.list);
  };

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Typography color="text.secondary">{text.hint}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap' }}>
        <TextField
          id="settings-reminderSkipDates"
          label={text.dateLabel}
          placeholder={text.datePlaceholder}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setTypedError(null);
          }}
          onKeyDown={(event) => {
            // Enter adds the day; it must not submit the whole settings form.
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          error={typedError !== null || error !== undefined}
          helperText={typedError ?? error ?? (full ? text.full(REMINDER_SKIP_DATES_MAX) : ' ')}
          disabled={full}
          autoComplete="off"
          slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
          sx={{ maxWidth: 220 }}
        />
        <Button variant="outlined" onClick={add} disabled={full} sx={{ mt: 0.5 }}>
          {text.add}
        </Button>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography component="h3" variant="body2" sx={{ fontWeight: 'medium' }}>
          {text.listLabel}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          ({text.count(value.length, REMINDER_SKIP_DATES_MAX)})
        </Typography>
      </Box>
      {value.length === 0 ? (
        <Typography color="text.secondary">{text.empty}</Typography>
      ) : (
        <Box
          component="ul"
          aria-label={text.listLabel}
          sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, m: 0, p: 0, listStyle: 'none' }}
        >
          {value.map((day) => {
            const shown = formatDayIL(day);
            return (
              <Box
                component="li"
                key={day}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  pl: 1.5,
                  border: `1px solid ${tokens.color.border}`,
                  borderRadius: `${tokens.radius.control}px`,
                  bgcolor: tokens.color.surface,
                }}
              >
                <bdi>{shown}</bdi>
                <IconButton
                  aria-label={text.remove(shown)}
                  onClick={() => onChange(removeSkipDate(value, day))}
                >
                  <CloseOutlined fontSize="small" />
                </IconButton>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
