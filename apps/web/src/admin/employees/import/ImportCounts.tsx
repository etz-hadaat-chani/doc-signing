import type { ImportPreview } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { formatNumber } from '../../../i18n/format';
import { tokens } from '../../../theme/tokens';

type Counts = ImportPreview['counts'];
type CountKey = Exclude<keyof Counts, 'rowsTotal'>;

const EMPLOYEE_COUNTS: readonly CountKey[] = [
  'rowsNew',
  'rowsUpdated',
  'rowsUnchanged',
  'rowsFailed',
];
const DEPARTMENT_COUNTS: readonly CountKey[] = ['departmentsNew', 'departmentsRenamed'];

const { font } = tokens;

/** The import's numbers as tiles; department tiles only when there are any. */
export function ImportCounts({
  counts,
  labels,
  label,
}: {
  counts: Counts;
  labels: Record<CountKey, string>;
  label: string;
}) {
  const shown = [...EMPLOYEE_COUNTS, ...DEPARTMENT_COUNTS.filter((key) => counts[key] > 0)];
  return (
    <Box
      component="ul"
      aria-label={label}
      sx={{
        listStyle: 'none',
        m: 0,
        p: 0,
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' },
      }}
    >
      {shown.map((key) => (
        <Paper component="li" variant="outlined" key={key} data-count={key} sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {labels[key]}
          </Typography>
          <Typography
            data-value
            sx={{
              mt: 1,
              fontSize: font.size.stat,
              fontWeight: font.weight.semibold,
              lineHeight: 1.2,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatNumber(counts[key])}
          </Typography>
        </Paper>
      ))}
    </Box>
  );
}
