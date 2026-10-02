import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, 'src', 'cli.mjs');
const dir = mkdtempSync(join(tmpdir(), 'lane-rollup-check-'));

const records = [
  ['r1.json', { id: 'j-1', lane: 'core', ms: 42, status: 'ok' }],
  ['r2.json', { id: 'j-2', lane: 'core', ms: 300, status: 'fail' }],
  ['r3.json', { id: 'j-3', lane: 'edge', ms: 15, status: 'ok' }],
];

for (const [name, record] of records) {
  writeFileSync(join(dir, name), JSON.stringify(record) + '\n');
}
writeFileSync(join(dir, 'notes.txt'), 'not a record\n');

function complain(message) {
  console.error(`check failed: ${message}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

function runCli() {
  try {
    return execFileSync(process.execPath, [cli, dir], { encoding: 'utf8' });
  } catch (error) {
    complain(`the CLI exited with an error: ${error.message}`);
  }
}

const first = runCli();
const second = runCli();
const third = runCli();

if (first !== second || second !== third) {
  complain('three runs over the same records produced different output');
}

let report;
try {
  report = JSON.parse(first);
} catch {
  complain('stdout is not valid JSON');
}

const keys = Object.keys(report).sort().join(',');
if (keys !== 'lanes,version') complain(`unexpected top-level keys: ${keys}`);

if (report.version !== 1) complain('version must be 1');
if (!Array.isArray(report.lanes) || report.lanes.length !== 2) {
  complain('expected exactly two lanes');
}

const core = report.lanes.find((entry) => entry.lane === 'core');
if (!core) complain('lane "core" is missing');
if (core.runs !== 2 || core.ok !== 1 || core.failed !== 1) {
  complain('lane "core" counts are wrong');
}
if (core.totalMs !== 342) complain('lane "core" totalMs is wrong');

const edge = report.lanes.find((entry) => entry.lane === 'edge');
if (!edge) complain('lane "edge" is missing');
if (edge.runs !== 1 || edge.ok !== 1) complain('lane "edge" counts are wrong');

rmSync(dir, { recursive: true, force: true });
console.log('check.mjs: all visible checks passed');
