#!/usr/bin/env bash
set -u
# Runs the full behavioural contract for the resumable chunk spool writer.
set -u

WORK="${TMPDIR:-/tmp}/spool-hidden-$$"
rm -rf "$WORK"
mkdir -p "$WORK" || exit 1

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

cat > "$WORK/harness.mjs" <<'HARNESS_EOF'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repo = path.resolve(process.argv[2] || process.cwd());
const writer = await import(pathToFileURL(path.join(repo, 'src', 'writer.mjs')).href);
const writeSpool = writer.writeSpool;
const assembleSpool = writer.assembleSpool;

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spool-hidden-'));
let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log('ok   ' + name);
  } catch (err) {
    failures += 1;
    console.log('FAIL ' + name + ' :: ' + ((err && err.message) || String(err)));
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function sameBytes(actual, expected, msg) {
  if (!Buffer.from(actual).equals(Buffer.from(expected))) throw new Error(msg);
}

function payloadOf(n) {
  const buf = Buffer.alloc(n);
  let x = 987654321;
  for (let i = 0; i < n; i += 1) {
    x = (x * 1103515245 + 12345) % 2147483648;
    buf[i] = (x >>> 16) & 0xff;
  }
  return buf;
}

function newCase(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function placeSource(dir, data) {
  const sourcePath = path.join(dir, 'payload.bin');
  fs.writeFileSync(sourcePath, data);
  return sourcePath;
}

function chunkNames(count) {
  const names = [];
  for (let i = 0; i < count; i += 1) names.push('chunk-' + String(i).padStart(4, '0') + '.bin');
  return names;
}

function assertSameSet(actual, expected, msg) {
  const a = actual.slice().sort().join(',');
  const b = expected.slice().sort().join(',');
  if (a !== b) throw new Error(msg + ' (actual: ' + a + ')');
}

function dirNames(dir) {
  return fs.readdirSync(dir).sort();
}

test('fresh run of many chunks assembles in order', () => {
  const dir = newCase('fresh-many');
  const spoolDir = path.join(dir, 'spool');
  const data = payloadOf(100);
  const sourcePath = placeSource(dir, data);
  const result = writeSpool({ sourcePath, spoolDir, chunkSize: 9 });
  assert(result && result.chunks === 12, 'expected 12 chunks, got ' + (result && result.chunks));
  assert(result.bytes === 100, 'expected 100 bytes, got ' + result.bytes);
  const outPath = path.join(dir, 'out.bin');
  assembleSpool({ spoolDir, outPath });
  sameBytes(fs.readFileSync(outPath), data, 'assembled bytes differ');
  assertSameSet(dirNames(spoolDir), chunkNames(12).concat(['journal.log']), 'unexpected spool contents');
});

test('cancelled run leaves consistent state and resumes', () => {
  const dir = newCase('interrupt');
  const spoolDir = path.join(dir, 'spool');
  const data = payloadOf(50);
  const sourcePath = placeSource(dir, data);
  let code = null;
  try {
    writeSpool({ sourcePath, spoolDir, chunkSize: 8, interruptAfter: 2 });
  } catch (err) {
    code = err && err.code;
  }
  assert(code === 'SPOOL_INTERRUPTED', 'expected SPOOL_INTERRUPTED, saw ' + code);
  assertSameSet(dirNames(spoolDir), chunkNames(2).concat(['journal.log']), 'spool state after cancellation');
  writeSpool({ sourcePath, spoolDir, chunkSize: 8 });
  const outPath = path.join(dir, 'out.bin');
  assembleSpool({ spoolDir, outPath });
  sameBytes(fs.readFileSync(outPath), data, 'resumed assembly differs');
});

test('chunk with correct length but wrong bytes is repaired', () => {
  const dir = newCase('tamper-same-length');
  const spoolDir = path.join(dir, 'spool');
  const data = payloadOf(40);
  const sourcePath = placeSource(dir, data);
  writeSpool({ sourcePath, spoolDir, chunkSize: 8 });
  const target = path.join(spoolDir, 'chunk-0002.bin');
  const buf = fs.readFileSync(target);
  for (let i = 0; i < buf.length; i += 1) buf[i] = buf[i] ^ 0xff;
  fs.writeFileSync(target, buf);
  writeSpool({ sourcePath, spoolDir, chunkSize: 8 });
  const outPath = path.join(dir, 'out.bin');
  assembleSpool({ spoolDir, outPath });
  sameBytes(fs.readFileSync(outPath), data, 'a corrupted chunk survived the re-run');
});

test('journal with torn and duplicated lines is repaired', () => {
  const dir = newCase('journal-torn');
  const spoolDir = path.join(dir, 'spool');
  const data = payloadOf(24);
  const sourcePath = placeSource(dir, data);
  writeSpool({ sourcePath, spoolDir, chunkSize: 8 });
  const jp = path.join(spoolDir, 'journal.log');
  const good = fs.readFileSync(jp, 'utf8').trim().split('\n');
  const stale = good[0].split(' ')[0] + ' 8 ' + 'a'.repeat(64);
  const torn = [good[0], good[1], good[1], stale, good[2], 'not a journal line', '2 8 ff'].join('\n');
  fs.writeFileSync(jp, torn);
  writeSpool({ sourcePath, spoolDir, chunkSize: 8 });
  const lines = fs.readFileSync(jp, 'utf8').trim().split('\n');
  assert(lines.length === 3, 'journal should hold 3 lines, got ' + lines.length);
  for (let i = 0; i < 3; i += 1) {
    const parts = lines[i].split(/\s+/);
    const expected = data.subarray(i * 8, Math.min(data.length, (i + 1) * 8));
    assert(Number(parts[0]) === i, 'journal line ' + i + ' has index ' + parts[0]);
    assert(Number(parts[1]) === expected.length, 'journal line ' + i + ' has wrong length');
    assert(parts[2] === sha(expected), 'journal line ' + i + ' has wrong digest');
  }
  const outPath = path.join(dir, 'out.bin');
  assembleSpool({ spoolDir, outPath });
  sameBytes(fs.readFileSync(outPath), data, 'assembly after journal repair differs');
});

test('stray files are removed from the spool directory', () => {
  const dir = newCase('stray');
  const spoolDir = path.join(dir, 'spool');
  const data = payloadOf(20);
  const sourcePath = placeSource(dir, data);
  writeSpool({ sourcePath, spoolDir, chunkSize: 8 });
  fs.writeFileSync(path.join(spoolDir, 'chunk-0001.bin.tmp'), 'leftover');
  fs.writeFileSync(path.join(spoolDir, 'chunk-0042.bin'), 'ghost');
  fs.writeFileSync(path.join(spoolDir, 'scratch.dat'), 'x');
  writeSpool({ sourcePath, spoolDir, chunkSize: 8 });
  assertSameSet(dirNames(spoolDir), chunkNames(3).concat(['journal.log']), 'stray files remain');
  const outPath = path.join(dir, 'out.bin');
  assembleSpool({ spoolDir, outPath });
  sameBytes(fs.readFileSync(outPath), data, 'assembly after cleanup differs');
});

test('assemble refuses a tampered chunk and writes no output', () => {
  const dir = newCase('assemble-guard');
  const spoolDir = path.join(dir, 'spool');
  const data = payloadOf(32);
  const sourcePath = placeSource(dir, data);
  writeSpool({ sourcePath, spoolDir, chunkSize: 8 });
  const target = path.join(spoolDir, 'chunk-0003.bin');
  const buf = fs.readFileSync(target);
  buf[0] = buf[0] ^ 0x01;
  fs.writeFileSync(target, buf);
  const outPath = path.join(dir, 'out.bin');
  let threw = false;
  try {
    assembleSpool({ spoolDir, outPath });
  } catch {
    threw = true;
  }
  assert(threw, 'assemble did not reject a tampered chunk');
  assert(!fs.existsSync(outPath), 'assemble left a partial output file behind');
});

test('repeated cancellations still converge', () => {
  const dir = newCase('repeat');
  const spoolDir = path.join(dir, 'spool');
  const data = payloadOf(41);
  const sourcePath = placeSource(dir, data);
  let rounds = 0;
  for (;;) {
    try {
      writeSpool({ sourcePath, spoolDir, chunkSize: 8, interruptAfter: 1 });
      break;
    } catch (err) {
      if (!err || err.code !== 'SPOOL_INTERRUPTED') throw err;
      rounds += 1;
      if (rounds > 30) throw new Error('writer never converged');
    }
  }
  const outPath = path.join(dir, 'out.bin');
  assembleSpool({ spoolDir, outPath });
  sameBytes(fs.readFileSync(outPath), data, 'assembly after repeated cancellations differs');
});

test('re-running a complete spool is idempotent', () => {
  const dir = newCase('idempotent');
  const spoolDir = path.join(dir, 'spool');
  const data = payloadOf(37);
  const sourcePath = placeSource(dir, data);
  writeSpool({ sourcePath, spoolDir, chunkSize: 5 });
  const before = dirNames(spoolDir);
  const beforeText = fs.readFileSync(path.join(spoolDir, 'journal.log'), 'utf8');
  writeSpool({ sourcePath, spoolDir, chunkSize: 5 });
  assertSameSet(dirNames(spoolDir), before, 'spool contents changed on re-run');
  assert(fs.readFileSync(path.join(spoolDir, 'journal.log'), 'utf8') === beforeText, 'journal changed on re-run');
});

test('edge inputs are handled', () => {
  const dir = newCase('edges');
  const spoolDir = path.join(dir, 'spool');
  const empty = placeSource(dir, Buffer.alloc(0));
  const result = writeSpool({ sourcePath: empty, spoolDir, chunkSize: 4 });
  assert(result.chunks === 0, 'an empty source must produce zero chunks');
  const outPath = path.join(dir, 'empty-out.bin');
  assembleSpool({ spoolDir, outPath });
  assert(fs.statSync(outPath).size === 0, 'empty assembly must be empty');
  let threwZero = false;
  try {
    writeSpool({ sourcePath: empty, spoolDir, chunkSize: 0 });
  } catch {
    threwZero = true;
  }
  assert(threwZero, 'chunkSize 0 must be rejected');
  let threwNegative = false;
  try {
    writeSpool({ sourcePath: empty, spoolDir, chunkSize: -3 });
  } catch {
    threwNegative = true;
  }
  assert(threwNegative, 'negative chunkSize must be rejected');
});

test('command line round trip', () => {
  const dir = newCase('cli');
  const spoolDir = path.join(dir, 'spool');
  const data = payloadOf(17);
  const sourcePath = placeSource(dir, data);
  const cli = path.join(repo, 'src', 'cli.mjs');
  execFileSync(process.execPath, [cli, 'write', sourcePath, spoolDir, '5'], { stdio: 'pipe' });
  const outPath = path.join(dir, 'out.bin');
  execFileSync(process.execPath, [cli, 'assemble', spoolDir, outPath], { stdio: 'pipe' });
  sameBytes(fs.readFileSync(outPath), data, 'command line round trip differs');
});

fs.rmSync(root, { recursive: true, force: true });
if (failures > 0) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('all checks passed');
process.exit(0);
HARNESS_EOF

node "$WORK/harness.mjs" "$(pwd)" > "$WORK/log.txt" 2>&1
STATUS=$?

cat "$WORK/log.txt"

if [ "$STATUS" -eq 0 ]; then
  echo "VERDICT: PASS"
  exit 0
fi

echo "VERDICT: FAIL"
exit 1
