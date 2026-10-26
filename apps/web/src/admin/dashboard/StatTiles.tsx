import { type DashboardSummary, STATUS_LABELS } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { DISPLAY_STATUS_LOOKS, TONE_STYLES } from '../../components/status/status-tones';
import { formatNumber } from '../../i18n/format';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { TOTAL_TILES } from './dashboard-view';

const { font } = tokens;

/** FR-TRK-1: the totals across sending and active rounds, one number tile per status. */
export function StatTiles({ summary }: { summary: DashboardSummary }) {
  const { totals, activeRounds } = summary;
  return (
    <Box component="section" aria-labelledby="dashboard-totals">
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 2, mb: 2 }}>
        <Typography variant="h2" id="dashboard-totals">
          {he.dashboard.totalsTitle}
        </Typography>
        <Typography color="text.secondary">
          {he.dashboard.activeRounds(activeRounds, formatNumber(activeRounds))}
          {totals.percentSigned !== null &&
            ` · ${he.dashboard.percentSigned(formatNumber(totals.percentSigned))}`}
        </Typography>
      </Box>
      <Box
        component="ul"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(5, 1fr)' },
        }}
      >
        {TOTAL_TILES.map((status) => {
          const look = DISPLAY_STATUS_LOOKS[status];
          const Icon = look.icon;
          return (
            <Paper
              component="li"
              variant="outlined"
              key={status}
              data-status={status}
              sx={{ p: 2 }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Icon
                  aria-hidden
                  sx={{ fontSize: font.size.section, color: TONE_STYLES[look.tone].color }}
                />
                <Typography variant="body2" color="text.secondary">
                  {STATUS_LABELS[status]}
                </Typography>
              </Box>
              <Typography
                data-value
                sx={{
                  mt: 1,
                  fontSize: font.size.stat,
                  fontWeight: font.weight.semibold,
                  lineHeight: 1.2,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatNumber(totals.byStatus[status] ?? 0)}
              </Typography>
            </Paper>
          );
        })}
      </Box>
    </Box>
  );
}
