import { type ApprovalRow, approvalsQuerySchema, formatDate } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { ToneChip } from '../../components/status/StatusChip';
import { DISPLAY_STATUS_LOOKS } from '../../components/status/status-tones';
import { type Column, DataTable } from '../../components/table/DataTable';
import { FilterBar, SelectFilter } from '../../components/table/filters';
import { useTableQuery } from '../../components/table/use-table-query';
import { he } from '../../i18n/he';
import { useAuthUser } from '../auth/session';
import { type AnswersRow, AnswersPanel } from '../rounds/actions/AnswersPanel';
import { fetchRounds, roundKeys } from '../rounds/rounds.api';
import { fetchApprovals, manualKeys } from './manual.api';
import { ManualTabs } from './ManualTabs';

const text = he.manual.approvals;
const REASON_LOOK = DISPLAY_STATUS_LOOKS.waiting_for_approval;

/** Rounds offered in the round filter: the newest page of the round list. */
const ROUND_OPTIONS_QUERY = { page: 1, pageSize: 100 } as const;

const nameOf = (row: ApprovalRow) => `${row.employee.firstName} ${row.employee.lastName}`;
const answersRowOf = (row: ApprovalRow): AnswersRow => ({
  assignmentId: row.assignmentId,
  firstName: row.employee.firstName,
  lastName: row.employee.lastName,
});

function columnsFor(openAnswers: (row: ApprovalRow) => void): readonly Column<ApprovalRow>[] {
  return [
    {
      key: 'employee',
      header: text.columns.employee,
      render: (row) => (
        <Box sx={{ display: 'grid', gap: 0.25, justifyItems: 'start' }}>
          <Link component={RouterLink} to={`/employees/${row.employee.id}`}>
            <bdi>{nameOf(row)}</bdi>
          </Link>
          <Typography variant="body2" color="text.secondary">
            {he.rounds.table.employeeNumber(row.employee.employeeNumber)}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'round',
      header: text.columns.round,
      render: (row) => (
        <Box sx={{ display: 'grid', gap: 0.25, justifyItems: 'start' }}>
          <Link component={RouterLink} to={`/rounds/${row.round.id}`}>
            <bdi>{row.round.name}</bdi>
          </Link>
          <Typography variant="body2" color="text.secondary">
            <bdi>{row.document.name}</bdi> · {text.version(row.document.version)}
          </Typography>
          {row.round.isCorrection && <Typography variant="body2">{text.correction}</Typography>}
        </Box>
      ),
    },
    { key: 'department', header: text.columns.department, render: (row) => row.department.label },
    {
      key: 'reasons',
      header: text.columns.reasons,
      render: (row) => (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {row.reasons.map((reason) => (
            <ToneChip
              key={reason.key}
              label={reason.label}
              tone={REASON_LOOK.tone}
              icon={REASON_LOOK.icon}
            />
          ))}
        </Box>
      ),
    },
    {
      key: 'signed',
      header: text.columns.signed,
      render: (row) => (
        <Box sx={{ display: 'grid', gap: 0.25 }}>
          <Typography variant="body2">{formatDate(row.signedAt)}</Typography>
          <Typography variant="body2" color="text.secondary">
            {text.signMethods[row.signMethod]}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'actions',
      header: text.columns.actions,
      sticky: 'end',
      render: (row) => (
        <Button
          size="small"
          variant="outlined"
          aria-label={he.rounds.actions.answersFor(nameOf(row))}
          onClick={() => openAnswers(row)}
        >
          {he.rounds.actions.answers}
        </Button>
      ),
    },
  ];
}

/**
 * "Waiting for approval" (A10, FR-TRK-6): signed documents with an answer that needs approval.
 * Managers and officers; the round filter and paging in the address. A row opens the answers
 * panel of the round details (A4): managers approve, return with a note, then send again;
 * officers read only (no buttons; the API decides anyway).
 */
export function ApprovalsPage() {
  const isManager = useAuthUser().role === 'manager';
  const { query, setQuery } = useTableQuery(approvalsQuerySchema);
  const [answersOf, setAnswersOf] = useState<AnswersRow | null>(null);

  const rows = useQuery({
    queryKey: manualKeys.approvals(query),
    queryFn: ({ signal }) => fetchApprovals(query, signal),
    placeholderData: keepPreviousData,
  });
  const rounds = useQuery({
    queryKey: roundKeys.list(ROUND_OPTIONS_QUERY),
    queryFn: ({ signal }) => fetchRounds(ROUND_OPTIONS_QUERY, signal),
  });
  const roundOptions = (rounds.data?.items ?? [])
    .filter((round) => round.status !== 'draft')
    .map((round) => ({ value: round.id, label: round.name }));
  // A round from a link that isn't among the newest still shows as chosen.
  if (query.roundId && !roundOptions.some(({ value }) => value === query.roundId)) {
    roundOptions.push({ value: query.roundId, label: he.manual.chosenRound });
  }

  return (
    <>
      <Typography variant="h1" sx={{ mb: 1 }}>
        {isManager ? he.nav.manual : he.nav.approvals}
      </Typography>
      <ManualTabs current="/manual/approvals" />
      <Typography color="text.secondary" sx={{ mb: 4 }}>
        {text.intro}
      </Typography>

      <FilterBar>
        <SelectFilter
          label={he.manual.roundFilter}
          value={query.roundId}
          options={roundOptions}
          onChange={(roundId) => setQuery({ roundId })}
        />
      </FilterBar>

      <DataTable
        caption={text.listCaption}
        columns={columnsFor((row) => setAnswersOf(answersRowOf(row)))}
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
      <AnswersPanel row={answersOf} isManager={isManager} onClose={() => setAnswersOf(null)} />
    </>
  );
}
