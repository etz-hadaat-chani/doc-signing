import { formatTime } from '@doc-signing/shared';
import AddOutlined from '@mui/icons-material/AddOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useEffect } from 'react';
import { Link as RouterLink } from 'react-router';
import { errorContent } from '../../components/feedback/error-content';
import { ErrorState } from '../../components/feedback/ErrorState';
import { PageLoader } from '../../components/feedback/PageLoader';
import { useNotify } from '../../components/notifications/notify-context';
import { he } from '../../i18n/he';
import { useAuthUser } from '../auth/session';
import { AttentionRounds } from './AttentionRounds';
import { OpenDrafts } from './OpenDrafts';
import { StatTiles } from './StatTiles';
import { useDashboard } from './use-dashboard';

/**
 * Dashboard (A2, FR-TRK-1): totals across active rounds, every active round with what needs
 * handling, and the open drafts. Officers see the same data without action buttons; the role
 * only hides buttons, the API decides.
 */
export function DashboardPage() {
  const { role } = useAuthUser();
  const notify = useNotify();
  const { summary, drafts, progressById, refreshing, refresh } = useDashboard();
  const { data, error, isRefetchError, errorUpdatedAt } = summary;

  // A failed refresh keeps the numbers on screen and says so once.
  useEffect(() => {
    if (isRefetchError) notify.error(errorContent(error).message);
  }, [isRefetchError, errorUpdatedAt, error, notify]);

  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 4 }}>
        <Typography variant="h1">{he.nav.dashboard}</Typography>
        <Box sx={{ flex: 1 }} />
        {data && (
          <>
            <Typography variant="body2" color="text.secondary">
              {he.dashboard.updatedAt(formatTime(new Date(summary.dataUpdatedAt)))}
            </Typography>
            <Button
              variant="outlined"
              startIcon={<RefreshOutlined />}
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              {refreshing ? he.dashboard.refreshing : he.dashboard.refresh}
            </Button>
          </>
        )}
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

      {summary.isPending ? (
        <PageLoader />
      ) : !data ? (
        <ErrorState
          {...errorContent(error)}
          headingComponent="h2"
          onRetry={() => void summary.refetch()}
        />
      ) : data.activeRounds === 0 && data.drafts.count === 0 ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: 'center' }}>
          <Typography variant="h2" sx={{ mb: 1 }}>
            {he.dashboard.emptyTitle}
          </Typography>
          <Typography color="text.secondary">{he.dashboard.emptyText}</Typography>
        </Paper>
      ) : (
        <Box sx={{ display: 'grid', gap: 5 }}>
          <StatTiles summary={data} />
          <AttentionRounds rounds={data.rounds} progressById={progressById} />
          {data.drafts.count > 0 && <OpenDrafts count={data.drafts.count} drafts={drafts} />}
        </Box>
      )}
    </>
  );
}
