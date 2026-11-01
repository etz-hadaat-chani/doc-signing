import type { EmailChoice } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useId } from 'react';
import { he } from '../../i18n/he';
import { choiceSx } from './box-ui';
import { FitWarning } from './BoxField';

const text = he.sign.form.email;

interface EmailSectionProps {
  choice: EmailChoice | null;
  /** The address in the box: what she typed, else the stored email. */
  email: string;
  /** A stored email filled the box in: the hint says she may keep or correct it. */
  prefilled: boolean;
  /** "Choose one" (`email_choice`). */
  choiceError: string | null;
  /** A missing or bad address (`email`). */
  emailError: string | null;
  tooLong: string | null;
  onChoice: (choice: EmailChoice) => void;
  onEmail: (email: string) => void;
}

/**
 * The email section (FR-SGN-9), the same in every contract: exactly one of two choices, none
 * chosen at first. (a) the email box, pre-filled with the stored email, which she keeps or
 * corrects (left to right inside the page); typing in it chooses (a). (b) "no email, at the
 * office": the box is greyed out and its address is not sent, but kept for a change of mind.
 */
export function EmailSection(props: EmailSectionProps) {
  const { choice, email, prefilled, choiceError, emailError, tooLong, onChoice, onEmail } = props;
  const name = useId();
  const office = choice === 'office';
  const fieldError = office ? null : emailError;
  return (
    <FormControl component="fieldset" error={choiceError !== null} fullWidth>
      <FormLabel component="legend">{text.title}</FormLabel>
      <Typography sx={{ mb: 1 }}>{text.intro}</Typography>
      <FormControlLabel
        control={
          <Radio
            name={name}
            value="email"
            checked={choice === 'email'}
            onChange={() => onChoice('email')}
          />
        }
        label={text.byEmail}
        sx={choiceSx}
      />
      <Box sx={{ paddingInlineStart: 6, mt: 2, mb: 1 }}>
        <TextField
          fullWidth
          type="email"
          label={text.field}
          value={email}
          disabled={office}
          onChange={(event) => {
            onEmail(event.target.value);
            if (choice !== 'email') onChoice('email');
          }}
          error={fieldError !== null}
          helperText={fieldError ?? (prefilled ? text.fieldHint : ' ')}
          autoComplete="off"
          slotProps={{
            htmlInput: {
              dir: 'ltr',
              spellCheck: false,
              inputMode: 'email',
              'aria-invalid': fieldError !== null,
            },
          }}
        />
        <FitWarning message={office || fieldError !== null ? null : tooLong} />
      </Box>
      <FormControlLabel
        control={
          <Radio name={name} value="office" checked={office} onChange={() => onChoice('office')} />
        }
        label={text.office}
        sx={choiceSx}
      />
      {choiceError !== null && <FormHelperText>{choiceError}</FormHelperText>}
    </FormControl>
  );
}
