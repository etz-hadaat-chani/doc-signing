import type { UserRole } from '@doc-signing/shared';
import AddCircleOutlineOutlined from '@mui/icons-material/AddCircleOutlineOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import ManageAccountsOutlined from '@mui/icons-material/ManageAccountsOutlined';
import PendingActionsOutlined from '@mui/icons-material/PendingActionsOutlined';
import PeopleOutlined from '@mui/icons-material/PeopleOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import SpaceDashboardOutlined from '@mui/icons-material/SpaceDashboardOutlined';
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import type SvgIcon from '@mui/material/SvgIcon';
import { he } from '../i18n/he';

export type MenuGroup = 'work' | 'setup';

export interface AdminPage {
  path: string;
  label: string;
  /** Who may open the page. The API still checks every request (401 / 403). */
  roles: readonly UserRole[];
  /** The task that builds the real screen (shown on the placeholder until then). */
  task: string;
  /** Shown in the side menu (to `roles` of the menu entry, default: the page's roles). */
  menu?: { group: MenuGroup; icon: typeof SvgIcon; roles?: readonly UserRole[] };
  /** Only while developing (`pnpm dev`): left out of the production build. */
  devOnly?: boolean;
}

const ALL_STAFF = ['manager', 'officer'] as const;
const MANAGER = ['manager'] as const;

const ALL_PAGES: readonly AdminPage[] = [
  {
    path: '/',
    label: he.nav.dashboard,
    roles: ALL_STAFF,
    task: '5.1',
    menu: { group: 'work', icon: SpaceDashboardOutlined },
  },
  {
    path: '/rounds',
    label: he.nav.rounds,
    roles: ALL_STAFF,
    task: '5.6',
    menu: { group: 'work', icon: SendOutlined },
  },
  {
    path: '/rounds/new',
    label: he.nav.newRound,
    roles: MANAGER,
    task: '5.5',
    menu: { group: 'work', icon: AddCircleOutlineOutlined },
  },
  { path: '/rounds/:roundId', label: he.nav.roundDetails, roles: ALL_STAFF, task: '5.6' },
  {
    path: '/employees',
    label: he.nav.employees,
    roles: ALL_STAFF,
    task: '5.2',
    menu: { group: 'work', icon: PeopleOutlined },
  },
  {
    path: '/employees/import',
    label: he.nav.employeeImport,
    roles: MANAGER,
    task: '5.3',
    menu: { group: 'work', icon: UploadFileOutlined },
  },
  { path: '/employees/new', label: he.nav.employeeNew, roles: MANAGER, task: '5.2' },
  { path: '/employees/:employeeId', label: he.nav.employeeCard, roles: ALL_STAFF, task: '5.2' },
  {
    path: '/employees/:employeeId/edit',
    label: he.nav.employeeEdit,
    roles: MANAGER,
    task: '5.2',
  },
  {
    path: '/manual',
    label: he.nav.manual,
    roles: MANAGER,
    task: '5.7',
    menu: { group: 'work', icon: PendingActionsOutlined },
  },
  {
    // For a manager this is a tab inside "טיפול ידני"; an officer sees only this part of A10.
    path: '/manual/approvals',
    label: he.nav.approvals,
    roles: ALL_STAFF,
    task: '5.7',
    menu: { group: 'work', icon: FactCheckOutlined, roles: ['officer'] },
  },
  {
    path: '/templates',
    label: he.nav.templates,
    roles: MANAGER,
    task: '5.4',
    menu: { group: 'setup', icon: DescriptionOutlined },
  },
  { path: '/templates/new', label: he.nav.templateNew, roles: MANAGER, task: '5.4' },
  { path: '/templates/:templateId', label: he.nav.templateDetails, roles: MANAGER, task: '5.4' },
  {
    path: '/settings',
    label: he.nav.settings,
    roles: MANAGER,
    task: '5.8',
    menu: { group: 'setup', icon: SettingsOutlined },
  },
  {
    path: '/users',
    label: he.nav.users,
    roles: MANAGER,
    task: '5.8',
    menu: { group: 'setup', icon: ManageAccountsOutlined },
  },
  {
    // Every shared component with made-up data (4.2). Developers only: not in any menu.
    path: '/demo/components',
    label: he.nav.componentsDemo,
    roles: MANAGER,
    task: '4.2',
    devOnly: true,
  },
];

/**
 * Every page of the management area, once (PRD §7, §9). Both the side menu and the role check
 * of every route come from this list, so they can't drift apart. Menu order = list order.
 * Dev-only pages exist only in `pnpm dev` (and tests).
 */
export const ADMIN_PAGES: readonly AdminPage[] = import.meta.env.DEV
  ? ALL_PAGES
  : ALL_PAGES.filter((page) => !page.devOnly);

export interface MenuItem {
  path: string;
  label: string;
  icon: typeof SvgIcon;
  group: MenuGroup;
}

/**
 * The menu item to mark for an address: the longest item path that the address is, or is
 * inside (`/rounds/12` → `/rounds`, `/rounds/new` → `/rounds/new`). `/` marks only itself.
 */
export function activeMenuPath(pathname: string, items: readonly MenuItem[]): string | null {
  let best: string | null = null;
  for (const { path } of items) {
    const matches =
      path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
    if (matches && (best === null || path.length > best.length)) best = path;
  }
  return best;
}

/** The side menu for a role, in list order. */
export function menuFor(role: UserRole): MenuItem[] {
  return ADMIN_PAGES.flatMap((page) => {
    if (!page.menu) return [];
    const menuRoles = page.menu.roles ?? page.roles;
    if (!menuRoles.includes(role) || !page.roles.includes(role)) return [];
    return [{ path: page.path, label: page.label, icon: page.menu.icon, group: page.menu.group }];
  });
}
