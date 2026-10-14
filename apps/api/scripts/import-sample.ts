// Writes a made-up Har Gal employee export with one case of everything (new, updated, unchanged,
// warnings and planted errors), to try the import preview by hand. Development only; fake people.
// Usage: pnpm import:sample [path]   (default: sample-har-gal.xlsx in the repo root)
//
// The rows match the seed (pnpm db:seed). The API test also marks 1002 and 1003 as bounced and
// gives 1004 a phone first; without that, 1002 shows only its email change and 1004 only its
// department change.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_ROWS } from '../test/fixtures/har-gal-sample.js';
import { harGalXlsx } from '../test/fixtures/har-gal-workbook.js';

const defaultPath = fileURLToPath(new URL('../../../sample-har-gal.xlsx', import.meta.url));
const path = resolve(process.argv[2] ?? defaultPath);
writeFileSync(path, await harGalXlsx(SAMPLE_ROWS));
console.log(`Wrote ${path}`);
