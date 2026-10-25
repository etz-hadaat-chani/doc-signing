import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import { Link as RouterLink } from 'react-router';
import { tokens } from '../../theme/tokens';
import type { MenuItem } from '../navigation';

const { color, font, layout, control, focusRing } = tokens;

/** One menu line: outline icon + text. Active = brand color and a thin bar, no filled pill. */
export function SideMenuItem({ item, active }: { item: MenuItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <li>
      <ListItemButton
        component={RouterLink}
        to={item.path}
        aria-current={active ? 'page' : undefined}
        sx={{
          position: 'relative',
          minHeight: control.largeMinHeight,
          gap: 1.5,
          px: 2.5,
          color: active ? color.brand : color.text,
          '&:hover': { bgcolor: color.brandTint },
          // The menu scrolls, which would clip a ring drawn outside the item.
          '&.Mui-focusVisible': { outlineOffset: focusRing.insetOffset },
          '&::before': {
            content: '""',
            position: 'absolute',
            insetBlock: 8,
            insetInlineStart: 0,
            width: layout.activeBarWidth,
            borderRadius: '2px',
            bgcolor: active ? color.brand : 'transparent',
          },
        }}
      >
        <ListItemIcon sx={{ minWidth: 0, color: 'inherit' }}>
          <Icon fontSize="small" aria-hidden />
        </ListItemIcon>
        <ListItemText
          primary={item.label}
          slotProps={{
            primary: {
              sx: {
                fontSize: font.size.body,
                fontWeight: active ? font.weight.semibold : font.weight.regular,
              },
            },
          }}
        />
      </ListItemButton>
    </li>
  );
}
