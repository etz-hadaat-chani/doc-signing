import type { ImportCommitResult } from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router';
import { he } from '../../../i18n/he';
import { ImportCounts } from './ImportCounts';

const texts = he.employeeImport;

/** Step 3: the final counts. Nothing was sent; emails added wait in manual handling. */
export function DoneStep({
  result,
  onAnother,
}: {
  result: ImportCommitResult;
  onAnother: () => void;
}) {
  return (
    <Box component="section" aria-labelledby="import-done" sx={{ display: 'grid', gap: 3 }}>
      <Typography variant="h2" id="import-done">
        {texts.doneTitle}
      </Typography>
      <ImportCounts counts={result.counts} labels={texts.doneCounts} label={texts.countsLabel} />
      <Alert severity="info" role="note">
        <strong>{texts.nothingSent}</strong> {texts.doneManual}
      </Alert>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        <Button variant="contained" component={RouterLink} to="/employees">
          {texts.toEmployees}
        </Button>
        <Button variant="outlined" component={RouterLink} to="/manual">
          {texts.toManual}
        </Button>
        <Button variant="outlined" onClick={onAnother}>
          {texts.anotherImport}
        </Button>
      </Box>
    </Box>
  );
}
