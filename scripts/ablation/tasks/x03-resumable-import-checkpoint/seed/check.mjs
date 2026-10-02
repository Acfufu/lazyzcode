import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(ROOT, 'src', 'cli.mjs');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-import-check-'));
const problems = [];

function sourceText(count) {
  const lines = [];
  for (let i = 0; i < count; i += 1) {
    lines.push(JSON.stringify({ key: `k${i}`, value: i }));
  }
  return lines.join('\n') + (count > 0 ? '\n' : '');
}

function expectedText(count) {
  const lines = [];
  for (let i = 0; i < count; i += 1) {
    lines.push(JSON.stringify({ key: `k${i}`, value: i, parity: i % 2 === 0 ? 'even' : 'odd', square: i * i }));
  }
  return lines.join('\n') + (count > 0 ? '\n' : '');
}

function runCli(source, out, state, extraEnv = {}) {
  return spawnSync(process.execPath, [CLI, '--source', source, '--out', out, '--state', state], {
    env: Object.assign({}, process.env, extraEnv),
    encoding: 'utf8',
  });
}

function readIfPresent(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function withDetail(label, result) {
  const err = String(result.stderr || '').trim();
  return err ? `${label}: ${err}` : label;
}

// 1. A plain run writes every record in order, and a second run changes nothing.
{
  const dir = path.join(WORK, 'plain');
  fs.mkdirSync(dir);
  const source = path.join(dir, 'source.jsonl');
  const out = path.join(dir, 'out.jsonl');
  const state = path.join(dir, 'state.json');
  fs.writeFileSync(source, sourceText(12));

  const first = runCli(source, out, state);
  if (first.status !== 0) {
    problems.push(withDetail('the import did not finish successfully', first));
  } else if (readIfPresent(out) !== expectedText(12)) {
    problems.push('the imported output does not match the source');
  }

  const second = runCli(source, out, state);
  if (second.status !== 0) {
    problems.push(withDetail('re-running the import failed', second));
  } else if (readIfPresent(out) !== expectedText(12)) {
    problems.push('re-running the import changed the output');
  }
}

// 2. An import interrupted in the middle must be completed by the next run.
{
  const dir = path.join(WORK, 'interrupted');
  fs.mkdirSync(dir);
  const source = path.join(dir, 'source.jsonl');
  const out = path.join(dir, 'out.jsonl');
  const state = path.join(dir, 'state.json');
  fs.writeFileSync(source, sourceText(12));

  const interrupted = runCli(source, out, state, { CANCEL_AFTER: '7' });
  if (interrupted.status !== 70) {
    problems.push(withDetail(`an interrupted run exited with ${interrupted.status}`, interrupted));
  } else if (readIfPresent(out) !== expectedText(7)) {
    problems.push('the records produced before the interruption are not in the output file');
  }

  const resumed = runCli(source, out, state);
  if (resumed.status !== 0) {
    problems.push(withDetail('the resumed import did not finish successfully', resumed));
  } else if (readIfPresent(out) !== expectedText(12)) {
    problems.push('resuming after an interruption did not produce the expected output');
  }
}

fs.rmSync(WORK, { recursive: true, force: true });

if (problems.length > 0) {
  for (const problem of problems) console.log(`- ${problem}`);
  console.log('visible check: FAIL');
  process.exit(1);
}
console.log('visible check: PASS');
