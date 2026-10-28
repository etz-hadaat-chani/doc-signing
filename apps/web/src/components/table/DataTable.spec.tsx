import { type Paged, pageQuerySchema } from '@doc-signing/shared';
import { screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api/api-error';
import { he } from '../../i18n/he';
import { renderComponent } from '../../test/render';
import { type Column, DataTable } from './DataTable';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from './paging';

interface Row {
  id: string;
  name: string;
}

const columns: Column<Row>[] = [{ key: 'name', header: 'שם', render: (row) => row.name }];

function pageOf(count: number, total: number, page = 1, pageSize = 25): Paged<Row> {
  const items = Array.from({ length: count }, (_, index) => {
    const number = (page - 1) * pageSize + index + 1;
    return { id: `row-${number}`, name: `שורה ${number}` };
  });
  return { items, total, page, pageSize };
}

type Props = Partial<Parameters<typeof DataTable<Row>>[0]>;

function renderTable(props: Props = {}) {
  const handlers = { onPageChange: vi.fn(), onPageSizeChange: vi.fn(), onRetry: vi.fn() };
  const rendered = renderComponent(
    <DataTable<Row>
      caption="טבלת בדיקה"
      columns={columns}
      getRowId={(row) => row.id}
      data={pageOf(25, 60)}
      isLoading={false}
      error={null}
      page={1}
      pageSize={25}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, ...rendered };
}

describe('DataTable', () => {
  it('shows a named table with its header and rows', () => {
    renderTable();
    const table = screen.getByRole('table', { name: 'טבלת בדיקה' });
    expect(within(table).getByRole('columnheader', { name: 'שם' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(26);
    expect(screen.getByText('שורה 1')).toBeInTheDocument();
  });

  it('a sticky column stays on the end edge, header and cells; the others scroll', () => {
    renderTable({
      columns: [
        ...columns,
        { key: 'actions', header: 'פעולות', sticky: 'end', render: () => 'פעולה' },
      ],
    });
    const table = screen.getByRole('table', { name: 'טבלת בדיקה' });
    const header = within(table).getByRole('columnheader', { name: 'פעולות' });
    expect(header).toHaveStyle({ position: 'sticky' });
    expect(within(table).getAllByText('פעולה')[0]).toHaveStyle({ position: 'sticky' });
    expect(within(table).getByRole('columnheader', { name: 'שם' })).not.toHaveStyle({
      position: 'sticky',
    });
  });

  it('shows the Hebrew range and the page-size label', () => {
    renderTable();
    expect(screen.getByText(he.table.displayedRows(1, 25, 60))).toBeInTheDocument();
    expect(screen.getByText(he.table.rowsPerPage)).toBeInTheDocument();
  });

  it('pages 1-based like the API', async () => {
    const { user, onPageChange } = renderTable({ page: 2, data: pageOf(25, 60, 2) });
    await user.click(screen.getByRole('button', { name: he.table.nextPage }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);
    await user.click(screen.getByRole('button', { name: he.table.previousPage }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
    await user.click(screen.getByRole('button', { name: he.table.lastPage }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);
  });

  it('points the arrows right to left: "next" is the left arrow', () => {
    renderTable();
    const next = screen.getByRole('button', { name: he.table.nextPage });
    const previous = screen.getByRole('button', { name: he.table.previousPage });
    expect(next.querySelector('[data-testid="KeyboardArrowLeftIcon"]')).not.toBeNull();
    expect(previous.querySelector('[data-testid="KeyboardArrowRightIcon"]')).not.toBeNull();
  });

  it('offers only page sizes the API accepts, 25 by default', async () => {
    for (const size of PAGE_SIZE_OPTIONS) {
      expect(pageQuerySchema.safeParse({ pageSize: size }).success, String(size)).toBe(true);
    }
    expect(DEFAULT_PAGE_SIZE).toBe(25);

    const { user, onPageSizeChange } = renderTable();
    await user.click(screen.getByRole('combobox'));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(PAGE_SIZE_OPTIONS.map(String));
    await user.click(screen.getByRole('option', { name: '50' }));
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it('shows the loader while the first page loads', () => {
    renderTable({ data: undefined, isLoading: true });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(he.table.rowsPerPage)).not.toBeInTheDocument();
  });

  it('shows the empty text and no paging when nothing matches', () => {
    renderTable({ data: pageOf(0, 0) });
    expect(screen.getByText(he.table.empty)).toBeInTheDocument();
    expect(screen.queryByText(he.table.rowsPerPage)).not.toBeInTheDocument();
  });

  it('shows the error as a section heading, with a retry', async () => {
    const error = new ApiRequestError({ kind: 'network' });
    const { user, onRetry } = renderTable({ data: undefined, error });
    expect(
      screen.getByRole('heading', { level: 2, name: he.feedback.networkTitle }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: he.feedback.retry }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('DataTable selection', () => {
  /** A screen in miniature: a filter (resetKey) and a page size it can change. */
  function SelectableTable() {
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const [filter, setFilter] = useState('all');
    const [pageSize, setPageSize] = useState(25);
    return (
      <>
        <button type="button" onClick={() => setFilter('signed')}>
          filter
        </button>
        <button type="button" onClick={() => setPageSize(50)}>
          size
        </button>
        <DataTable<Row>
          caption="טבלת בדיקה"
          columns={columns}
          getRowId={(row) => row.id}
          data={pageOf(3, 3)}
          isLoading={false}
          error={null}
          page={1}
          pageSize={pageSize}
          onPageChange={() => undefined}
          onPageSizeChange={() => undefined}
          selection={{
            selected,
            onChange: setSelected,
            rowLabel: (row) => row.name,
            resetKey: filter,
          }}
        />
      </>
    );
  }

  const rowBox = (name: string) =>
    screen.getByRole('checkbox', { name: `${he.table.selectRow} ${name}` });

  it('selects one row or the whole page, with Hebrew labels and a count', async () => {
    const { user } = renderComponent(<SelectableTable />);
    await user.click(rowBox('שורה 2'));
    expect(screen.getByRole('status')).toHaveTextContent(he.table.selectedCount(1));

    const all = screen.getByRole('checkbox', { name: he.table.selectAllOnPage });
    expect(all).toHaveAttribute('data-indeterminate', 'true');
    await user.click(all);
    expect(screen.getByRole('status')).toHaveTextContent(he.table.selectedCount(3));
    await user.click(all);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('clears the selection when a filter / the search (resetKey) or the page size change', async () => {
    const { user } = renderComponent(<SelectableTable />);
    await user.click(rowBox('שורה 1'));
    expect(screen.getByRole('status')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'filter' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(rowBox('שורה 1')).not.toBeChecked();

    await user.click(rowBox('שורה 1'));
    await user.click(screen.getByRole('button', { name: 'size' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
