import { type EmployeeHistoryItem, formatDate } from '@doc-signing/shared';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { StatusChip } from '../../components/status/StatusChip';
import { type Column, DataTable } from '../../components/table/DataTable';
import { DEFAULT_PAGE_SIZE } from '../../components/table/paging';
import { he } from '../../i18n/he';
import { documentPath, employeeKeys, fetchEmployeeHistory } from './employees.api';

const text = he.employees.history;
const none = he.employees.emptyValue;

const optionalDate = (value: string | null) => (value ? formatDate(value) : none);

const COLUMNS: readonly Column<EmployeeHistoryItem>[] = [
  {
    key: 'round',
    header: text.round,
    render: (item) => (
      <Link component={RouterLink} to={`/rounds/${item.round.id}`}>
        {item.round.name}
      </Link>
    ),
  },
  {
    key: 'document',
    header: text.document,
    render: (item) =>
      item.document ? text.documentVersion(item.document.name, item.document.version) : none,
  },
  { key: 'department', header: text.department, render: (item) => item.department.label },
  {
    key: 'status',
    header: text.status,
    render: (item) => <StatusChip status={item.displayStatus} />,
  },
  { key: 'sentAt', header: text.sentAt, render: (item) => optionalDate(item.sentAt) },
  { key: 'signedAt', header: text.signedAt, render: (item) => optionalDate(item.signedAt) },
  {
    key: 'file',
    header: text.file,
    // The API checks the role, logs the view and redirects to a short-lived link.
    render: (item) =>
      item.hasSignedFile ? (
        <Link href={documentPath(item.assignmentId)} target="_blank" rel="noreferrer">
          {text.openDocument}
        </Link>
      ) : (
        none
      ),
  },
];

/** The employee's rounds, newest first (A7, FR-TRK-5). Paged in memory: the address stays short. */
export function EmployeeHistory({ employeeId }: { employeeId: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const history = useQuery({
    queryKey: employeeKeys.history(employeeId, page, pageSize),
    queryFn: ({ signal }) => fetchEmployeeHistory(employeeId, page, pageSize, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <section aria-labelledby="employee-history-title">
      <Typography id="employee-history-title" variant="h2" sx={{ mb: 2 }}>
        {text.title}
      </Typography>
      <DataTable
        caption={text.title}
        columns={COLUMNS}
        getRowId={(item) => item.assignmentId}
        data={history.data}
        isLoading={history.isPending}
        error={history.error}
        onRetry={() => void history.refetch()}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        emptyText={text.empty}
      />
    </section>
  );
}
