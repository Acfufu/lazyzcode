// Visible check for the byte-size tools.
//
// Run from the repository root:  node check.mjs

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseByteSize } from './src/parse-size.mjs';

const here = dirname(fileURLToPath(import.meta.url));

let failures = 0;

function note(message) {
  failures += 1;
  console.log(`FAIL ${message}`);
}

function expectValue(input, expected) {
  let actual;
  try {
    actual = parseByteSize(input);
  } catch (error) {
    note(`${JSON.stringify(input)} threw ${error.name}`);
    return;
  }
  if (actual !== expected) {
    note(`${JSON.stringify(input)} -> ${actual} (expected ${expected})`);
  }
}

function expectThrows(input, errorName) {
  let actual;
  try {
    actual = parseByteSize(input);
  } catch (error) {
    if (error.name !== errorName) {
      note(`${JSON.stringify(input)} threw ${error.name} (expected ${errorName})`);
    }
    return;
  }
  note(`${JSON.stringify(input)} -> ${actual} (expected ${errorName})`);
}

expectValue('1 KB', 1000);
expectValue('1 KiB', 1024);
expectValue('2.5 MB', 2500000);
expectValue('1024 B', 1024);
expectThrows('1.5 B', 'SyntaxError');
expectThrows('spam', 'SyntaxError');
expectThrows(1024, 'TypeError');

const cli = spawnSync(process.execPath, [join(here, 'src', 'cli.mjs'), '1KB', '2.5 MB'], {
  encoding: 'utf8',
});

if (cli.status !== 0) {
  note(`src/cli.mjs exited with ${cli.status} for valid arguments`);
} else if (cli.stdout !== '1000\n2500000\n') {
  note(`src/cli.mjs printed ${JSON.stringify(cli.stdout)} for valid arguments`);
}

if (failures > 0) {
  console.log(`visible check: FAIL (${failures} problem(s))`);
  process.exitCode = 1;
} else {
  console.log('visible check: PASS');
}
