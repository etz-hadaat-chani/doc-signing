import { formatDate, type RoundDetails } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { optionalDate } from './round-view';

const text = he.rounds.details;

function documents(round: RoundDetails): ReactNode {
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {round.templates.map((item) => (
        <li key={`${item.departmentId ?? 'all'}-${item.template.id}`}>
          {item.department !== null && text.documentFor(item.department)}
          <bdi>{he.rounds.documentVersion(item.template.name, item.template.version)}</bdi>
        </li>
      ))}
    </Box>
  );
}

function remindersText({ settings }: RoundDetails): string {
  return settings.remindersEnabled
    ? text.remindersText(settings.reminderIntervalDays, settings.maxReminders)
    : text.remindersOff;
}

/** The round's facts (A4 header) as a description list. */
export function RoundHeader({ round }: { round: RoundDetails }) {
  const facts: { label: string; value: ReactNode }[] = [
    { label: text.documents, value: documents(round) },
    { label: text.createdBy, value: <bdi>{round.createdBy.fullName}</bdi> },
    { label: text.createdAt, value: formatDate(round.createdAt) },
    { label: text.sentAt, value: round.sentAt === null ? text.notSent : formatDate(round.sentAt) },
    { label: text.linkExpiresAt, value: optionalDate(round.linkExpiresAt) },
    { label: text.linkExpiryDays, value: text.linkExpiryDaysText(round.settings.linkExpiryDays) },
    { label: text.reminders, value: remindersText(round) },
  ];

  return (
    <Paper variant="outlined" component="section" aria-label={text.infoLabel} sx={{ p: 3 }}>
      {round.correctionOf && (
        <Typography sx={{ mb: 2 }}>
          {text.correctionOf}{' '}
          <Link component={RouterLink} to={`/rounds/${round.correctionOf.roundId}`}>
            <bdi>{round.correctionOf.roundName}</bdi>
          </Link>
        </Typography>
      )}
      <Box
        component="dl"
        sx={{
          m: 0,
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
        }}
      >
        {facts.map(({ label, value }) => (
          <Box key={label}>
            <Typography
              component="dt"
              color="text.secondary"
              sx={{ fontSize: tokens.font.size.small }}
            >
              {label}
            </Typography>
            <Typography component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>
              {value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
