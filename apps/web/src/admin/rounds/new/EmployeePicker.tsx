import type { EmployeeListQuery } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { type Column, DataTable } from '../../../components/table/DataTable';
import { SearchField } from '../../../components/table/filters';
import { he } from '../../../i18n/he';
import { employeeKeys, fetchEmployees } from '../../employees/employees.api';
import { employeeColumns, fullName } from './employee-columns';
import { pickedFrom, type PickedEmployee } from './wizard-state';

const texts = he.newRound.recipients;
const previewTexts = he.newRound.preview;
const PAGE_SIZE = 10;

/**
 * Finds employees by name or number. The text stays in this component's memory and goes in the
 * body of `POST /api/employees/search`, never in a URL (it may be an ID number). Inactive
 * employees are found too: the summary says they won't be added.
 */
export function EmployeePicker({
  isPicked,
  canPick,
  onPick,
  single = false,
}: {
  isPicked: (employeeId: string) => boolean;
  /** False at the limit: nothing more can be added. */
  canPick: boolean;
  onPick: (employee: PickedEmployee) => void;
  /** One employee at a time (the preview's "specific employee"): "choose" / "chosen". */
  single?: boolean;
}) {
  const labels = single
    ? {
        pick: previewTexts.choose,
        picked: previewTexts.chosen,
        pickLabel: previewTexts.chooseLabel,
      }
    : { pick: texts.add, picked: texts.added, pickLabel: texts.addLabel };
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const query: EmployeeListQuery = { q, page, pageSize };
  const results = useQuery({
    queryKey: employeeKeys.list(query),
    queryFn: ({ signal }) => fetchEmployees(query, signal),
    enabled: q !== '',
    placeholderData: keepPreviousData,
  });

  const pickColumn: Column<PickedEmployee> = {
    key: 'actions',
    header: he.newRound.columns.actions,
    render: (row) => {
      const picked = isPicked(row.id);
      return (
        <Button
          size="small"
          variant="outlined"
          disabled={picked || !canPick}
          aria-label={picked ? undefined : labels.pickLabel(fullName(row))}
          onClick={() => onPick(row)}
        >
          {picked ? labels.picked : labels.pick}
        </Button>
      );
    },
  };
  const found = results.data
    ? { ...results.data, items: results.data.items.map(pickedFrom) }
    : undefined;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <SearchField
        onSearch={(text) => {
          setQ(text);
          setPage(1);
        }}
      />
      {q === '' ? (
        <Typography color="text.secondary">{texts.searchPrompt}</Typography>
      ) : (
        <DataTable
          caption={texts.resultsCaption}
          columns={[...employeeColumns(), pickColumn]}
          getRowId={(row) => row.id}
          data={found}
          isLoading={results.isFetching}
          error={results.error}
          onRetry={() => void results.refetch()}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          emptyText={texts.noResults}
        />
      )}
    </Box>
  );
}
