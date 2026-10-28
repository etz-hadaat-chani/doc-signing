import { formatDate, RECIPIENT_TEXT_WARNINGS, type RoundSent } from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router';
import { CountTiles } from '../../../components/stats/CountTiles';
import type { Column } from '../../../components/table/DataTable';
import { MemoryTable } from '../../../components/table/MemoryTable';
import { formatNumber } from '../../../i18n/format';
import { he } from '../../../i18n/he';
import { hiddenRows } from './summary-view';

const texts = he.newRound.done;
const columns = he.newRound.columns;

type TextWarning = RoundSent['textWarnings']['items'][number];

const COUNT_KEYS = ['queued', 'noEmail', 'missingData', 'cancelledInactive'] as const;

const warningColumns: Column<TextWarning>[] = [
  {
    key: 'employeeNumber',
    header: columns.employeeNumber,
    render: (row) => <bdi>{row.employeeNumber}</bdi>,
  },
  { key: 'name', header: columns.name, render: (row) => <bdi>{row.name}</bdi> },
  { key: 'department', header: columns.department, render: (row) => row.department },
  {
    key: 'warnings',
    header: columns.warnings,
    render: (row) =>
      row.warnings
        .map(
          (warning) =>
            `${RECIPIENT_TEXT_WARNINGS[warning.code]} (${warning.keys.map(({ name }) => name).join(', ')})`,
        )
        .join('; '),
  },
];

/**
 * After the send (FR-RND-6): what went where, the links' expiry, text that won't fit, and the way
 * to the round's details or a new round. The emails themselves go out in the background.
 */
export function DoneStep({ sent, onNewRound }: { sent: RoundSent; onNewRound: () => void }) {
  const hidden = hiddenRows(sent.textWarnings);
  return (
    <>
      <Alert severity="success" role="status">
        {texts.intro}
      </Alert>
      <CountTiles
        label={texts.countsLabel}
        tiles={COUNT_KEYS.map((key) => ({
          key,
          label: texts.counts[key],
          value: sent.counts[key],
        }))}
        fit
      />
      <Typography>{texts.expiry(formatDate(sent.linkExpiresAt))}</Typography>
      {sent.textWarnings.total > 0 && (
        <Box
          component="section"
          aria-labelledby="round-done-warnings"
          sx={{ display: 'grid', gap: 1 }}
        >
          <Typography variant="h3" id="round-done-warnings">
            {texts.textWarningsTitle}
          </Typography>
          <MemoryTable
            caption={texts.textWarningsTitle}
            columns={warningColumns}
            items={sent.textWarnings.items}
            getRowId={(row) => row.employeeId}
          />
          {hidden > 0 && (
            <Typography>{he.newRound.summary.moreRows(formatNumber(hidden))}</Typography>
          )}
        </Box>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        <Button variant="contained" component={RouterLink} to={`/rounds/${sent.id}`}>
          {texts.toRound}
        </Button>
        <Button variant="outlined" onClick={onNewRound}>
          {texts.newRound}
        </Button>
      </Box>
    </>
  );
}
