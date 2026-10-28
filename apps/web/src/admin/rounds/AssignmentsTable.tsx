import {
  type AssignmentRow,
  type AssignmentTableQuery,
  assignmentTableQuerySchema,
  DISPLAY_STATUSES,
  formatDate,
  type RoundDetails,
  SEARCH_MAX_LENGTH,
} from '@doc-signing/shared';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { StatusChip, ToneChip } from '../../components/status/StatusChip';
import { type Column, DataTable } from '../../components/table/DataTable';
import { FilterBar, SearchField, SelectFilter } from '../../components/table/filters';
import { useTableQuery } from '../../components/table/use-table-query';
import { he } from '../../i18n/he';
import { documentPath } from '../employees/employees.api';
import { RoundFiles } from './RoundFiles';
import {
  hasSignedFiles,
  optionalDate,
  remindersText,
  showLockedFlag,
  STATUS_FILTER_OPTIONS,
  zipCounts,
} from './round-view';
import { fetchAssignments, roundKeys } from './rounds.api';

const text = he.rounds.table;

function EmailAnswer({ answer }: { answer: NonNullable<AssignmentRow['emailAnswer']> }) {
  return (
    <Box sx={{ display: 'grid', gap: 0.5, justifyItems: 'start' }}>
      <span>{answer.choiceLabel}</span>
      {answer.email !== null && <bdi dir="ltr">{answer.email}</bdi>}
      {answer.differsFromStored && (
        <ToneChip label={text.emailDiffers} tone="warning" icon={ErrorOutlineOutlined} />
      )}
    </Box>
  );
}

function StatusCell({ row }: { row: AssignmentRow }) {
  const correctionRound = row.returned?.correctionRound ?? null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
      <StatusChip status={row.displayStatus} />
      {showLockedFlag(row) && <StatusChip status="locked" />}
      {correctionRound && (
        <Typography variant="body2" component="span" sx={{ flexBasis: '100%' }}>
          {text.sentAgainIn}{' '}
          <Link component={RouterLink} to={`/rounds/${correctionRound.id}`}>
            <bdi>{correctionRound.name}</bdi>
          </Link>
        </Typography>
      )}
    </Box>
  );
}

/** One row per employee; never the ID number (the API doesn't send it). */
const COLUMNS: readonly Column<AssignmentRow>[] = [
  {
    key: 'employeeNumber',
    header: text.columns.employeeNumber,
    render: (row) => <bdi>{row.employeeNumber}</bdi>,
  },
  {
    key: 'name',
    header: text.columns.name,
    render: (row) => (
      <Box sx={{ minWidth: 140 }}>
        <Link component={RouterLink} to={`/employees/${row.employeeId}`}>
          <bdi>
            {row.firstName} {row.lastName}
          </bdi>
        </Link>
      </Box>
    ),
  },
  {
    key: 'department',
    header: text.columns.department,
    render: (row) => (
      <Box sx={{ minWidth: 160 }}>
        <bdi>{row.department.label}</bdi>
      </Box>
    ),
  },
  { key: 'status', header: text.columns.status, render: (row) => <StatusCell row={row} /> },
  {
    key: 'lastUpdate',
    header: text.columns.lastUpdate,
    render: (row) => formatDate(row.lastUpdateAt),
  },
  { key: 'reminders', header: text.columns.reminders, render: remindersText },
  { key: 'sentAt', header: text.columns.sentAt, render: (row) => optionalDate(row.sentAt) },
  {
    key: 'openedAt',
    header: text.columns.openedAt,
    render: (row) => optionalDate(row.firstOpenedAt),
  },
  { key: 'signedAt', header: text.columns.signedAt, render: (row) => optionalDate(row.signedAt) },
  {
    key: 'emailAnswer',
    header: text.columns.emailAnswer,
    render: (row) => (row.emailAnswer ? <EmailAnswer answer={row.emailAnswer} /> : he.rounds.none),
  },
  {
    key: 'document',
    header: text.columns.document,
    // A plain link opened on click only: the API checks the role, logs the view and redirects
    // to a 5-minute link. Nothing is fetched before the click.
    render: (row) =>
      row.hasSignedFile ? (
        <Link href={documentPath(row.assignmentId)} target="_blank" rel="noreferrer">
          {text.openDocument}
        </Link>
      ) : (
        he.rounds.none
      ),
  },
];

/**
 * The round's employees (A4, FR-TRK-2): filters in the address (statuses, department at send
 * time, waiting for approval, returned), search text in memory only and sent in a POST body.
 * Fetched again on "רענון", on a page / filter / search change and after an action, never on
 * window focus: a page with email answers writes an audit row on every fetch (NFR-PRV-7).
 */
export function AssignmentsTable({ round }: { round: RoundDetails }) {
  const { query, setQuery } = useTableQuery(assignmentTableQuerySchema);
  const [searchText, setSearchText] = useState('');

  const request: AssignmentTableQuery = searchText === '' ? query : { ...query, q: searchText };
  const rows = useQuery({
    queryKey: roundKeys.assignments(round.id, request),
    queryFn: ({ signal }) => fetchAssignments(round.id, request, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const search = (value: string) => {
    setSearchText(value.slice(0, SEARCH_MAX_LENGTH));
    if (query.page !== 1) setQuery({ page: 1 });
  };

  const filters = {
    status: query.status,
    dept: query.dept,
    approval: query.approval,
    returned: query.returned,
  };
  const departmentOptions = round.departments.map((department) => ({
    value: department.id,
    label: department.label,
  }));

  return (
    <Box component="section" aria-labelledby="round-table" sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
        <Typography variant="h2" id="round-table">
          {text.title}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <RoundFiles
          roundId={round.id}
          filters={filters}
          hasSignedFiles={hasSignedFiles(zipCounts(round, query.dept))}
        />
      </Box>

      <FilterBar>
        <SearchField onSearch={search} />
        <SelectFilter
          multiple
          label={text.statusFilter}
          value={query.status ?? []}
          options={STATUS_FILTER_OPTIONS}
          onChange={(values) => {
            const status = DISPLAY_STATUSES.filter((item) => values.includes(item));
            setQuery({ status: status.length === 0 ? undefined : status });
          }}
        />
        <SelectFilter
          label={he.filters.department}
          value={query.dept}
          options={departmentOptions}
          onChange={(dept) => setQuery({ dept })}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={query.approval === 'waiting'}
              onChange={(event) =>
                setQuery({ approval: event.target.checked ? 'waiting' : undefined })
              }
            />
          }
          label={text.approvalOnly}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={query.returned === true}
              onChange={(event) => setQuery({ returned: event.target.checked ? true : undefined })}
            />
          }
          label={text.returnedOnly}
        />
      </FilterBar>

      <DataTable
        caption={text.caption}
        columns={COLUMNS}
        getRowId={(row) => row.assignmentId}
        data={rows.data}
        isLoading={rows.isPending}
        error={rows.error}
        onRetry={() => void rows.refetch()}
        page={query.page}
        pageSize={query.pageSize}
        onPageChange={(page) => setQuery({ page })}
        onPageSizeChange={(pageSize) => setQuery({ pageSize })}
        emptyText={text.empty}
      />
    </Box>
  );
}
