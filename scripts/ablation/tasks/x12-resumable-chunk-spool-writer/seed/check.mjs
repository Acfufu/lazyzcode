import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeSpool, assembleSpool } from './src/writer.mjs';

const here = import.meta.dirname;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spool-check-'));
const payload = Buffer.from('The quick brown fox jumps over the lazy dog 0123456789', 'utf8');
let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name} :: ${(error && error.message) || error}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameBytes(actual, expected, message) {
  if (!Buffer.from(actual).equals(Buffer.from(expected))) throw new Error(message);
}

function makeCase(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const sourcePath = path.join(dir, 'payload.bin');
  fs.writeFileSync(sourcePath, payload);
  return { dir, sourcePath };
}

check('fresh write and assemble', () => {
  const { dir, sourcePath } = makeCase('fresh');
  const spoolDir = path.join(dir, 'spool');
  const result = writeSpool({ sourcePath, spoolDir, chunkSize: 16 });
  assert(result.chunks === Math.ceil(payload.length / 16), 'unexpected chunk count');
  const outPath = path.join(dir, 'out.bin');
  assembleSpool({ spoolDir, outPath });
  sameBytes(fs.readFileSync(outPath), payload, 'assembled bytes differ from the source');
});

check('interrupted write resumes to the same bytes', () => {
  const { dir, sourcePath } = makeCase('resume');
  const spoolDir = path.join(dir, 'spool');
  let code = null;
  try {
    writeSpool({ sourcePath, spoolDir, chunkSize: 16, interruptAfter: 1 });
  } catch (error) {
    code = error && error.code;
  }
  assert(code === 'SPOOL_INTERRUPTED', `expected code SPOOL_INTERRUPTED, saw ${code}`);
  writeSpool({ sourcePath, spoolDir, chunkSize: 16 });
  const outPath = path.join(dir, 'out.bin');
  assembleSpool({ spoolDir, outPath });
  sameBytes(fs.readFileSync(outPath), payload, 'resumed assembly differs');
});

check('a deleted chunk is rewritten', () => {
  const { dir, sourcePath } = makeCase('missing');
  const spoolDir = path.join(dir, 'spool');
  writeSpool({ sourcePath, spoolDir, chunkSize: 16 });
  fs.rmSync(path.join(spoolDir, 'chunk-0001.bin'));
  writeSpool({ sourcePath, spoolDir, chunkSize: 16 });
  const outPath = path.join(dir, 'out.bin');
  assembleSpool({ spoolDir, outPath });
  sameBytes(fs.readFileSync(outPath), payload, 'assembly after a deleted chunk differs');
});

check('empty source produces an empty output', () => {
  const dir = path.join(root, 'empty');
  fs.mkdirSync(dir, { recursive: true });
  const sourcePath = path.join(dir, 'payload.bin');
  fs.writeFileSync(sourcePath, Buffer.alloc(0));
  const spoolDir = path.join(dir, 'spool');
  const result = writeSpool({ sourcePath, spoolDir, chunkSize: 16 });
  assert(result.chunks === 0, 'an empty source must produce no chunks');
  const outPath = path.join(dir, 'out.bin');
  assembleSpool({ spoolDir, outPath });
  assert(fs.statSync(outPath).size === 0, 'empty assembly must be empty');
});

check('a non-positive chunk size is rejected', () => {
  const { dir, sourcePath } = makeCase('bad-size');
  const spoolDir = path.join(dir, 'spool');
  let threw = false;
  try {
    writeSpool({ sourcePath, spoolDir, chunkSize: 0 });
  } catch {
    threw = true;
  }
  assert(threw, 'chunkSize 0 must throw');
});

check('command line write and assemble round trip', () => {
  const { dir, sourcePath } = makeCase('cli');
  const spoolDir = path.join(dir, 'spool');
  const outPath = path.join(dir, 'out.bin');
  const cli = path.join(here, 'src', 'cli.mjs');
  execFileSync(process.execPath, [cli, 'write', sourcePath, spoolDir, '16'], { stdio: 'pipe' });
  execFileSync(process.execPath, [cli, 'assemble', spoolDir, outPath], { stdio: 'pipe' });
  sameBytes(fs.readFileSync(outPath), payload, 'command line round trip differs');
});

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
