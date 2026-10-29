import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { he } from '../../i18n/he';

/**
 * Where the signature goes on B3. 6.4 part B replaces this component with the signature pad,
 * the reading statement and "confirm".
 */
export function SignatureStepPlaceholder() {
  return (
    <Box sx={{ p: 3, border: 2, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 1 }}>
      <Typography color="text.secondary">{he.sign.form.signaturePlaceholder}</Typography>
    </Box>
  );
}
