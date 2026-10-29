import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { Link as RouterLink } from 'react-router';
import { he } from '../../i18n/he';
import { useAuthUser } from '../auth/session';

const text = he.manual.tabs;

const TABS = [
  { path: '/manual', label: text.list },
  { path: '/manual/approvals', label: text.approvals },
] as const;

/**
 * The two parts of A10 for a manager: the manual-handling list and "waiting for approval". An
 * officer sees only the approvals part (the list is manager only), so no tabs for them.
 */
export function ManualTabs({ current }: { current: (typeof TABS)[number]['path'] }) {
  const isManager = useAuthUser().role === 'manager';
  if (!isManager) return null;
  return (
    <Tabs value={current} aria-label={text.label} sx={{ mb: 3 }}>
      {TABS.map(({ path, label }) => (
        <Tab key={path} value={path} label={label} component={RouterLink} to={path} />
      ))}
    </Tabs>
  );
}
