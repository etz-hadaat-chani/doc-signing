import {
  formatDate,
  formatDepartment,
  MANUAL_KINDS,
  manualListQuerySchema,
  type ManualRow,
  MAX_UNLOCKS,
  SEARCH_MAX_LENGTH,
} from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { ToneChip } from '../../components/status/StatusChip';
import { MANUAL_KIND_LOOKS, MANUAL_READY_LOOK } from '../../components/status/status-tones';
import { type Column, DataTable } from '../../components/table/DataTable';
import {
  DepartmentFilter,
  FilterBar,
  SearchField,
  SelectFilter,
} from '../../components/table/filters';
import { useTableQuery } from '../../components/table/use-table-query';
import { he } from '../../i18n/he';
import { ActiveMark, EmailStatusMark } from '../employees/EmailStatusMark';
import { useDepartments } from '../employees/use-departments';
import { fetchRounds, roundKeys } from '../rounds/rounds.api';
import { fetchManual, manualKeys, type ManualRequest } from './manual.api';
import { ManualRowActions } from './ManualRowActions';
import { ManualTabs } from './ManualTabs';
import { SendDialog } from './SendDialog';

const text = he.manual;

const KIND_OPTIONS = MANUAL_KINDS.map((kind) => ({ value: kind, label: text.kinds[kind] }));

/** Rounds offered in the round filter: the newest page of the round list. */
const ROUND_OPTIONS_QUERY = { page: 1, pageSize: 100 } as const;

const nameOf = (row: ManualRow) => `${row.employee.firstName} ${row.employee.lastName}`;

/** Lines under the reason: ready, what is missing (names only), lock, expiry, the given email. */
function ReasonCell({ row }: { row: ManualRow }) {
  const kindLook = MANUAL_KIND_LOOKS[row.kind];
  return (
    <Box sx={{ display: 'grid', gap: 0.5, justifyItems: 'start' }}>
      <ToneChip label={text.kinds[row.kind]} tone={kindLook.tone} icon={kindLook.icon} />
      {row.ready && (
        <ToneChip
          label={text.ready[row.ready]}
          tone={MANUAL_READY_LOOK.tone}
          icon={MANUAL_READY_LOOK.icon}
        />
      )}
      {row.missing.length > 0 && (
        <Typography variant="body2">{text.missing(row.missing.join(', '))}</Typography>
      )}
      {row.locked && (
        <>
          <Typography variant="body2">{text.locked}</Typography>
          <Typography variant="body2">{text.unlocksLeft(row.unlocksLeft, MAX_UNLOCKS)}</Typography>
        </>
      )}
      {row.linkExpired && <Typography variant="body2">{text.linkExpired}</Typography>}
      {row.emailCorrection && (
        <Box>
          <Typography variant="body2">{text.corrected}</Typography>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            <bdi dir="ltr">{row.emailCorrection.stored ?? text.noStored}</bdi>
            {' ← '}
            <bdi dir="ltr">{row.emailCorrection.given}</bdi>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {text.harGal}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function columnsFor(onSent: () => void): readonly Column<ManualRow>[] {
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
          {!row.employee.isActive && <ActiveMark isActive={false} />}
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
          {row.documentName && (
            <Typography variant="body2" color="text.secondary">
              <bdi>{row.documentName}</bdi>
            </Typography>
          )}
        </Box>
      ),
    },
    {
      key: 'department',
      header: text.columns.department,
      render: (row) => formatDepartment(row.department.code, row.department.name),
    },
    { key: 'reason', header: text.columns.reason, render: (row) => <ReasonCell row={row} /> },
    {
      key: 'email',
      header: text.columns.email,
      render: (row) => (
        <Box sx={{ display: 'grid', gap: 0.5, justifyItems: 'start' }}>
          <EmailStatusMark status={row.employee.emailStatus} />
          {row.newEmail && (
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              <bdi dir="ltr">{row.newEmail}</bdi>
            </Typography>
          )}
        </Box>
      ),
    },
    {
      key: 'dates',
      header: text.columns.dates,
      render: (row) => (
        <Box sx={{ display: 'grid', gap: 0.25 }}>
          {row.sentAt && (
            <Typography variant="body2">
              {text.dates.sent} {formatDate(row.sentAt)}
            </Typography>
          )}
          {row.signedAt && (
            <Typography variant="body2">
              {text.dates.signed} {formatDate(row.signedAt)}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      key: 'actions',
      header: text.columns.actions,
      sticky: 'end',
      render: (row) => <ManualRowActions row={row} onSent={onSent} />,
    },
  ];
}

/**
 * Manual handling (A10, FR-MAN-1 to FR-MAN-4, Flow 7), managers only: everyone who can't sign
 * through a link, across rounds. Filters (round, department at send, kind) in the address; the
 * search text only in memory and a POST body. Ready rows can be sent one by one or together
 * (the selection clears when a filter or the search changes).
 */
export function ManualHandlingPage() {
  const departments = useDepartments();
  const { query, setQuery } = useTableQuery(manualListQuerySchema);
  const [searchText, setSearchText] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState(false);
  // Names of the rows on the pages where rows were checked: a refused row may be on another page.
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());

  const request: ManualRequest = searchText === '' ? query : { ...query, q: searchText };
  const rows = useQuery({
    queryKey: manualKeys.list(request),
    queryFn: ({ signal }) => fetchManual(request, signal),
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
    roundOptions.push({ value: query.roundId, label: text.chosenRound });
  }

  const search = (value: string) => {
    setSearchText(value.slice(0, SEARCH_MAX_LENGTH));
    if (query.page !== 1) setQuery({ page: 1 });
  };
  const clearSelection = () => setSelected(new Set());
  const resetKey = JSON.stringify([query.roundId, query.dept, query.kind, searchText]);

  return (
    <>
      <Typography variant="h1" sx={{ mb: 1 }}>
        {he.nav.manual}
      </Typography>
      <ManualTabs current="/manual" />
      <Typography color="text.secondary" sx={{ mb: 4 }}>
        {text.intro}
      </Typography>

      <FilterBar>
        <SearchField onSearch={search} />
        <SelectFilter
          label={text.roundFilter}
          value={query.roundId}
          options={roundOptions}
          onChange={(roundId) => setQuery({ roundId })}
        />
        <DepartmentFilter
          departments={departments}
          value={query.dept}
          onChange={(dept) => setQuery({ dept })}
        />
        <SelectFilter
          multiple
          label={text.kindFilter}
          value={query.kind ?? []}
          options={KIND_OPTIONS}
          onChange={(values) =>
            setQuery({
              kind:
                values.length === 0 ? undefined : MANUAL_KINDS.filter((k) => values.includes(k)),
            })
          }
        />
      </FilterBar>

      <DataTable
        caption={text.listCaption}
        columns={columnsFor(clearSelection)}
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
        selection={{
          selected,
          onChange: (next) => {
            const shown = rows.data?.items ?? [];
            setNames(
              (known) =>
                new Map([
                  ...known,
                  ...shown.map((row) => [row.assignmentId, nameOf(row)] as const),
                ]),
            );
            setSelected(next);
          },
          rowLabel: nameOf,
          resetKey,
          selectable: (row) => row.ready !== null,
          actions: (
            <Button variant="contained" size="small" onClick={() => setSending(true)}>
              {text.send.selected}
            </Button>
          ),
        }}
      />
      {sending && (
        <SendDialog
          assignmentIds={[...selected]}
          nameOf={(id) => names.get(id) ?? he.rounds.none}
          onClose={() => setSending(false)}
          onSent={clearSelection}
        />
      )}
    </>
  );
}
