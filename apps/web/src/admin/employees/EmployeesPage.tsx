import {
  EMAIL_STATUSES,
  type EmployeeListItem,
  employeeListQuerySchema,
  formatDepartment,
  SEARCH_MAX_LENGTH,
} from '@doc-signing/shared';
import AddOutlined from '@mui/icons-material/AddOutlined';
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { type Column, DataTable } from '../../components/table/DataTable';
import {
  DepartmentFilter,
  FilterBar,
  SearchField,
  SelectFilter,
} from '../../components/table/filters';
import { useTableQuery } from '../../components/table/use-table-query';
import { he } from '../../i18n/he';
import { useAuthUser } from '../auth/session';
import { ActiveMark, EmailStatusMark } from './EmailStatusMark';
import { emailStatusLabel } from './email-status';
import { employeeKeys, fetchEmployees } from './employees.api';
import { useDepartments } from './use-departments';

const EMAIL_STATUS_OPTIONS = EMAIL_STATUSES.map((status) => ({
  value: status,
  label: emailStatusLabel(status),
}));

const ACTIVE_OPTIONS = [
  { value: 'true', label: he.employees.active },
  { value: 'false', label: he.employees.inactive },
];

/** Number, name, department, email status and active only: no other details (NFR-PRV-6). */
const COLUMNS: readonly Column<EmployeeListItem>[] = [
  {
    key: 'employeeNumber',
    header: he.employees.columns.employeeNumber,
    render: (row) => <bdi>{row.employeeNumber}</bdi>,
  },
  {
    key: 'name',
    header: he.employees.columns.name,
    render: (row) => (
      <Link component={RouterLink} to={`/employees/${row.id}`}>
        {row.firstName} {row.lastName}
      </Link>
    ),
  },
  {
    key: 'department',
    header: he.employees.columns.department,
    render: (row) => formatDepartment(row.department.code, row.department.name),
  },
  {
    key: 'emailStatus',
    header: he.employees.columns.emailStatus,
    render: (row) => <EmailStatusMark status={row.emailStatus} />,
  },
  {
    key: 'active',
    header: he.employees.columns.active,
    render: (row) => <ActiveMark isActive={row.isActive} />,
  },
];

/**
 * Employees (A6): every employee with filters in the address (department, email status, active)
 * and a search kept in memory only and sent in a POST body (it may be an ID number). Managers
 * also get "add" and "import"; officers see the same list.
 */
export function EmployeesPage() {
  const { role } = useAuthUser();
  const departments = useDepartments();
  const { query, setQuery } = useTableQuery(employeeListQuerySchema);
  const [searchText, setSearchText] = useState('');

  const request = searchText === '' ? query : { ...query, q: searchText };
  const employees = useQuery({
    queryKey: employeeKeys.list(request),
    queryFn: ({ signal }) => fetchEmployees(request, signal),
    placeholderData: keepPreviousData,
  });

  const search = (text: string) => {
    setSearchText(text.slice(0, SEARCH_MAX_LENGTH));
    if (query.page !== 1) setQuery({ page: 1 });
  };

  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 4 }}>
        <Typography variant="h1">{he.nav.employees}</Typography>
        <Box sx={{ flex: 1 }} />
        {role === 'manager' && (
          <>
            <Button
              variant="outlined"
              component={RouterLink}
              to="/employees/import"
              startIcon={<UploadFileOutlined />}
            >
              {he.nav.employeeImport}
            </Button>
            <Button
              variant="contained"
              component={RouterLink}
              to="/employees/new"
              startIcon={<AddOutlined />}
            >
              {he.employees.add}
            </Button>
          </>
        )}
      </Box>

      <FilterBar>
        <SearchField onSearch={search} />
        <DepartmentFilter
          departments={departments}
          value={query.dept}
          onChange={(dept) => setQuery({ dept })}
        />
        <SelectFilter
          label={he.employees.emailStatusFilter}
          value={query.emailStatus}
          options={EMAIL_STATUS_OPTIONS}
          onChange={(value) =>
            setQuery({ emailStatus: EMAIL_STATUSES.find((status) => status === value) })
          }
        />
        <SelectFilter
          label={he.employees.activeFilter}
          value={query.active === undefined ? undefined : String(query.active)}
          options={ACTIVE_OPTIONS}
          onChange={(value) =>
            setQuery({ active: value === undefined ? undefined : value === 'true' })
          }
        />
      </FilterBar>

      <DataTable
        caption={he.employees.listCaption}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        data={employees.data}
        isLoading={employees.isPending}
        error={employees.error}
        onRetry={() => void employees.refetch()}
        page={query.page}
        pageSize={query.pageSize}
        onPageChange={(page) => setQuery({ page })}
        onPageSizeChange={(pageSize) => setQuery({ pageSize })}
        emptyText={he.employees.empty}
      />
    </>
  );
}
