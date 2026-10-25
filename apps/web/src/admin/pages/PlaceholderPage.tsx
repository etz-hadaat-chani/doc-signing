import Typography from '@mui/material/Typography';
import { he } from '../../i18n/he';
import type { AdminPage } from '../navigation';

/** Stands in for a management screen until its phase 5 task builds it. */
export function PlaceholderPage({ page }: { page: AdminPage }) {
  return (
    <>
      <Typography variant="h1" sx={{ mb: 2 }}>
        {page.label}
      </Typography>
      <Typography color="text.secondary">{he.placeholder.text(page.task)}</Typography>
    </>
  );
}
