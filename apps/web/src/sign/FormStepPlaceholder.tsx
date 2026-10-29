import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { he } from '../i18n/he';

/**
 * After she read the document to the end (link and office computer). 6.4 replaces this
 * component with the form and signature (B3).
 */
export function FormStepPlaceholder() {
  return (
    <Box role="status" sx={{ textAlign: 'center' }}>
      <Typography variant="h1" sx={{ mb: 2 }}>
        {he.sign.formPlaceholder.title}
      </Typography>
      <Typography>{he.sign.formPlaceholder.text}</Typography>
    </Box>
  );
}
