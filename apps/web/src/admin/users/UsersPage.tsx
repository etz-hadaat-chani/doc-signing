import { formatDate, formatTime, pageQuerySchema, type StaffUser } from '@doc-signing/shared';
import AddOutlined from '@mui/icons-material/AddOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ToneChip } from '../../components/status/StatusChip';
import { INACTIVE_LOOK } from '../../components/status/status-tones';
import { type Column, DataTable } from '../../components/table/DataTable';
import { useTableQuery } from '../../components/table/use-table-query';
import { he } from '../../i18n/he';
import { useAuthUser } from '../auth/session';
import { AddUserDialog } from './AddUserDialog';
import { UserActions } from './UserActions';
import { fetchUsers, userKeys } from './users.api';

const text = he.users;

function columnsFor(actorId: string): Column<StaffUser>[] {
  return [
    {
      key: 'name',
      header: text.columns.name,
      render: (user) =>
        user.id === actorId ? (
          <>
            {user.fullName} {text.you}
          </>
        ) : (
          user.fullName
        ),
    },
    {
      key: 'email',
      header: text.columns.email,
      // One line: an address must not break at its hyphen.
      render: (user) => (
        <Box component="bdi" dir="ltr" sx={{ whiteSpace: 'nowrap' }}>
          {user.email}
        </Box>
      ),
    },
    { key: 'role', header: text.columns.role, render: (user) => he.roles[user.role] },
    {
      key: 'status',
      header: text.columns.status,
      render: (user) =>
        user.isActive ? (
          text.active
        ) : (
          <ToneChip label={text.inactive} tone={INACTIVE_LOOK.tone} icon={INACTIVE_LOOK.icon} />
        ),
    },
    {
      key: 'lastLogin',
      header: text.columns.lastLogin,
      render: (user) =>
        user.lastLoginAt === null ? (
          <Typography component="span" color="text.secondary">
            {text.neverLoggedIn}
          </Typography>
        ) : (
          <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
            {text.lastLogin(formatDate(user.lastLoginAt), formatTime(user.lastLoginAt))}
          </Box>
        ),
    },
    {
      key: 'actions',
      header: text.columns.actions,
      render: (user) => <UserActions user={user} actorId={actorId} />,
    },
  ];
}

/**
 * Staff users (A12, FR-ADM-1), managers only: who can sign in, with which role, and when they
 * last did. Add, change role, disable / enable, reset a password. Only page and page size in the
 * address; passwords never leave the dialogs' memory except in a request body.
 */
export function UsersPage() {
  const me = useAuthUser();
  const [adding, setAdding] = useState(false);
  const { query, setQuery } = useTableQuery(pageQuerySchema);
  const users = useQuery({
    queryKey: userKeys.list(query),
    queryFn: ({ signal }) => fetchUsers(query, signal),
    placeholderData: keepPreviousData,
  });
  const columns = useMemo(() => columnsFor(me.id), [me.id]);

  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 4 }}>
        <Typography variant="h1">{he.nav.users}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setAdding(true)}>
          {text.add}
        </Button>
      </Box>

      <DataTable
        caption={text.listCaption}
        columns={columns}
        getRowId={(user) => user.id}
        data={users.data}
        isLoading={users.isPending}
        error={users.error}
        onRetry={() => void users.refetch()}
        page={query.page}
        pageSize={query.pageSize}
        onPageChange={(page) => setQuery({ page })}
        onPageSizeChange={(pageSize) => setQuery({ pageSize })}
        emptyText={text.empty}
      />

      <AddUserDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}
