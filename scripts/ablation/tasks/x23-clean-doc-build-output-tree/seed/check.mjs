#!/usr/bin/env node
// Builds the sample documents in a scratch directory and looks at the result.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const problems = [];
const work = mkdtempSync(join(tmpdir(), 'doccheck-'));

function readOut(name) {
  const file = join(work, 'out', name);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

try {
  cpSync(resolve('build.mjs'), join(work, 'build.mjs'));
  cpSync(resolve('src'), join(work, 'src'), { recursive: true });

  const run = spawnSync(process.execPath, ['build.mjs', '--out', 'out'], {
    cwd: work,
    encoding: 'utf8',
  });

  if (run.status !== 0) {
    problems.push(`build exited with status ${run.status}`);
    if (run.stderr && run.stderr.trim() !== '') {
      problems.push(`stderr: ${run.stderr.trim()}`);
    }
  }

  const outDir = join(work, 'out');
  const entries = existsSync(outDir) ? readdirSync(outDir).sort() : [];
  const expected = ['alpha.txt', 'beta.txt'];
  if (entries.join(',') !== expected.join(',')) {
    problems.push(
      `expected out/ to contain only ${expected.join(', ')} but found ${entries.join(', ') || 'nothing'}`,
    );
  }

  if (readOut('alpha.txt') !== 'TITLE ONE\nBODY LINE TWO\n') {
    problems.push('alpha.txt content is wrong');
  }
  if (readOut('beta.txt') !== 'SECOND DOCUMENT\n') {
    problems.push('beta.txt content is wrong');
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (problems.length === 0) {
  process.stdout.write('check: PASS\n');
  process.exit(0);
}
for (const problem of problems) process.stdout.write(`check: ${problem}\n`);
process.stdout.write('check: FAIL\n');
process.exit(1);
