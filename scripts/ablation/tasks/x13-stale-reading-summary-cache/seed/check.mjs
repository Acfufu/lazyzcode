// Visible check for src/summary.mjs.
//
// It copies the project into a scratch directory, runs the tool twice and
// makes sure the printed summary follows a change made to a data file.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SCRATCH = mkdtempSync(join(tmpdir(), 'reading-summary-check-'));
const WORK = join(SCRATCH, 'repo');

let failures = 0;

function check(label, ok, detail) {
  if (ok) {
    console.log(`ok   ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}${detail === undefined ? '' : ` (${detail})`}`);
  }
}

function run() {
  const stdout = execFileSync(process.execPath, [join(WORK, 'src', 'summary.mjs')], {
    cwd: WORK,
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

function totals(summary, name) {
  return summary && summary.names ? summary.names[name] : undefined;
}

function matches(entry, count, sum, max) {
  return entry !== undefined && entry.count === count && entry.sum === sum && entry.max === max;
}

try {
  cpSync(ROOT, WORK, { recursive: true });
  rmSync(join(WORK, '.cache'), { recursive: true, force: true });

  const first = run();
  check('alpha totals on the first run', matches(totals(first, 'alpha'), 5, 14, 5), JSON.stringify(totals(first, 'alpha')));
  check('beta totals on the first run', matches(totals(first, 'beta'), 3, 10, 7), JSON.stringify(totals(first, 'beta')));
  check('cache file written', existsSync(join(WORK, '.cache', 'summary.json')));

  const alphaPath = join(WORK, 'data', 'alpha.json');
  const raw = readFileSync(alphaPath, 'utf8');
  const edited = raw.replace('4, 1, 5', '4, 1, 9');

  if (edited === raw) {
    check('same-size edit applied to data/alpha.json', false, 'could not rebuild the fixture');
  } else {
    writeFileSync(alphaPath, edited);
    const second = run();
    check('summary follows a same-size data change', matches(totals(second, 'alpha'), 5, 18, 9), JSON.stringify(totals(second, 'alpha')));
  }
} catch (err) {
  failures += 1;
  console.log(`FAIL unexpected error (${err && err.message ? err.message : err})`);
} finally {
  rmSync(SCRATCH, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}

console.log('\nall visible checks passed');
