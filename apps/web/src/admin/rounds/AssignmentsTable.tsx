import {
  type AssignmentRow,
  type AssignmentTableQuery,
  assignmentTableQuerySchema,
  DISPLAY_STATUSES,
  formatDate,
  type RoundDetails,
  type RoundStatus,
  SEARCH_MAX_LENGTH,
} from '@doc-signing/shared';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
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
import { useAuthUser } from '../auth/session';
import { documentPath } from '../employees/employees.api';
import { AnswersPanel } from './actions/AnswersPanel';
import { canSendAgain, hasAnswersPanel } from './actions/row-actions';
import { RowActions } from './actions/RowActions';
import { SendAgainButton } from './actions/SendAgainButton';
import { RoundFiles } from './RoundFiles';
import {
  hasSignedFiles,
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
      {answer.email !== null && (
        // A long address breaks anywhere rather than widen the table.
        <Box component="bdi" dir="ltr" sx={{ overflowWrap: 'anywhere' }}>
          {answer.email}
        </Box>
      )}
      {answer.differsFromStored && (
        <ToneChip label={text.emailDiffers} tone="warning" icon={ErrorOutlineOutlined} />
      )}
    </Box>
  );
}

function StatusCell({ row, isManager }: { row: AssignmentRow; isManager: boolean }) {
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
      {canSendAgain(row) && (
        <Box sx={{ flexBasis: '100%', display: 'grid', gap: 0.5, justifyItems: 'start' }}>
          <Typography variant="body2" component="span">
            {text.notSentAgain}
          </Typography>
          {isManager && <SendAgainButton assignmentId={row.assignmentId} />}
        </Box>
      )}
    </Box>
  );
}

/** Sent / opened / signed: only the dates that exist, one per line. */
function DatesCell({ row }: { row: AssignmentRow }) {
  const dates: [string, string | null][] = [
    [text.dates.sent, row.sentAt],
    [text.dates.opened, row.firstOpenedAt],
    [text.dates.signed, row.signedAt],
  ];
  const shown = dates.flatMap(([label, value]) => (value === null ? [] : [{ label, value }]));
  if (shown.length === 0) return he.rounds.none;
  return (
    <Box
      component="dl"
      sx={{
        m: 0,
        display: 'grid',
        gridTemplateColumns: 'auto auto',
        columnGap: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {shown.map(({ label, value }) => (
        <Box key={label} sx={{ display: 'contents' }}>
          <Typography component="dt" variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>
            {formatDate(value)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

interface ColumnContext {
  isManager: boolean;
  roundId: string;
  roundStatus: RoundStatus;
  openAnswers: (row: AssignmentRow) => void;
}

/**
 * One row per employee; never the ID number (the API doesn't send it). Seven columns so a
 * 1280 px screen shows them all; the last one (document, answers, actions) stays in view on the
 * left edge when a narrower screen scrolls.
 */
function columnsFor({ isManager, roundId, roundStatus, openAnswers }: ColumnContext) {
  const columns: Column<AssignmentRow>[] = [
    {
      key: 'employee',
      header: text.columns.employee,
      render: (row) => (
        <Box sx={{ minWidth: 120 }}>
          <Link component={RouterLink} to={`/employees/${row.employeeId}`}>
            <bdi>
              {row.firstName} {row.lastName}
            </bdi>
          </Link>
          <Typography variant="body2" color="text.secondary">
            <bdi>{text.employeeNumber(row.employeeNumber)}</bdi>
          </Typography>
        </Box>
      ),
    },
    {
      key: 'department',
      header: text.columns.department,
      render: (row) => (
        <Box sx={{ minWidth: 120 }}>
          <bdi>{row.department.label}</bdi>
        </Box>
      ),
    },
    {
      key: 'status',
      header: text.columns.status,
      render: (row) => <StatusCell row={row} isManager={isManager} />,
    },
    { key: 'dates', header: text.columns.dates, render: (row) => <DatesCell row={row} /> },
    {
      key: 'updates',
      header: text.columns.updates,
      render: (row) => (
        <Box>
          <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
            {text.lastUpdate} {formatDate(row.lastUpdateAt)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {text.remindersLabel}: {remindersText(row)}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'emailAnswer',
      header: text.columns.emailAnswer,
      render: (row) =>
        row.emailAnswer ? <EmailAnswer answer={row.emailAnswer} /> : he.rounds.none,
    },
    {
      key: 'actions',
      header: text.columns.actions,
      sticky: 'end',
      render: (row) => (
        <Box sx={{ display: 'grid', gap: 0.75, justifyItems: 'start', whiteSpace: 'nowrap' }}>
          {/* A plain link opened on click only: the API checks the role, logs the view and
              redirects to a 5-minute link. Nothing is fetched before the click. */}
          {row.hasSignedFile && (
            <Link href={documentPath(row.assignmentId)} target="_blank" rel="noreferrer">
              {text.openDocument}
            </Link>
          )}
          {hasAnswersPanel(row) && (
            <Button
              size="small"
              onClick={() => openAnswers(row)}
              aria-label={he.rounds.actions.answersFor(`${row.firstName} ${row.lastName}`)}
              sx={{ px: 0, minWidth: 0 }}
            >
              {he.rounds.actions.answers}
            </Button>
          )}
          {isManager && <RowActions row={row} roundId={roundId} roundStatus={roundStatus} />}
        </Box>
      ),
    },
  ];
  return columns;
}

/**
 * The round's employees (A4, FR-TRK-2): filters in the address (statuses, department at send
 * time, waiting for approval, returned), search text in memory only and sent in a POST body.
 * Fetched again on "רענון", on a page / filter / search change and after an action, never on
 * window focus: a page with email answers writes an audit row on every fetch (NFR-PRV-7).
 */
export function AssignmentsTable({ round }: { round: RoundDetails }) {
  const { query, setQuery } = useTableQuery(assignmentTableQuerySchema);
  const [searchText, setSearchText] = useState('');
  const isManager = useAuthUser().role === 'manager';
  // The row whose answers are open (a copy, so a page change keeps the panel).
  const [answersRow, setAnswersRow] = useState<AssignmentRow | null>(null);

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
  const columns = columnsFor({
    isManager,
    roundId: round.id,
    roundStatus: round.status,
    openAnswers: setAnswersRow,
  });
  // The open row as the table shows it now (after an action), else the copy taken on opening.
  const openRow =
    answersRow === null
      ? null
      : (rows.data?.items.find((row) => row.assignmentId === answersRow.assignmentId) ??
        answersRow);

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
        columns={columns}
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
        compact
      />
      <AnswersPanel row={openRow} isManager={isManager} onClose={() => setAnswersRow(null)} />
    </Box>
  );
}
