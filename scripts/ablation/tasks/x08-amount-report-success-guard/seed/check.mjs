import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (args) =>
  new Promise((resolve) => {
    execFile(process.execPath, args, (err, stdout) => {
      const text = String(stdout ?? '');
      if (!err) resolve({ code: 0, stdout: text });
      else resolve({ code: typeof err.code === 'number' ? err.code : 1, stdout: text });
    });
  });

const dir = await mkdtemp(join(tmpdir(), 'report-check-'));
const theFile = join(dir, 'input.csv');
const problems = [];

const check = async (label, content, wantedCode, wantedStdout) => {
  await writeFile(theFile, content);
  const got = await run(['src/cli.mjs', theFile]);
  if (got.code !== wantedCode) {
    problems.push(label + ': exit code ' + got.code + ', wanted ' + wantedCode);
  }
  if (got.stdout !== wantedStdout) {
    problems.push(label + ': output was ' + JSON.stringify(got.stdout) + ', wanted ' + JSON.stringify(wantedStdout));
  }
};

await check('happy path', 'id,category,amount\nr1,books,1200\nr2,toys,300\nr3,books,-200\n', 0, 'books 2 1000\ntoys 1 300\nSUCCESS rows=3 groups=2 total=1300\n');

await writeFile(theFile, 'id,category,amount\nr1,books,12x0\n');
const bad = await run(['src/cli.mjs', theFile]);
if (bad.code === 0) problems.push('bad amount: exit code was 0');
if (bad.stdout.indexOf('SUCCESS') !== -1) problems.push('bad amount: a success line was printed');
if (bad.stdout.split('\n')[0] !== 'ERROR line 2: bad amount') {
  problems.push('bad amount: first line was ' + JSON.stringify(bad.stdout.split('\n')[0]));
}

await check('header only', 'id,category,amount\n', 0, 'SUCCESS rows=0 groups=0 total=0\n');

await rm(dir, { recursive: true, force: true });

if (problems.length === 0) {
  console.log('check.mjs: all visible checks passed');
  process.exit(0);
}
console.log('check.mjs: FAILED');
for (const p of problems) console.log(' - ' + p);
process.exit(1);
