import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router';
import { formatNumber } from '../../i18n/format';
import { tokens } from '../../theme/tokens';

export interface CountTile {
  /** Also the tile's `data-count`, so tests and e2e can find one number. */
  key: string;
  label: string;
  value: number;
  /** The label links here (e.g. a table filtered to this count). */
  to?: string;
  /** A short line under the number. */
  note?: string;
}

const { font, color, layout } = tokens;

/**
 * Numbers as a row of tiles (a list), each a label and a big number. `fit`: as many per row as
 * fit (for longer lists, so a last tile doesn't sit alone); else up to six. A thin accent edge on
 * the start side marks them as numbers.
 */
export function CountTiles({
  tiles,
  label,
  fit = false,
}: {
  tiles: readonly CountTile[];
  label: string;
  fit?: boolean;
}) {
  return (
    <Box
      component="ul"
      aria-label={label}
      sx={{
        listStyle: 'none',
        m: 0,
        p: 0,
        display: 'grid',
        gap: 2,
        gridTemplateColumns: fit
          ? { xs: 'repeat(2, 1fr)', sm: 'repeat(auto-fit, minmax(120px, 1fr))' }
          : { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' },
      }}
    >
      {tiles.map((tile) => (
        <Paper
          component="li"
          variant="outlined"
          key={tile.key}
          data-count={tile.key}
          // The numbers stay on one line when a label wraps.
          sx={{
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            borderInlineStart: `${layout.edgeWidth}px solid ${color.accent}`,
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {tile.to === undefined ? (
              tile.label
            ) : (
              <Link component={RouterLink} to={tile.to}>
                {tile.label}
              </Link>
            )}
          </Typography>
          <Typography
            data-value
            sx={{
              mt: 1,
              fontSize: font.size.stat,
              fontWeight: font.weight.bold,
              lineHeight: 1.2,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatNumber(tile.value)}
          </Typography>
          {tile.note !== undefined && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {tile.note}
            </Typography>
          )}
        </Paper>
      ))}
    </Box>
  );
}
