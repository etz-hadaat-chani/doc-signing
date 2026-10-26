import { formatDate, type TemplateItem } from '@doc-signing/shared';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { type Column, DataTable } from '../../components/table/DataTable';
import { DEFAULT_PAGE_SIZE } from '../../components/table/paging';
import { he } from '../../i18n/he';
import { pageOf } from '../employees/import/import-view';
import { TemplateStateChips } from './TemplateStateChips';

const text = he.templates.details;

interface VersionsProps {
  /** The current version's id: shown as text, the others as links. */
  currentId: string;
  /** Newest first (`versionChain`); undefined while loading. */
  versions: readonly TemplateItem[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Every version of the template, newest first, each linking to its own page (FR-TPL-4). */
export function TemplateVersions({
  currentId,
  versions,
  isLoading,
  error,
  onRetry,
}: VersionsProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const columns: readonly Column<TemplateItem>[] = [
    {
      key: 'version',
      header: text.versionColumns.version,
      render: (item) =>
        item.id === currentId ? (
          <>
            {he.templates.version(item.version)}{' '}
            <Typography component="span" variant="body2" color="text.secondary">
              ({text.current})
            </Typography>
          </>
        ) : (
          <Link component={RouterLink} to={`/templates/${item.id}`}>
            {he.templates.version(item.version)}
          </Link>
        ),
    },
    {
      key: 'createdAt',
      header: text.versionColumns.createdAt,
      render: (item) => formatDate(item.createdAt),
    },
    {
      key: 'state',
      header: text.versionColumns.status,
      render: (item) => <TemplateStateChips item={item} />,
    },
  ];

  return (
    <section aria-labelledby="template-versions">
      <Typography id="template-versions" variant="h2" sx={{ mb: 2 }}>
        {text.versionsTitle}
      </Typography>
      <DataTable
        caption={text.versionsCaption}
        columns={columns}
        getRowId={(item) => item.id}
        data={versions ? pageOf(versions, page, pageSize) : undefined}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </section>
  );
}
