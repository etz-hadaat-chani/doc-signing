import { ROUND_MODES, type RoundMode } from '@doc-signing/shared';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { he } from '../../../i18n/he';
import { problemText } from './problem-text';
import type { StepProblem } from './wizard-state';

const texts = he.newRound.name;

/** Step 1: the round's name and its mode (FR-RND-1). */
export function NameModeStep({
  name,
  mode,
  problem,
  onName,
  onMode,
}: {
  name: string;
  mode: RoundMode;
  /** Shown after the first "next". */
  problem: StepProblem | null;
  onName: (name: string) => void;
  onMode: (mode: RoundMode) => void;
}) {
  return (
    <>
      <TextField
        id="round-name"
        label={texts.label}
        value={name}
        onChange={(event) => onName(event.target.value)}
        required
        error={problem !== null}
        helperText={problem === null ? texts.hint : problemText(problem)}
        sx={{ maxWidth: 560 }}
        autoComplete="off"
      />
      <FormControl>
        <FormLabel id="round-mode-label">{texts.modeLabel}</FormLabel>
        <RadioGroup
          aria-labelledby="round-mode-label"
          value={mode}
          onChange={(_event, value) => {
            const next = ROUND_MODES.find((option) => option === value);
            if (next) onMode(next);
          }}
        >
          {ROUND_MODES.map((option) => (
            <FormControlLabel
              key={option}
              value={option}
              control={<Radio />}
              sx={{ alignItems: 'flex-start', mt: 1 }}
              label={
                <>
                  <Typography component="span" sx={{ display: 'block' }}>
                    {texts.modes[option]}
                  </Typography>
                  <Typography component="span" variant="body2" color="text.secondary">
                    {texts.modeHints[option]}
                  </Typography>
                </>
              }
            />
          ))}
        </RadioGroup>
      </FormControl>
    </>
  );
}
