// Sample ingest job.
//
// An external scheduler calls run() again and again: the job does some work,
// may be told to stop at a pause command, and is called again later.

import fs from 'node:fs';
import path from 'node:path';

const COMMANDS_FILE = 'commands.ndjson';
const SAMPLES_FILE = 'samples.ndjson';
const STATE_FILE = 'state.json';

// Progress of the current pass, kept while the job is running.
let cursor = 0;

function commandsPath(dir) {
  return path.join(dir, COMMANDS_FILE);
}

function samplesPath(dir) {
  return path.join(dir, SAMPLES_FILE);
}

function statePath(dir) {
  return path.join(dir, STATE_FILE);
}

export function readCommands(dir) {
  const raw = fs.readFileSync(commandsPath(dir), 'utf8');
  const commands = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    commands.push(JSON.parse(line));
  }
  return commands;
}

function writeState(dir, value) {
  fs.writeFileSync(statePath(dir), JSON.stringify({ cursor: value }, null, 2) + '\n');
}

export function run(dir) {
  const commands = readCommands(dir);
  let processed = 0;

  while (cursor < commands.length) {
    const command = commands[cursor];

    if (command.op === 'pause') {
      // Remember where the job stopped and let the caller resume later.
      writeState(dir, cursor);
      return { status: 'interrupted', processed, cursor };
    }

    if (command.op === 'sample') {
      const record = { seq: cursor, id: command.id, value: command.value };
      fs.appendFileSync(samplesPath(dir), JSON.stringify(record) + '\n');
      processed += 1;
    }

    cursor += 1;
  }

  writeState(dir, cursor);
  return { status: 'done', processed, cursor };
}
