#!/usr/bin/env node
// Visible checks: run the step runner on small generated inputs.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(here, 'run-steps.mjs');
const workDir = mkdtempSync(join(tmpdir(), 'steps-visible-'));
let failed = 0;

const report = (ok, message) => {
  if (!ok) failed += 1;
  console.log((ok ? 'PASS ' : 'FAIL ') + message);
};

const runSteps = (steps) => {
  const file = join(workDir, 'steps.json');
  writeFileSync(file, JSON.stringify(steps, null, 2));
  const started = Date.now();
  const proc = spawnSync(process.execPath, [runnerPath, file], { timeout: 6000 });
  const stdout = (proc.stdout || Buffer.alloc(0)).toString();
  return { status: proc.status, stdout, elapsedMs: Date.now() - started };
};

const okRun = runSteps([
  { name: 'first', command: 'echo hello', timeoutMs: 2000 },
  { name: 'second', command: 'true', timeoutMs: 2000 },
]);
report(okRun.status === 0, 'a run of two successful steps exits 0');
report(okRun.stdout.includes('STEP first ok'), 'the first step is reported as ok');
report(okRun.stdout.includes('STEP second ok'), 'the second step is reported as ok');
report(okRun.stdout.trimEnd().endsWith('RESULT ok'), 'the overall result line reports ok');

const timeoutRun = runSteps([
  { name: 'slow', command: 'sleep 3', timeoutMs: 400 },
  { name: 'later', command: 'true', timeoutMs: 2000 },
]);
report(timeoutRun.stdout.includes('STEP slow timeout'), 'an overrunning step is reported as timeout');
report(timeoutRun.stdout.includes('STEP later ok'), 'the run carries on after a timeout');
report(timeoutRun.status === 1, 'a run that had a timeout exits 1');
report(
  timeoutRun.elapsedMs < 2500,
  'the overrunning step is stopped instead of being allowed to finish',
);

rmSync(workDir, { recursive: true, force: true });

if (failed > 0) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall visible checks passed');
