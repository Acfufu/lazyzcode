import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const run = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));

const expected = [
  'REPORT',
  'runs: 2',
  'latest: 2024-05-03T08:30:00Z',
  'tests: 4',
  '--',
  'db/migrate 1 900.00 900.00',
  'auth/login 2 200.00 100.00',
  'auth/logout 1 40.25 40.25',
  'cache/warm 1 12.75 12.75',
  '',
].join('\n');

try {
  const result = await run(process.execPath, ['src/report.mjs', 'data'], {
    cwd: root,
    timeout: 5000,
  });
  if (result.stdout === expected) {
    console.log('check: PASS');
    process.exit(0);
  }
  console.log('check: FAIL');
  console.log('--- got ---');
  console.log(result.stdout);
  process.exit(1);
} catch (err) {
  console.log('check: FAIL');
  console.log(String(err && err.message ? err.message : err));
  process.exit(1);
}
