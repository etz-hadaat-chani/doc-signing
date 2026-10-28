import { type RoundDetails, STATUS_LABELS } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router';
import { type CountTile, CountTiles } from '../../components/stats/CountTiles';
import { StatusChip } from '../../components/status/StatusChip';
import type { Column } from '../../components/table/DataTable';
import { MemoryTable } from '../../components/table/MemoryTable';
import { formatNumber } from '../../i18n/format';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { statusCounts } from './round-view';

const text = he.rounds.details;

/** "Sent X of Y" while the round is sending (FR-RND-6). */
export function SendProgress({ progress }: { progress: NonNullable<RoundDetails['progress']> }) {
  if (progress.total === 0) return null;
  const sent = formatNumber(progress.sent);
  const total = formatNumber(progress.total);
  return (
    <Paper variant="outlined" component="section" aria-labelledby="round-progress" sx={{ p: 3 }}>
      <Typography variant="h2" id="round-progress" sx={{ mb: 1 }}>
        {text.progressTitle}
      </Typography>
      <Typography sx={{ mb: 1 }}>
        {he.dashboard.sentProgress(sent, total)}
        {progress.failed > 0 && ` · ${text.progressFailed(formatNumber(progress.failed))}`}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={Math.round((progress.sent * 100) / progress.total)}
        aria-label={he.dashboard.progressLabel}
        aria-valuetext={he.dashboard.sentProgress(sent, total)}
        sx={{
          height: tokens.spacing,
          borderRadius: `${tokens.radius.control}px`,
          bgcolor: tokens.color.border,
        }}
      />
    </Paper>
  );
}

const statusPath = (status: string) => `?${new URLSearchParams({ status }).toString()}`;

/**
 * Counts by display status, in `DISPLAY_STATUSES` order: "returned for correction" is its own
 * tile apart from "cancelled". Each label filters the table to that status.
 */
export function RoundCounts({ round }: { round: RoundDetails }) {
  const { counts } = round;
  const tiles: CountTile[] = [
    {
      key: 'total',
      label: text.total,
      value: counts.total,
      note:
        counts.percentSigned === null
          ? undefined
          : text.percentSigned(formatNumber(counts.percentSigned)),
    },
    ...statusCounts(counts.byStatus).map(({ status, count }) => ({
      key: status,
      label: STATUS_LABELS[status],
      value: count,
      to: statusPath(status),
      note:
        status === 'cancelled' && counts.cancelledInactiveAtSend > 0
          ? text.cancelledInactive(formatNumber(counts.cancelledInactiveAtSend))
          : undefined,
    })),
  ];
  return (
    <Box component="section" aria-labelledby="round-counts">
      <Typography variant="h2" id="round-counts" sx={{ mb: 2 }}>
        {text.countsTitle}
      </Typography>
      <CountTiles tiles={tiles} label={text.countsTitle} />
    </Box>
  );
}

type DepartmentCounts = RoundDetails['departments'][number];

const DEPARTMENT_COLUMNS: readonly Column<DepartmentCounts>[] = [
  {
    key: 'department',
    header: text.departmentColumns.department,
    render: (department) => (
      <Link
        component={RouterLink}
        to={`?${new URLSearchParams({ dept: department.id }).toString()}`}
      >
        <bdi>{department.label}</bdi>
      </Link>
    ),
  },
  {
    key: 'total',
    header: text.departmentColumns.total,
    render: (department) => formatNumber(department.total),
  },
  {
    key: 'percentSigned',
    header: text.departmentColumns.percentSigned,
    render: (department) =>
      department.percentSigned === null
        ? he.rounds.none
        : he.rounds.percent(formatNumber(department.percentSigned)),
  },
  {
    key: 'statuses',
    header: text.departmentColumns.statuses,
    render: (department) => (
      <Box
        component="ul"
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexWrap: 'wrap', gap: 1 }}
      >
        {statusCounts(department.byStatus).map(({ status, count }) => (
          <Box
            component="li"
            key={status}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            <StatusChip status={status} />
            <span>{formatNumber(count)}</span>
          </Box>
        ))}
      </Box>
    ),
  },
];

/** The same counts per department at send time ("15 - name", by code as the API orders them). */
export function RoundDepartments({ round }: { round: RoundDetails }) {
  return (
    <Box component="section" aria-labelledby="round-departments">
      <Typography variant="h2" id="round-departments" sx={{ mb: 2 }}>
        {text.departmentsTitle}
      </Typography>
      <MemoryTable
        caption={text.departmentsCaption}
        columns={DEPARTMENT_COLUMNS}
        items={round.departments}
        getRowId={(department) => department.id}
      />
    </Box>
  );
}
