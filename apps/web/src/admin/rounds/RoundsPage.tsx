import {
  ROUND_STATUS_LABELS,
  ROUND_STATUSES,
  type RoundListItem,
  roundListQuerySchema,
} from '@doc-signing/shared';
import AddOutlined from '@mui/icons-material/AddOutlined';
import BuildOutlined from '@mui/icons-material/BuildOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router';
import { RoundStatusChip, ToneChip } from '../../components/status/StatusChip';
import { type Column, DataTable } from '../../components/table/DataTable';
import { FilterBar, SelectFilter } from '../../components/table/filters';
import { useTableQuery } from '../../components/table/use-table-query';
import { formatNumber } from '../../i18n/format';
import { he } from '../../i18n/he';
import { useAuthUser } from '../auth/session';
import { optionalDate } from './round-view';
import { fetchRounds, roundKeys } from './rounds.api';

const text = he.rounds.list;

const STATUS_OPTIONS = ROUND_STATUSES.map((status) => ({
  value: status,
  label: ROUND_STATUS_LABELS[status],
}));

const COLUMNS: readonly Column<RoundListItem>[] = [
  {
    key: 'name',
    header: text.columns.name,
    render: (round) => (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        <Link component={RouterLink} to={`/rounds/${round.id}`}>
          <bdi>{round.name}</bdi>
        </Link>
        {round.isCorrection && (
          <ToneChip label={text.correction} tone="info" icon={BuildOutlined} />
        )}
      </Box>
    ),
  },
  {
    key: 'status',
    header: text.columns.status,
    render: (round) => <RoundStatusChip status={round.status} />,
  },
  {
    key: 'documents',
    header: text.columns.documents,
    render: (round) => (
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {round.documents.map((document) => (
          <li key={document.id}>
            <bdi>{he.rounds.documentVersion(document.name, document.version)}</bdi>
          </li>
        ))}
      </Box>
    ),
  },
  {
    key: 'createdAt',
    header: text.columns.createdAt,
    render: (round) =>
      round.draftAgeDays === null ? (
        optionalDate(round.createdAt)
      ) : (
        <>
          {optionalDate(round.createdAt)}
          <Typography
            component="span"
            variant="body2"
            color="text.secondary"
            sx={{ display: 'block' }}
          >
            {he.dashboard.draftAge(round.draftAgeDays)}
          </Typography>
        </>
      ),
  },
  { key: 'sentAt', header: text.columns.sentAt, render: (round) => optionalDate(round.sentAt) },
  {
    key: 'recipients',
    header: text.columns.recipients,
    render: (round) => formatNumber(round.recipients),
  },
  {
    key: 'percentSigned',
    header: text.columns.percentSigned,
    render: (round) =>
      round.percentSigned === null
        ? he.rounds.none
        : he.rounds.percent(formatNumber(round.percentSigned)),
  },
  {
    key: 'linkExpiresAt',
    header: text.columns.linkExpiresAt,
    render: (round) => optionalDate(round.linkExpiresAt),
  },
];

/**
 * Send rounds (A3): every round, newest first, with its status filter in the address (the
 * wizard and the dashboard link `/rounds?status=draft`). Managers also get "סבב חדש"; officers
 * see the same list (the role only hides the button, the API decides).
 */
export function RoundsPage() {
  const { role } = useAuthUser();
  const { query, setQuery } = useTableQuery(roundListQuerySchema);
  const rounds = useQuery({
    queryKey: roundKeys.list(query),
    queryFn: ({ signal }) => fetchRounds(query, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 4 }}>
        <Typography variant="h1">{he.nav.rounds}</Typography>
        <Box sx={{ flex: 1 }} />
        {role === 'manager' && (
          <Button
            variant="contained"
            component={RouterLink}
            to="/rounds/new"
            startIcon={<AddOutlined />}
          >
            {he.nav.newRound}
          </Button>
        )}
      </Box>

      <FilterBar>
        <SelectFilter
          label={text.statusFilter}
          value={query.status}
          options={STATUS_OPTIONS}
          onChange={(value) =>
            setQuery({ status: ROUND_STATUSES.find((status) => status === value) })
          }
        />
      </FilterBar>

      <DataTable
        caption={text.caption}
        columns={COLUMNS}
        getRowId={(round) => round.id}
        data={rounds.data}
        isLoading={rounds.isPending}
        error={rounds.error}
        onRetry={() => void rounds.refetch()}
        page={query.page}
        pageSize={query.pageSize}
        onPageChange={(page) => setQuery({ page })}
        onPageSizeChange={(pageSize) => setQuery({ pageSize })}
        emptyText={text.empty}
      />
    </>
  );
}
