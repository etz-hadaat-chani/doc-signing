import { displayStatusSchema, optionalQuery, pageQuerySchema } from '@doc-signing/shared';
import { act, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { he } from '../../i18n/he';
import { renderComponent } from '../../test/render';
import { SEARCH_DELAY_MS, SearchField } from './filters';
import { useTableQuery } from './use-table-query';

const DEPT = '3f1c2b8e-4c1a-4d2e-9b8f-1a2b3c4d5e6f';

const schema = pageQuerySchema.extend({
  status: optionalQuery(displayStatusSchema),
  dept: optionalQuery(z.uuid()),
});

/** Shows the parsed query and offers the changes a screen makes. */
function Harness() {
  const { query, setQuery } = useTableQuery(schema);
  return (
    <>
      <output>{JSON.stringify(query)}</output>
      <button type="button" onClick={() => setQuery({ status: 'signed' })}>
        status
      </button>
      <button type="button" onClick={() => setQuery({ page: 3 })}>
        page
      </button>
      <button type="button" onClick={() => setQuery({ status: undefined, pageSize: 25 })}>
        reset
      </button>
    </>
  );
}

const shown = () => JSON.parse(screen.getByRole('status').textContent ?? '{}') as unknown;

describe('useTableQuery', () => {
  it('reads page, size and filters from the address with the shared schema', () => {
    renderComponent(<Harness />, `/x?page=2&pageSize=50&status=sent&dept=${DEPT}`);
    expect(shown()).toEqual({ page: 2, pageSize: 50, status: 'sent', dept: DEPT });
  });

  it('drops values the schema refuses and keeps the rest', () => {
    renderComponent(<Harness />, '/x?page=-4&pageSize=500&status=nope&dept=not-a-uuid&extra=1');
    expect(shown()).toEqual({ page: 1, pageSize: 25 });
  });

  it('goes back to page 1 on a filter change, and leaves defaults out of the address', async () => {
    const { user, router } = renderComponent(<Harness />, '/x?page=4');
    await user.click(screen.getByRole('button', { name: 'status' }));
    expect(router.state.location.search).toBe('?status=signed');

    await user.click(screen.getByRole('button', { name: 'page' }));
    expect(router.state.location.search).toBe('?page=3&status=signed');

    await user.click(screen.getByRole('button', { name: 'reset' }));
    expect(router.state.location.search).toBe('');
  });
});

describe('useTableQuery types', () => {
  it('refuses a schema with search text (q): it must never reach the address', () => {
    const withSearch = pageQuerySchema.extend({ q: optionalQuery(z.string()) });
    // Never called: typecheck is the test.
    function useWithSearch() {
      // @ts-expect-error search text (it may be an ID number) never goes in the address
      return useTableQuery(withSearch);
    }
    expect(useWithSearch).toBeTypeOf('function');
  });
});

describe('SearchField', () => {
  function SearchHarness({ onSearch }: { onSearch: (text: string) => void }) {
    const [text, setText] = useState('');
    return (
      <>
        <SearchField
          onSearch={(value) => {
            setText(value);
            onSearch(value);
          }}
        />
        <p>{`sent:${text}`}</p>
      </>
    );
  }

  it('keeps the text out of the address and router state, and sends it on Enter', async () => {
    const onSearch = vi.fn();
    const { user, router } = renderComponent(<SearchHarness onSearch={onSearch} />, '/x?page=2');
    const field = screen.getByRole('searchbox', { name: he.filters.search });
    expect(field).toHaveAttribute('autocomplete', 'off');

    await user.type(field, ' 123456782 {Enter}');
    expect(onSearch).toHaveBeenCalledWith('123456782');
    expect(router.state.location.search).toBe('?page=2');
    expect(router.state.location.state).toBeNull();
    expect(globalThis.location.href).not.toContain('123456782');
  });

  it('sends after a pause in typing, once per new text', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const onSearch = vi.fn();
      const { user } = renderComponent(<SearchHarness onSearch={onSearch} />);
      await user.type(screen.getByRole('searchbox'), 'כהן');
      expect(onSearch).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS));
      expect(onSearch).toHaveBeenCalledTimes(1);
      expect(onSearch).toHaveBeenCalledWith('כהן');
      await user.keyboard('{Enter}');
      expect(onSearch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
