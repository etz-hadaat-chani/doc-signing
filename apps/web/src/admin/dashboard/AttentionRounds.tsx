import { formatDate, type RoundDetails } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router';
import { RoundStatusChip, StatusChip } from '../../components/status/StatusChip';
import { formatNumber } from '../../i18n/format';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { attentionItems, type DashboardRound, roundStatusPath, sortRounds } from './dashboard-view';

const { font, color, radius } = tokens;

type Progress = RoundDetails['progress'];

/** A round still sending: "sent X of Y" and a bar. Nothing while it loads or if it failed. */
function SendProgress({ progress }: { progress: Progress | undefined }) {
  if (!progress || progress.total === 0) return null;
  const sent = formatNumber(progress.sent);
  const total = formatNumber(progress.total);
  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {he.dashboard.sentProgress(sent, total)}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={Math.round((progress.sent * 100) / progress.total)}
        aria-label={he.dashboard.progressLabel}
        aria-valuetext={he.dashboard.sentProgress(sent, total)}
        sx={{ height: tokens.spacing, borderRadius: `${radius.control}px`, bgcolor: color.border }}
      />
    </Box>
  );
}

function RoundCard({ round, progress }: { round: DashboardRound; progress: Progress | undefined }) {
  const items = attentionItems(round.byStatus);
  const facts = [he.dashboard.recipients(round.total, formatNumber(round.total))];
  if (round.linkExpiresAt) facts.push(he.dashboard.linkExpires(formatDate(round.linkExpiresAt)));

  return (
    <Paper component="li" variant="outlined" sx={{ p: 2.5 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
        <Typography variant="h3" component="h3">
          <Link component={RouterLink} to={`/rounds/${round.id}`}>
            {round.name}
          </Link>
        </Typography>
        <RoundStatusChip status={round.status} />
        <Box sx={{ flex: 1 }} />
        {round.percentSigned !== null && (
          <Typography sx={{ fontWeight: font.weight.medium }}>
            {he.dashboard.percentSigned(formatNumber(round.percentSigned))}
          </Typography>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {facts.join(' · ')}
      </Typography>
      {round.status === 'sending' && <SendProgress progress={progress} />}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mt: 1.5 }}>
        {items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {he.dashboard.nothingToHandle}
          </Typography>
        ) : (
          <>
            <Typography variant="body2">{he.dashboard.needsHandling}</Typography>
            {items.map(({ status, count }) => (
              <Link
                key={status}
                component={RouterLink}
                to={roundStatusPath(round.id, status)}
                data-status={status}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}
              >
                <StatusChip status={status} />
                <Box component="span" data-value sx={{ fontWeight: font.weight.semibold }}>
                  {formatNumber(count)}
                </Box>
              </Link>
            ))}
          </>
        )}
      </Box>
    </Paper>
  );
}

/** Every sending / active round, the ones with most to handle first. */
export function AttentionRounds({
  rounds,
  progressById,
}: {
  rounds: readonly DashboardRound[];
  progressById: ReadonlyMap<string, UseQueryResult<Progress> | undefined>;
}) {
  return (
    <Box component="section" aria-labelledby="dashboard-rounds">
      <Typography variant="h2" id="dashboard-rounds" sx={{ mb: 2 }}>
        {he.dashboard.roundsTitle}
      </Typography>
      {rounds.length === 0 ? (
        <Typography color="text.secondary">{he.dashboard.noActiveRounds}</Typography>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 2 }}>
          {sortRounds(rounds).map((round) => (
            <RoundCard key={round.id} round={round} progress={progressById.get(round.id)?.data} />
          ))}
        </Box>
      )}
    </Box>
  );
}
