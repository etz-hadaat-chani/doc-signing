import { describe, expect, it } from 'vitest';
import { PAGE, testPdf } from '../../../test/fixtures/pdf.js';
import { readPdfContent } from './pdf-content.js';

const limits = { maxPages: 50 };

async function contentOf(bytes: Buffer) {
  const result = await readPdfContent(bytes, limits);
  if (!result.ok) throw new Error(`expected a readable PDF, got ${result.problem}`);
  return result.content;
}

async function problemOf(bytes: Buffer) {
  const result = await readPdfContent(bytes, limits);
  return result.ok ? null : result.problem;
}

describe('readPdfContent: readable PDFs', () => {
  it('reads one A4 page, with nothing active', async () => {
    expect(await contentOf(await testPdf())).toEqual({
      pageCount: 1,
      pages: [{ width: PAGE.a4[0], height: PAGE.a4[1], rotation: 0 }],
      hasFormFields: false,
      hasActiveContent: false,
    });
  });

  it('reads each page of a file with different page sizes', async () => {
    const content = await contentOf(
      await testPdf({ pages: [PAGE.a4, PAGE.letter, PAGE.a3Landscape] }),
    );
    expect(content.pageCount).toBe(3);
    expect(content.pages.map(({ width, height }) => [width, height])).toEqual([
      [...PAGE.a4],
      [...PAGE.letter],
      [...PAGE.a3Landscape],
    ]);
  });

  it('uses the visible area (CropBox) when it is smaller than the paper', async () => {
    const content = await contentOf(await testPdf({ cropFirstPage: [10, 20, 300, 400] }));
    expect(content.pages[0]).toMatchObject({ width: 300, height: 400 });
  });

  it('reports a rotated page', async () => {
    const content = await contentOf(await testPdf({ rotateFirstPage: true }));
    expect(content.pages[0]?.rotation).toBe(90);
  });

  it('reports fillable form fields', async () => {
    const content = await contentOf(await testPdf({ formField: true }));
    expect(content.hasFormFields).toBe(true);
    expect(content.hasActiveContent).toBe(false);
  });

  it('reports JavaScript that runs when the file opens', async () => {
    expect((await contentOf(await testPdf({ openActionScript: true }))).hasActiveContent).toBe(
      true,
    );
  });

  it('reports an auto-action on a page', async () => {
    expect((await contentOf(await testPdf({ pageAutoAction: true }))).hasActiveContent).toBe(true);
  });
});

describe('readPdfContent: refused files', () => {
  it('a password-protected (encrypted) file → encrypted', async () => {
    expect(await problemOf(await testPdf({ encrypted: true }))).toBe('encrypted');
  });

  it('a file cut in half → invalid', async () => {
    const bytes = await testPdf();
    expect(await problemOf(bytes.subarray(0, Math.floor(bytes.length / 2)))).toBe('invalid');
  });

  it.each([
    ['plain text named .pdf', Buffer.from('this is not a pdf')],
    ['PNG bytes', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
    ['a header and nothing else', Buffer.from('%PDF-1.7\nhello\n%%EOF')],
    ['an empty file', Buffer.alloc(0)],
  ])('%s → invalid', async (_name, bytes) => {
    expect(await problemOf(bytes)).toBe('invalid');
  });

  it('a header after the first 1 KB → invalid', async () => {
    const bytes = Buffer.concat([Buffer.alloc(2000, 0x20), await testPdf()]);
    expect(await problemOf(bytes)).toBe('invalid');
  });

  it('more pages than allowed → too_many_pages', async () => {
    const bytes = await testPdf({ pages: [PAGE.a4, PAGE.a4, PAGE.a4] });
    expect(await readPdfContent(bytes, { maxPages: 2 })).toEqual({
      ok: false,
      problem: 'too_many_pages',
    });
  });
});
