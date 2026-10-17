import { IMPORT_MAX_ROWS } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_EXTRA_HEADERS,
  FIXTURE_HEADERS,
  type FixtureRow,
  harGalXlsx,
  loadWorkbook,
} from '../../../../test/fixtures/har-gal-workbook.js';
import { AppException } from '../../../common/errors/app.exception.js';
import { readHarGalSheet } from './har-gal-sheet.js';

const row: FixtureRow = {
  employeeNumber: 2001,
  idNumber: 12345674,
  firstName: 'דנה',
  lastName: 'כהן',
  department: '15 - ממלאות מקום ירושלים',
};

async function read(rows: (FixtureRow | null)[], options?: Parameters<typeof harGalXlsx>[1]) {
  return readHarGalSheet(await loadWorkbook(await harGalXlsx(rows, options)));
}

async function failure(promise: Promise<unknown>): Promise<AppException> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  return error as AppException;
}

describe('readHarGalSheet', () => {
  it('finds the columns by header in any order and reads only those', async () => {
    const [first] = await read([row]);
    expect(first?.rowNumber).toBe(2);
    expect(first?.cells).toEqual({
      employeeNumber: { kind: 'number', value: 2001 },
      idNumber: { kind: 'number', value: 12345674 },
      firstName: { kind: 'text', value: 'דנה' },
      lastName: { kind: 'text', value: 'כהן' },
      department: { kind: 'text', value: '15 - ממלאות מקום ירושלים' },
      email: null,
      landlinePrefix: null,
      landline: null,
      mobilePrefix: null,
      mobile: null,
    });
    expect(Object.values(first?.extras ?? {}).every((cell) => cell === null)).toBe(true);
  });

  it('reads the extra columns when present; only תאריך לידה keeps a date cell as a date', async () => {
    const headers = [...FIXTURE_HEADERS, ...FIXTURE_EXTRA_HEADERS];
    const [first] = await read(
      [
        {
          ...row,
          birthDate: new Date('1980-05-03T00:00:00Z'),
          jobPercent: 50,
          city: new Date('2020-01-01T00:00:00Z'),
          studyFund: ' הראל ',
        },
      ],
      { headers },
    );
    expect(first?.extras).toMatchObject({
      birthDate: { kind: 'date', value: '1980-05-03' },
      jobPercent: { kind: 'number', value: 50 },
      city: { kind: 'text', value: '2020-01-01T00:00:00.000Z' },
      studyFund: { kind: 'text', value: 'הראל' },
      address: null,
    });
  });

  it('a missing extra column is fine; one twice fails the file', async () => {
    const some = [...FIXTURE_HEADERS, 'כתובת'];
    expect(await read([row], { headers: some })).toHaveLength(1);
    const error = await failure(read([row], { headers: [...some, 'כתובת'] }));
    expect(error.code).toBe('IMPORT_DUPLICATE_COLUMN');
    expect(error.details).toEqual({ columns: ['כתובת'] });
  });

  it('skips empty rows and keeps the Excel row numbers', async () => {
    const rows = await read([row, null, { ...row, employeeNumber: 2002 }]);
    expect(rows.map(({ rowNumber }) => rowNumber)).toEqual([2, 4]);
  });

  it('finds the header row below a title line', async () => {
    const rows = await read([row], { titleRows: ['דוח עובדים', ''] });
    expect(rows.map(({ rowNumber }) => rowNumber)).toEqual([4]);
  });

  it('fails the file when a header is missing, naming it', async () => {
    const headers = FIXTURE_HEADERS.filter((header) => header !== 'E-Mail' && header !== 'טלפון');
    const error = await failure(read([row], { headers }));
    expect(error.code).toBe('IMPORT_MISSING_COLUMNS');
    expect(error.details).toEqual({ columns: ['E-Mail', 'טלפון'] });
  });

  it('needs the exact header text', async () => {
    const headers = FIXTURE_HEADERS.map((header) => (header === 'E-Mail' ? 'Email' : header));
    expect((await failure(read([row], { headers }))).details).toEqual({ columns: ['E-Mail'] });
  });

  it('fails the file with no header row at all', async () => {
    const error = await failure(read([row], { headers: ['a', 'b'] }));
    expect(error.code).toBe('IMPORT_MISSING_COLUMNS');
    expect((error.details?.columns as string[]).length).toBe(10);
  });

  it('fails the file when a header appears twice', async () => {
    const error = await failure(read([row], { headers: [...FIXTURE_HEADERS, 'מחלקה'] }));
    expect(error.code).toBe('IMPORT_DUPLICATE_COLUMN');
    expect(error.details).toEqual({ columns: ['מחלקה'] });
  });

  it('fails a file with no employee rows', async () => {
    expect((await failure(read([null]))).code).toBe('IMPORT_NO_ROWS');
  });

  it(`accepts ${IMPORT_MAX_ROWS} rows and refuses one more`, async () => {
    const many = Array.from({ length: IMPORT_MAX_ROWS }, () => row);
    expect(await read(many)).toHaveLength(IMPORT_MAX_ROWS);
    const error = await failure(read([...many, row]));
    expect(error.code).toBe('IMPORT_TOO_MANY_ROWS');
  }, 30_000);
});
