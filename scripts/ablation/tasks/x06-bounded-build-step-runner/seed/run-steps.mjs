#!/usr/bin/env node
// Step runner: executes the shell steps listed in a JSON file, one at a time.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const filePath = process.argv[2];
if (!filePath) {
  console.error('usage: node run-steps.mjs <steps.json>');
  process.exit(2);
}

let steps;
try {
  steps = JSON.parse(readFileSync(filePath, 'utf8'));
} catch (err) {
  console.error('cannot read steps file: ' + err.message);
  process.exit(2);
}

const runStep = (step) => new Promise((resolve) => {
  const child = spawn('/bin/sh', ['-c', step.command], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.resume();
  child.stderr.resume();

  child.on('error', () => resolve('failed'));
  child.on('close', (code, signal) => {
    if (signal !== null || code !== 0) resolve('failed');
    else resolve('ok');
  });
});

let allOk = true;
for (const step of steps) {
  const status = await runStep(step);
  if (status !== 'ok') allOk = false;
  process.stdout.write(`STEP ${step.name} ${status}\n`);
}
process.stdout.write(`RESULT ${allOk ? 'ok' : 'failed'}\n`);
process.exitCode = allOk ? 0 : 1;
