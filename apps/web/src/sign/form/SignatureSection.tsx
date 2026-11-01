import { SIGN_IMAGE_MAX_CHARS } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { he } from '../../i18n/he';
import { choiceSx } from './box-ui';
import { DrawingPad } from './DrawingPad';
import type { Ink } from './ink';

const text = he.sign.form;

/**
 * The signature pad on screen (CSS pixels): the card's whole width (about 525 px at 1280 px),
 * never less than 500 × 200 there (NFR-USE-2).
 */
const SIGNATURE_PAD = { width: 560, height: 224 } as const;

interface SignatureFieldProps {
  /** The saved signature (PNG data URL), or ''. */
  signature: string;
  error: string | null;
  /** A stroke ended (a PNG small enough for the server), with its ink; '' after "ניקוי". */
  onSignature: (png: string, ink: Ink | null) => void;
}

/**
 * The signature on B3 (FR-SGN-4, FR-SGN-10, NFR-USE-2): one line saying the one signature is
 * placed everywhere the document needs it, then the large smoothed pad with "ניקוי". A drawing
 * too large for the server is not saved; she is asked to clear and sign again.
 */
export function SignatureField({ signature, error, onSignature }: SignatureFieldProps) {
  const [clearSignal, setClearSignal] = useState(0);
  const [tooLarge, setTooLarge] = useState(false);
  const shownError = tooLarge ? text.signature.tooLarge : error;
  return (
    <FormControl component="fieldset" error={shownError !== null} fullWidth>
      <FormLabel component="legend">
        <Typography variant="h2" component="span">
          {text.signature.title}
        </Typography>
      </FormLabel>
      <Typography sx={{ mb: 1 }}>{text.signature.everywhere}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {text.signature.hint}
      </Typography>
      <DrawingPad
        value={signature}
        label={text.signature.area}
        height={SIGNATURE_PAD.height}
        maxWidth={SIGNATURE_PAD.width}
        clearSignal={clearSignal}
        onDraw={(png, ink) => {
          if (png.length > SIGN_IMAGE_MAX_CHARS) {
            setTooLarge(true);
            return;
          }
          setTooLarge(false);
          onSignature(png, ink);
        }}
      />
      <Box sx={{ mt: 1 }}>
        <Button
          variant="outlined"
          onClick={() => {
            setClearSignal((n) => n + 1);
            setTooLarge(false);
            onSignature('', null);
          }}
        >
          {text.clear}
        </Button>
      </Box>
      {shownError !== null && <FormHelperText>{shownError}</FormHelperText>}
    </FormControl>
  );
}

interface ReadingStatementProps {
  acknowledged: boolean;
  error: string | null;
  onChange: (acknowledged: boolean) => void;
}

/** The reading statement (FR-SGN-4), on B3a since 6.5: a checkbox whose whole row is clickable. */
export function ReadingStatement({ acknowledged, error, onChange }: ReadingStatementProps) {
  return (
    <FormControl error={error !== null} fullWidth>
      <FormControlLabel
        control={
          <Checkbox
            checked={acknowledged}
            onChange={(event) => onChange(event.target.checked)}
            slotProps={{ input: { 'aria-invalid': error !== null } }}
          />
        }
        label={he.sign.preview.ack}
        sx={choiceSx}
      />
      {error !== null && <FormHelperText>{error}</FormHelperText>}
    </FormControl>
  );
}
