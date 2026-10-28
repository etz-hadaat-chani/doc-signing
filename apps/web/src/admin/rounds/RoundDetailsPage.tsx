import { formatTime } from '@doc-signing/shared';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { z } from 'zod';
import { errorContent } from '../../components/feedback/error-content';
import { ErrorState } from '../../components/feedback/ErrorState';
import { PageLoader } from '../../components/feedback/PageLoader';
import { useNotify } from '../../components/notifications/notify-context';
import { RoundStatusChip } from '../../components/status/StatusChip';
import { isApiRequestError } from '../../api/api-error';
import { he } from '../../i18n/he';
import { useAuthUser } from '../auth/session';
import { RoundActions } from './actions/RoundActions';
import { AssignmentsTable } from './AssignmentsTable';
import { RoundCounts, RoundDepartments, SendProgress } from './RoundCounts';
import { RoundHeader } from './RoundHeader';
import { sendingRefetchInterval } from './round-view';
import { fetchRound, roundKeys } from './rounds.api';

const text = he.rounds.details;

const isUuid = (value: string) => z.uuid().safeParse(value).success;

function NotFound() {
  return (
    <ErrorState
      variant="notFound"
      title={he.feedback.notFoundTitle}
      message={he.feedback.notFoundText}
    />
  );
}

/**
 * Round details (A4): the header, sending progress, counts by status and by department, and the
 * employee table with export and ZIP. Managers and officers see the same data. Refreshed by
 * "רענון", on window focus (the details, not the table) and after actions (RoundActions, the
 * table's row actions); while the round is
 * sending, its details also every few seconds, capped (`sendingRefetchInterval`).
 */
export function RoundDetailsPage() {
  const { roundId = '' } = useParams();
  const validId = isUuid(roundId);
  const queryClient = useQueryClient();
  const notify = useNotify();
  const isManager = useAuthUser().role === 'manager';
  // Fetches of the details counted from here; "רענון" starts the count again.
  const pollStart = useRef(0);

  const details = useQuery({
    queryKey: roundKeys.details(roundId),
    queryFn: ({ signal }) => fetchRound(roundId, signal),
    enabled: validId,
    // Always stale: every window focus fetches the details again (the table never: audit rows).
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      sendingRefetchInterval(
        query.state.data?.status,
        query.state.dataUpdateCount + query.state.errorUpdateCount - pollStart.current,
      ),
  });
  const refreshing = useIsFetching({ queryKey: roundKeys.round(roundId) }) > 0;
  const status = details.data?.status;
  const { isRefetchError, error, errorUpdatedAt } = details;

  // Sending finished: the table and counts change with it, so fetch the table once more.
  const previousStatus = useRef(status);
  useEffect(() => {
    if (previousStatus.current === 'sending' && status !== 'sending') {
      void queryClient.invalidateQueries({ queryKey: roundKeys.round(roundId) });
    }
    previousStatus.current = status;
  }, [status, roundId, queryClient]);

  // A failed refresh keeps the data on screen and says so once.
  useEffect(() => {
    if (isRefetchError) notify.error(errorContent(error).message);
  }, [isRefetchError, errorUpdatedAt, error, notify]);

  if (!validId) return <NotFound />;
  if (details.isPending) return <PageLoader />;
  if (!details.data) {
    if (isApiRequestError(details.error) && details.error.status === 404) return <NotFound />;
    return <ErrorState {...errorContent(details.error)} onRetry={() => void details.refetch()} />;
  }

  const round = details.data;
  const refresh = () => {
    const state = queryClient.getQueryState(roundKeys.details(roundId));
    pollStart.current = (state?.dataUpdateCount ?? 0) + (state?.errorUpdateCount ?? 0);
    void queryClient.refetchQueries({ queryKey: roundKeys.round(roundId), type: 'active' });
  };

  return (
    <Box sx={{ display: 'grid', gap: 4 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
        <Typography variant="h1">
          <bdi>{round.name}</bdi>
        </Typography>
        <RoundStatusChip status={round.status} />
        {round.draftAgeDays !== null && (
          <Typography color="text.secondary">
            {he.dashboard.draftAge(round.draftAgeDays)}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography variant="body2" color="text.secondary">
          {text.updatedAt(formatTime(new Date(details.dataUpdatedAt)))}
        </Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshOutlined />}
          onClick={refresh}
          disabled={refreshing}
        >
          {refreshing ? text.refreshing : text.refresh}
        </Button>
      </Box>

      {round.status === 'draft' && <Typography color="text.secondary">{text.draftHint}</Typography>}
      {/* Managers only: the role hides the buttons, the API decides. */}
      {isManager && <RoundActions round={round} />}
      <RoundHeader round={round} />
      {round.status === 'sending' && round.progress && <SendProgress progress={round.progress} />}
      <RoundCounts round={round} />
      {round.departments.length > 0 && <RoundDepartments round={round} />}
      <AssignmentsTable round={round} />
    </Box>
  );
}
