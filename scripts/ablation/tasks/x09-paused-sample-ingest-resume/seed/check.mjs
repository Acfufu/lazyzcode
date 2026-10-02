// Visible check: a short command log with a single pause in the middle.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = pathToFileURL(path.join(here, 'src', 'ingest.mjs')).href;

let call = 0;

async function drive(dir, budget) {
  const statuses = [];
  for (let i = 0; i < budget; i += 1) {
    call += 1;
    const mod = await import(`${entry}?call=${call}`);
    const result = mod.run(dir);
    assert.ok(result && typeof result.status === 'string', 'run() must return a status');
    statuses.push(result.status);
    if (result.status === 'done') return statuses;
  }
  throw new Error(`job did not finish after ${budget} calls`);
}

const commands = [
  { op: 'sample', id: 'a1', value: 10 },
  { op: 'sample', id: 'a2', value: 11 },
  { op: 'pause' },
  { op: 'sample', id: 'a3', value: 12 },
  { op: 'sample', id: 'a4', value: 13 },
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-visible-'));
fs.writeFileSync(
  path.join(dir, 'commands.ndjson'),
  commands.map((command) => JSON.stringify(command)).join('\n') + '\n',
);

const statuses = await drive(dir, 8);
assert.equal(statuses.at(-1), 'done', 'the job must finish');
assert.deepEqual(statuses, ['interrupted', 'done'], 'one pause, one resume');

const raw = fs.readFileSync(path.join(dir, 'samples.ndjson'), 'utf8');
assert.ok(raw.endsWith('\n'), 'samples.ndjson must end with a newline');
const records = raw.split('\n').slice(0, -1).map((line) => JSON.parse(line));
assert.deepEqual(records, [
  { seq: 0, id: 'a1', value: 10 },
  { seq: 1, id: 'a2', value: 11 },
  { seq: 3, id: 'a3', value: 12 },
  { seq: 4, id: 'a4', value: 13 },
]);

console.log('visible check: OK');
