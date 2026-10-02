import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Catalog } from './src/catalog.mjs';

const INTRO = '# Intro\nhello\n';
const GUIDE = '# Guide\n';
const GUIDE2 = '# Updated Guide\nwith more text\n';

let failures = 0;

const check = (name, cond, detail) => {
  if (cond) {
    console.log('ok   ' + name);
  } else {
    failures += 1;
    console.log('FAIL ' + name + ' (got: ' + detail + ')');
  }
};

const dir = await mkdtemp(path.join(tmpdir(), 'catalog-check-'));

try {
  await writeFile(path.join(dir, 'intro.md'), INTRO);
  await writeFile(path.join(dir, 'guide.md'), GUIDE);

  const catalog = new Catalog(dir);
  const first = catalog.list();

  check('two markdown files are indexed', first.length === 2, JSON.stringify(first));
  check('slugs are correct', first.map((e) => e.slug).join(',') === 'guide,intro', first.map((e) => e.slug).join(','));
  check('titles are read', first[0].title === 'Guide' && first[1].title === 'Intro', JSON.stringify(first));
  check('sizes are read', first[0].bytes === Buffer.byteLength(GUIDE), String(first[0].bytes));

  await writeFile(path.join(dir, 'guide.md'), GUIDE2);

  const second = catalog.list();
  const guide = second.find((e) => e.slug === 'guide');

  check('an edited file shows its new title', guide !== undefined && guide.title === 'Updated Guide', JSON.stringify(second));
  check('an edited file shows its new size', guide !== undefined && guide.bytes === Buffer.byteLength(GUIDE2), guide === undefined ? 'missing' : String(guide.bytes));
  check('the rebuild is counted', catalog.rebuildCount >= 2, String(catalog.rebuildCount));
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}

console.log('all checks passed');
process.exit(0);
