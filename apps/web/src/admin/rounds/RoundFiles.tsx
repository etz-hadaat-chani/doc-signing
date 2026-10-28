import FolderZipOutlined from '@mui/icons-material/FolderZipOutlined';
import TableViewOutlined from '@mui/icons-material/TableViewOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { he } from '../../i18n/he';
import { type AssignmentFilters, downloadUrl, exportUrl } from './rounds.api';
import { useFileDownload } from './use-file-download';

const text = he.rounds.files;

/**
 * Export to Excel (the table's filters, never the search text) and the ZIP of signed files (the
 * chosen department, at send time). Managers and officers alike. The browser downloads both by
 * itself; neither is fetched into memory.
 */
export function RoundFiles({
  roundId,
  filters,
  hasSignedFiles,
}: {
  roundId: string;
  /** Only the filters: this component never sees the search text. */
  filters: AssignmentFilters;
  /** Signed rows in the round (or the chosen department): else the ZIP would be a 409. */
  hasSignedFiles: boolean;
}) {
  const { open, frame } = useFileDownload();
  return (
    <Box
      role="group"
      aria-label={text.label}
      sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}
    >
      <Button
        variant="outlined"
        startIcon={<TableViewOutlined />}
        onClick={() => open(exportUrl(roundId, filters))}
      >
        {text.export}
      </Button>
      <Button
        variant="outlined"
        startIcon={<FolderZipOutlined />}
        disabled={!hasSignedFiles}
        aria-describedby={hasSignedFiles ? undefined : 'round-zip-none'}
        onClick={() => open(downloadUrl(roundId, filters.dept))}
      >
        {filters.dept === undefined ? text.zip : text.zipDepartment}
      </Button>
      {!hasSignedFiles && (
        <Typography id="round-zip-none" variant="body2" color="text.secondary">
          {text.zipNone}
        </Typography>
      )}
      {frame}
    </Box>
  );
}
