import { useIsFetching, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dashboardKeys,
  fetchDashboardSummary,
  fetchOpenDrafts,
  fetchRoundDetails,
} from './dashboard.api';

/**
 * The dashboard's data. "Real time" = refetched when the tab is shown again or the window gets
 * focus (once the data is older than the 30 s default), and by the "רענון" button. Never on a
 * timer: every request extends the 30-minute idle session, so a forgotten screen must go quiet.
 */
export function useDashboard() {
  const queryClient = useQueryClient();
  const summary = useQuery({
    queryKey: dashboardKeys.summary,
    queryFn: ({ signal }) => fetchDashboardSummary(signal),
    refetchOnWindowFocus: true,
  });

  const drafts = useQuery({
    queryKey: dashboardKeys.drafts,
    queryFn: ({ signal }) => fetchOpenDrafts(signal),
    enabled: (summary.data?.drafts.count ?? 0) > 0,
    refetchOnWindowFocus: true,
  });

  const sendingIds = (summary.data?.rounds ?? [])
    .filter((round) => round.status === 'sending')
    .map((round) => round.id);
  const progress = useQueries({
    queries: sendingIds.map((roundId) => ({
      queryKey: dashboardKeys.round(roundId),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchRoundDetails(roundId, signal),
      select: (details: Awaited<ReturnType<typeof fetchRoundDetails>>) => details.progress,
      refetchOnWindowFocus: true,
    })),
  });
  const progressById = new Map(sendingIds.map((roundId, index) => [roundId, progress[index]]));

  const refreshing = useIsFetching({ queryKey: dashboardKeys.all }) > 0;
  const refresh = () => queryClient.refetchQueries({ queryKey: dashboardKeys.all, type: 'active' });

  return { summary, drafts, progressById, refreshing, refresh };
}
