#!/usr/bin/env bash
set -u
# Full contract check for the resumable sample ingest job.
set -u

REPO_DIR="$(pwd)"
TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t ingest)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat > "$TMP_DIR/driver.mjs" <<'DRIVER'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.env.REPO_DIR;
assert.ok(repo, 'REPO_DIR must be set');
const entry = pathToFileURL(path.join(repo, 'src', 'ingest.mjs')).href;

let invocation = 0;

async function runOnce(dir) {
  invocation += 1;
  const mod = await import(`${entry}?invocation=${invocation}`);
  assert.equal(typeof mod.run, 'function', 'src/ingest.mjs must export run(dir)');
  return mod.run(dir);
}

function makeDir(commands) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-case-'));
  const body = commands.map((command) => JSON.stringify(command)).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'commands.ndjson'), body);
  return dir;
}

function readSamples(dir) {
  try {
    return fs.readFileSync(path.join(dir, 'samples.ndjson'), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

function parseRecords(raw) {
  if (raw === '') return [];
  assert.ok(raw.endsWith('\n'), 'samples.ndjson must end with a newline');
  return raw.split('\n').slice(0, -1).map((line) => {
    assert.notEqual(line.trim(), '', 'samples.ndjson must not contain blank lines');
    return JSON.parse(line);
  });
}

function expectRecords(dir, expected) {
  const records = parseRecords(readSamples(dir));
  assert.equal(
    records.length,
    expected.length,
    `expected ${expected.length} records but found ${records.length}`,
  );
  for (let i = 0; i < expected.length; i += 1) {
    const record = records[i];
    assert.deepEqual(Object.keys(record).sort(), ['id', 'seq', 'value'], `record ${i} fields`);
    assert.equal(record.seq, expected[i].seq, `record ${i} seq`);
    assert.equal(record.id, expected[i].id, `record ${i} id`);
    assert.equal(record.value, expected[i].value, `record ${i} value`);
  }
}

function assertCheckpointReadable(dir) {
  const file = path.join(dir, 'state.json');
  assert.ok(fs.existsSync(file), 'a stopped job must persist a checkpoint');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(Number.isInteger(parsed.cursor), 'checkpoint must hold an integer cursor');
}

async function drive(dir, limit) {
  let used = 0;
  for (;;) {
    const result = await runOnce(dir);
    used += 1;
    assert.ok(result && typeof result.status === 'string', 'run() must return a status');
    assert.ok(used <= limit, `job still not done after ${used} calls`);
    if (result.status === 'done') return used;
    assert.equal(result.status, 'interrupted', `unexpected status: ${result.status}`);
  }
}

const expectedSix = [
  { seq: 0, id: 'e0', value: 0 },
  { seq: 1, id: 'e1', value: 1 },
  { seq: 3, id: 'e2', value: 2 },
  { seq: 5, id: 'e3', value: 3 },
];

const pausedCommands = [
  { op: 'sample', id: 'e0', value: 0 },
  { op: 'sample', id: 'e1', value: 1 },
  { op: 'pause' },
  { op: 'sample', id: 'e2', value: 2 },
  { op: 'pause' },
  { op: 'sample', id: 'e3', value: 3 },
];

// Case 1: a long run of consecutive pauses, then more samples.
{
  const commands = [];
  for (let i = 0; i < 3; i += 1) commands.push({ op: 'sample', id: `s${i}`, value: i });
  for (let i = 0; i < 20; i += 1) commands.push({ op: 'pause' });
  for (let i = 3; i < 6; i += 1) commands.push({ op: 'sample', id: `s${i}`, value: i });

  const dir = makeDir(commands);
  const first = await runOnce(dir);
  assert.equal(first.status, 'interrupted', 'a pause must interrupt the call');
  assertCheckpointReadable(dir);
  expectRecords(dir, [
    { seq: 0, id: 's0', value: 0 },
    { seq: 1, id: 's1', value: 1 },
    { seq: 2, id: 's2', value: 2 },
  ]);

  const used = await drive(dir, 40);
  assert.equal(used, 20, 'each remaining pause costs exactly one call');
  expectRecords(dir, [
    { seq: 0, id: 's0', value: 0 },
    { seq: 1, id: 's1', value: 1 },
    { seq: 2, id: 's2', value: 2 },
    { seq: 23, id: 's3', value: 3 },
    { seq: 24, id: 's4', value: 4 },
    { seq: 25, id: 's5', value: 5 },
  ]);
}

// Case 2: the log ends with a pause.
{
  const dir = makeDir([
    { op: 'sample', id: 'b0', value: 0 },
    { op: 'sample', id: 'b1', value: 1 },
    { op: 'pause' },
  ]);
  const first = await runOnce(dir);
  assert.equal(first.status, 'interrupted');
  const before = readSamples(dir);
  const second = await runOnce(dir);
  assert.equal(second.status, 'done', 'a trailing pause must not be replayed forever');
  assert.equal(readSamples(dir), before, 'a finished job must not rewrite its output');
  expectRecords(dir, [
    { seq: 0, id: 'b0', value: 0 },
    { seq: 1, id: 'b1', value: 1 },
  ]);
}

// Case 3: no pauses at all.
{
  const dir = makeDir([
    { op: 'sample', id: 'c0', value: 7 },
    { op: 'sample', id: 'c1', value: 8 },
  ]);
  const used = await drive(dir, 3);
  assert.equal(used, 1, 'a log without pauses must finish in one call');
  expectRecords(dir, [
    { seq: 0, id: 'c0', value: 7 },
    { seq: 1, id: 'c1', value: 8 },
  ]);
}

// Case 4: repeated ids and repeated values must still produce one record each.
{
  const dir = makeDir([
    { op: 'sample', id: 'x', value: 1 },
    { op: 'sample', id: 'x', value: 2 },
    { op: 'sample', id: 'x', value: 1 },
  ]);
  await drive(dir, 3);
  expectRecords(dir, [
    { seq: 0, id: 'x', value: 1 },
    { seq: 1, id: 'x', value: 2 },
    { seq: 2, id: 'x', value: 1 },
  ]);
}

// Case 5: the checkpoint disappears after some progress.
{
  const dir = makeDir(pausedCommands);
  const first = await runOnce(dir);
  assert.equal(first.status, 'interrupted');
  fs.rmSync(path.join(dir, 'state.json'), { force: true });
  await drive(dir, 8);
  expectRecords(dir, expectedSix);
}

// Case 6: the checkpoint is rolled back to the beginning.
{
  const dir = makeDir(pausedCommands);
  const first = await runOnce(dir);
  assert.equal(first.status, 'interrupted');
  fs.writeFileSync(path.join(dir, 'state.json'), '{"cursor":0}\n');
  await drive(dir, 8);
  expectRecords(dir, expectedSix);
}

// Case 7: the output was left with a half-written final line.
{
  const commands = [];
  for (let i = 0; i < 6; i += 1) commands.push({ op: 'sample', id: `f${i}`, value: i * 10 });
  const dir = makeDir(commands);
  fs.writeFileSync(
    path.join(dir, 'samples.ndjson'),
    '{"seq":0,"id":"f0","value":0}\n{"seq":1,"id":"f1","value":10}\n{"seq":2,"id":"f2","va',
  );
  await drive(dir, 3);
  const expected = [];
  for (let i = 0; i < 6; i += 1) expected.push({ seq: i, id: `f${i}`, value: i * 10 });
  expectRecords(dir, expected);
}

// Case 8: finishing twice keeps the directory untouched and clean.
{
  const commands = [
    { op: 'sample', id: 'g0', value: 1 },
    { op: 'pause' },
    { op: 'sample', id: 'g1', value: 2 },
  ];
  const body = commands.map((command) => JSON.stringify(command)).join('\n') + '\n';
  const dir = makeDir(commands);
  await drive(dir, 5);
  const before = readSamples(dir);
  const again = await runOnce(dir);
  assert.equal(again.status, 'done', 'a finished job stays finished');
  assert.equal(readSamples(dir), before, 'a finished job must not rewrite its output');
  assert.equal(
    fs.readFileSync(path.join(dir, 'commands.ndjson'), 'utf8'),
    body,
    'the command log must never be modified',
  );
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(
    files,
    ['commands.ndjson', 'samples.ndjson', 'state.json'],
    `unexpected files in the working directory: ${files.join(', ')}`,
  );
}

console.log('all ingest cases ok');
DRIVER

if REPO_DIR="$REPO_DIR" node "$TMP_DIR/driver.mjs" > "$TMP_DIR/result.txt" 2>&1; then
  cat "$TMP_DIR/result.txt"
  echo "VERDICT: PASS"
  exit 0
fi

cat "$TMP_DIR/result.txt"
echo "VERDICT: FAIL"
exit 1
