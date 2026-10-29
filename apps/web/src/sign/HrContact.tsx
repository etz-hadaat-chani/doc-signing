import type { SignHrContact } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { he } from '../i18n/he';
import { tokens } from '../theme/tokens';

const text = he.sign.hrContact;

/**
 * Whom to ask (FR-SGN-7, B5): the HR contact from the state answer. Phone or email may be null
 * (at least one is set); each is left to right inside the right-to-left page.
 */
export function HrContact({ contact }: { contact: SignHrContact }) {
  const lines = [
    { label: text.phone, value: contact.phone },
    { label: text.email, value: contact.email },
  ];
  return (
    <Box
      component="section"
      aria-label={text.title}
      sx={{ mt: 3, pt: 3, borderTop: 1, borderColor: 'divider' }}
    >
      <Typography sx={{ fontWeight: tokens.font.weight.semibold }}>{text.title}</Typography>
      <Typography>
        <bdi>{contact.name}</bdi>
      </Typography>
      {lines.map(({ label, value }) =>
        value === null ? null : (
          <Typography key={label}>
            {label}: <bdi dir="ltr">{value}</bdi>
          </Typography>
        ),
      )}
    </Box>
  );
}
