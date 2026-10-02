#!/usr/bin/env node
// Visible check: builds a small sandbox and exercises the index builder.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tool = join(here, 'tools', 'build-index.mjs');

const problems = [];
function expect(label, condition, detail = '') {
  if (!condition) problems.push(`${label}${detail ? ` (${detail})` : ''}`);
}

const sandbox = mkdtempSync(join(tmpdir(), 'index-check-'));
try {
  mkdirSync(join(sandbox, 'content'));
  writeFileSync(join(sandbox, 'content', 'beta.md'), 'beta\n');
  writeFileSync(join(sandbox, 'content', 'alpha.md'), 'alpha\n');
  writeFileSync(join(sandbox, 'content', 'notes.tmp'), 'scratch notes\n');

  const run = spawnSync(process.execPath, [tool], { cwd: sandbox, encoding: 'utf8' });
  expect('run exits 0', run.status === 0, `status=${run.status} ${run.stderr || ''}`.trim());

  const indexPath = join(sandbox, 'out', 'index.md');
  expect('out/index.md exists', existsSync(indexPath));
  if (existsSync(indexPath)) {
    const actual = readFileSync(indexPath, 'utf8');
    expect('out/index.md content', actual === '- alpha.md\n- beta.md\n', JSON.stringify(actual));
  }

  expect('content/notes.tmp kept', existsSync(join(sandbox, 'content', 'notes.tmp')));

  const strays = readdirSync(join(sandbox, 'content')).filter((n) => n.endsWith('.tmp') && n !== 'notes.tmp');
  expect('no scratch left in content/', strays.length === 0, strays.join(', '));
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.log('visible check: FAIL');
  for (const p of problems) console.log(` - ${p}`);
  process.exit(1);
}
console.log('visible check: PASS');
