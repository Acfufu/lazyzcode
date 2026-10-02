#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const runnerPath = fileURLToPath(new URL('./runner.mjs', import.meta.url));
const dir = await mkdtemp(path.join(tmpdir(), 'task-supervisor-check-'));
const problems = [];

try {
  const hangPath = path.join(dir, 'hang.mjs');
  await writeFile(hangPath, 'setInterval(() => {}, 50);\n', 'utf8');

  const manifestPath = path.join(dir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({
    defaultTimeoutMs: 2000,
    tasks: [{ name: 'hang', command: process.execPath, args: [hangPath], timeoutMs: 300 }],
  }), 'utf8');

  const child = spawn(process.execPath, [runnerPath, manifestPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', () => {});

  const outcome = await new Promise((resolve) => {
    const guard = setTimeout(() => resolve({ stalled: true }), 4000);
    child.on('close', (code) => {
      clearTimeout(guard);
      resolve({ code, stdout });
    });
  });

  if (outcome.stalled) {
    child.kill('SIGKILL');
    problems.push('the supervisor did not finish within 4 seconds');
  } else {
    const lines = outcome.stdout.split('\n').filter((line) => line !== '');
    const expected = '{"name":"hang","status":"timeout","exitCode":null,"timedOut":true}';
    if (outcome.code !== 1) {
      problems.push(`expected exit code 1, got ${outcome.code}`);
    }
    if (!lines.includes(expected)) {
      problems.push(`missing task line ${expected}; got:\n${outcome.stdout}`);
    }
    if (lines[lines.length - 1] !== 'SUMMARY ok=0 failed=0 timeout=1') {
      problems.push(`unexpected last line: ${lines[lines.length - 1] === undefined ? '<none>' : lines[lines.length - 1]}`);
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`FAIL: ${problem}`);
  }
  process.exit(1);
}

console.log('OK: a command that never ends is stopped and reported as a timeout.');
