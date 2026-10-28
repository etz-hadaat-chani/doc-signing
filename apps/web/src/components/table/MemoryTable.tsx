import { useState } from 'react';
import { type Column, DataTable } from './DataTable';
import { DEFAULT_PAGE_SIZE, pageOf } from './paging';

/** A list kept in memory, shown a page at a time (nothing in the address). */
export function MemoryTable<T>({
  caption,
  columns,
  items,
  getRowId,
  emptyText,
}: {
  caption: string;
  columns: readonly Column<T>[];
  items: readonly T[];
  getRowId: (row: T) => string;
  emptyText?: string;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // A shorter list (a row removed) never leaves the table past its last page.
  const lastPage = Math.max(1, Math.ceil(items.length / pageSize));
  const shownPage = Math.min(page, lastPage);
  return (
    <DataTable
      caption={caption}
      columns={columns}
      getRowId={getRowId}
      data={pageOf(items, shownPage, pageSize)}
      isLoading={false}
      error={null}
      page={shownPage}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
      emptyText={emptyText}
    />
  );
}
