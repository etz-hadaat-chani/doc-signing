import type { Paged } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Paper from '@mui/material/Paper';
import type { Theme } from '@mui/material/styles';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { type ReactNode, useEffect, useRef } from 'react';
import { he } from '../../i18n/he';
import { tokens } from '../../theme/tokens';
import { errorContent } from '../feedback/error-content';
import { ErrorState } from '../feedback/ErrorState';
import { PageLoader } from '../feedback/PageLoader';
import { PAGE_SIZE_OPTIONS } from './paging';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  width?: number | string;
  /**
   * `end`: the column stays on the end edge (the left in RTL) while a wide table scrolls, so
   * its actions are always in view.
   */
  sticky?: 'end';
}

/** A sticky column needs its own background and a line where the scrolled cells pass under it. */
function stickySx(column: Pick<Column<unknown>, 'sticky'>, header: boolean) {
  if (column.sticky !== 'end') return {};
  return {
    position: 'sticky',
    insetInlineEnd: 0,
    zIndex: header ? 3 : 2,
    bgcolor: 'background.paper',
    borderInlineStart: 1,
    borderInlineStartColor: 'divider',
    // The row's hover shade over the opaque background, as the other cells show it.
    '.MuiTableRow-hover:hover > &': {
      backgroundImage: (theme: Theme) =>
        `linear-gradient(${theme.palette.action.hover}, ${theme.palette.action.hover})`,
    },
  } as const;
}

export interface TableSelection<T> {
  /** Ids of the selected rows (from `getRowId`), across pages. */
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
  /** Names a row for screen readers: "בחירת השורה <name>". */
  rowLabel: (row: T) => string;
  /**
   * Built by the screen from its filters and search text. When it (or the page size) changes,
   * the selection is cleared, so an action never includes rows the user can no longer see.
   */
  resetKey: string;
  /** Buttons for the selected rows, shown above the table while some are selected. */
  actions?: ReactNode;
  /** Rows the action can take (default all); the others show a disabled checkbox. */
  selectable?: (row: T) => boolean;
}

interface DataTableProps<T> {
  /** The table's accessible name. */
  caption: string;
  columns: readonly Column<T>[];
  getRowId: (row: T) => string;
  /** The API's answer for the current page; undefined until the first one arrives. */
  data: Paged<T> | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  /** 1-based, like the API. */
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  emptyText?: string;
  selection?: TableSelection<T>;
  /** Half the side padding in every cell: a wide table (many columns) that must fit 1280 px. */
  compact?: boolean;
}

/**
 * A list page from the API (`{ items, total, page, pageSize }`), paged on the server. The
 * screen keeps page and filters (useTableQuery) and runs the query; this only shows it.
 */
export function DataTable<T>({
  caption,
  columns,
  getRowId,
  data,
  isLoading,
  error,
  onRetry,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  emptyText = he.table.empty,
  selection,
  compact = false,
}: DataTableProps<T>) {
  useClearSelectionOn(selection, `${selection?.resetKey ?? ''}|${pageSize}`);

  const rows = data?.items ?? [];
  const columnCount = columns.length + (selection ? 1 : 0);
  const pageIds = rows.map(getRowId);

  let body: ReactNode;
  if (error) {
    body = (
      <MessageRow columnCount={columnCount}>
        <ErrorState {...errorContent(error)} headingComponent="h2" onRetry={onRetry} />
      </MessageRow>
    );
  } else if (isLoading && !data) {
    body = (
      <MessageRow columnCount={columnCount}>
        <PageLoader />
      </MessageRow>
    );
  } else if (rows.length === 0) {
    body = (
      <MessageRow columnCount={columnCount}>
        <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
          {emptyText}
        </Typography>
      </MessageRow>
    );
  } else {
    body = rows.map((row, index) => {
      const id = pageIds[index] ?? '';
      const isSelected = selection?.selected.has(id) ?? false;
      const canSelect = selection?.selectable?.(row) ?? true;
      return (
        <TableRow key={id} hover selected={isSelected}>
          {selection && (
            <TableCell padding="checkbox">
              <Checkbox
                checked={isSelected}
                disabled={!canSelect && !isSelected}
                onChange={() => selection.onChange(toggled(selection.selected, [id], !isSelected))}
                slotProps={{
                  input: { 'aria-label': `${he.table.selectRow} ${selection.rowLabel(row)}` },
                }}
              />
            </TableCell>
          )}
          {columns.map((column) => (
            <TableCell key={column.key} sx={stickySx(column, false)}>
              {column.render(row)}
            </TableCell>
          ))}
        </TableRow>
      );
    });
  }

  // The page checkbox takes only the rows the action can take.
  const selectable = selection?.selectable;
  const selectableIds = selectable ? rows.filter(selectable).map(getRowId) : pageIds;
  const selectedOnPage = selection
    ? selectableIds.filter((id) => selection.selected.has(id)).length
    : 0;
  const allOnPage = selectableIds.length > 0 && selectedOnPage === selectableIds.length;
  const lastPage = data ? Math.max(0, Math.ceil(data.total / pageSize) - 1) : 0;

  return (
    <Paper variant="outlined" sx={{ borderRadius: `${tokens.radius.table}px`, overflow: 'hidden' }}>
      {selection && selection.selected.size > 0 && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            px: 2,
            py: 1,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Typography role="status">{he.table.selectedCount(selection.selected.size)}</Typography>
          {selection.actions}
        </Box>
      )}
      <TableContainer>
        <Table
          aria-label={caption}
          sx={compact ? { '& .MuiTableCell-root': { paddingInline: 1 } } : undefined}
        >
          <TableHead>
            <TableRow>
              {selection && (
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={allOnPage}
                    indeterminate={selectedOnPage > 0 && !allOnPage}
                    disabled={selectableIds.length === 0}
                    onChange={() =>
                      selection.onChange(toggled(selection.selected, selectableIds, !allOnPage))
                    }
                    slotProps={{ input: { 'aria-label': he.table.selectAllOnPage } }}
                  />
                </TableCell>
              )}
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  sx={{
                    fontWeight: tokens.font.weight.semibold,
                    width: column.width,
                    ...stickySx(column, true),
                  }}
                >
                  {column.header}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>{body}</TableBody>
        </Table>
      </TableContainer>
      {data && data.total > 0 && !error && (
        <TablePagination
          component="div"
          count={data.total}
          page={Math.min(page - 1, lastPage)}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[...PAGE_SIZE_OPTIONS]}
          onPageChange={(_event, zeroBased) => onPageChange(zeroBased + 1)}
          onRowsPerPageChange={(event) => onPageSizeChange(Number(event.target.value))}
          labelRowsPerPage={he.table.rowsPerPage}
          labelDisplayedRows={({ from, to, count }) => he.table.displayedRows(from, to, count)}
          getItemAriaLabel={(type) => PAGE_BUTTON_LABELS[type]}
          showFirstButton
          showLastButton
          sx={{ borderTop: 1, borderColor: 'divider' }}
        />
      )}
    </Paper>
  );
}

const PAGE_BUTTON_LABELS = {
  first: he.table.firstPage,
  previous: he.table.previousPage,
  next: he.table.nextPage,
  last: he.table.lastPage,
} as const;

function MessageRow({ columnCount, children }: { columnCount: number; children: ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={columnCount} sx={{ borderBottom: 0 }}>
        {children}
      </TableCell>
    </TableRow>
  );
}

function toggled(selected: ReadonlySet<string>, ids: readonly string[], add: boolean) {
  const next = new Set(selected);
  for (const id of ids) {
    if (add) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** Empties the selection when `key` changes (not on the first render). */
function useClearSelectionOn<T>(selection: TableSelection<T> | undefined, key: string) {
  const latest = useRef(selection);
  const previousKey = useRef(key);
  useEffect(() => {
    latest.current = selection;
  });
  useEffect(() => {
    if (previousKey.current === key) return;
    previousKey.current = key;
    const current = latest.current;
    if (current && current.selected.size > 0) current.onChange(new Set());
  }, [key]);
}
