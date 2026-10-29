import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { he } from '../i18n/he';
import { tokens } from '../theme/tokens';

/**
 * After the correct ID number (link and office computer): the signing session cookie is set.
 * 6.3 replaces this component with the document view (B2).
 */
export function NextStepPlaceholder() {
  return (
    <Box role="status" sx={{ textAlign: 'center' }}>
      <CheckCircleOutlined aria-hidden sx={{ fontSize: 56, color: tokens.color.success, mb: 1 }} />
      <Typography variant="h1" sx={{ mb: 2 }}>
        {he.sign.verified.title}
      </Typography>
      <Typography>{he.sign.verified.text}</Typography>
    </Box>
  );
}
