import type { Paged, RoundListItem } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router';
import { errorContent } from '../../components/feedback/error-content';
import { ErrorState } from '../../components/feedback/ErrorState';
import { PageLoader } from '../../components/feedback/PageLoader';
import { RoundStatusChip } from '../../components/status/StatusChip';
import { formatNumber } from '../../i18n/format';
import { he } from '../../i18n/he';

/** Drafts not sent yet: a forgotten one keeps its employees busy (3.11). */
export function OpenDrafts({
  count,
  drafts,
}: {
  count: number;
  drafts: UseQueryResult<Paged<RoundListItem>>;
}) {
  return (
    <Box component="section" aria-labelledby="dashboard-drafts">
      <Typography variant="h2" id="dashboard-drafts">
        {he.dashboard.draftsTitle(formatNumber(count))}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
        {he.dashboard.draftsHint}
      </Typography>
      {drafts.isPending ? (
        <PageLoader />
      ) : drafts.isError && !drafts.data ? (
        <ErrorState
          {...errorContent(drafts.error)}
          headingComponent="h3"
          onRetry={() => void drafts.refetch()}
        />
      ) : (
        <>
          <Paper variant="outlined" component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {drafts.data.items.map((draft, index) => (
              <Box
                component="li"
                key={draft.id}
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 1.5,
                  px: 2.5,
                  py: 1.5,
                  borderTop: index === 0 ? 'none' : 1,
                  borderColor: 'divider',
                }}
              >
                <Link component={RouterLink} to={`/rounds/${draft.id}`}>
                  {draft.name}
                </Link>
                <RoundStatusChip status={draft.status} />
                <Box sx={{ flex: 1 }} />
                {draft.draftAgeDays !== null && (
                  <Typography variant="body2" color="text.secondary">
                    {he.dashboard.draftAge(draft.draftAgeDays)}
                  </Typography>
                )}
              </Box>
            ))}
          </Paper>
          {drafts.data.total > drafts.data.items.length && (
            <Link
              component={RouterLink}
              to="/rounds?status=draft"
              sx={{ display: 'inline-block', mt: 1.5 }}
            >
              {he.dashboard.allDrafts}
            </Link>
          )}
        </>
      )}
    </Box>
  );
}
