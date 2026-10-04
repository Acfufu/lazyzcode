#!/usr/bin/env node
// Visible check: a small manifest, one nested group, and the reported summary.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUN = fileURLToPath(new URL('./run.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'manifest-visible-'));
const problems = [];

function want(cond, msg) {
  if (!cond) problems.push(msg);
}

const manifest = [
  { id: 'one', name: 'First', value: 1 },
  { id: 'two', group: 'batch', name: 'Second', value: 'x' }
];
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const res = spawnSync(process.execPath, [RUN, join(dir, 'manifest.json'), join(dir, 'out')], {
  encoding: 'utf8'
});

want(res.status === 0, `expected exit code 0, got ${res.status}`);
const stdout = String(res.stdout || '').trimEnd();
const lines = stdout.length ? stdout.split('\n') : [];
want(
  lines[lines.length - 1] === 'summary: written=2 failed=0 total=2',
  `last line was: ${lines[lines.length - 1]}`
);

const one = join(dir, 'out', 'one.json');
const two = join(dir, 'out', 'batch', 'two.json');
want(existsSync(one), 'out/one.json is missing');
want(existsSync(two), 'out/batch/two.json is missing');
if (existsSync(one)) {
  want(
    readFileSync(one, 'utf8') === JSON.stringify(manifest[0], null, 2) + '\n',
    'out/one.json has unexpected content'
  );
}
if (existsSync(two)) {
  want(
    readFileSync(two, 'utf8') === JSON.stringify(manifest[1], null, 2) + '\n',
    'out/batch/two.json has unexpected content'
  );
}

rmSync(dir, { recursive: true, force: true });

if (problems.length === 0) {
  console.log('visible check: PASS');
  process.exit(0);
}
for (const p of problems) console.log(`visible check: ${p}`);
console.log('visible check: FAIL');
process.exit(1);
