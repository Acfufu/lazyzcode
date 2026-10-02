#!/usr/bin/env node
// Visible check for render.mjs.
//
// Run from the repository root:
//   node check.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(HERE, 'render.mjs');
const WORK = mkdtempSync(join(tmpdir(), 'render-visible-'));

let failures = 0;

function run(template, data) {
  const tpl = join(WORK, 'template.txt');
  const dat = join(WORK, 'data.json');
  writeFileSync(tpl, template);
  writeFileSync(dat, JSON.stringify(data));
  try {
    const stdout = execFileSync(process.execPath, [RENDERER, tpl, dat], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: typeof err.status === 'number' ? err.status : -1,
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? ''),
    };
  }
}

function expectText(name, template, data, expected) {
  const got = run(template, data);
  if (got.code === 0 && got.stdout === expected) {
    console.log(`ok   ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${name}`);
  console.log(`     expected exit 0 with stdout ${JSON.stringify(expected)}`);
  console.log(
    `     got exit ${got.code}, stdout ${JSON.stringify(got.stdout)}, stderr ${JSON.stringify(got.stderr)}`,
  );
}

function expectRefusal(name, template, data) {
  const got = run(template, data);
  if (got.code === 2 && got.stdout === '' && got.stderr.startsWith('error: ')) {
    console.log(`ok   ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${name}`);
  console.log('     expected exit 2, empty stdout and an "error: " message on stderr');
  console.log(
    `     got exit ${got.code}, stdout ${JSON.stringify(got.stdout)}, stderr ${JSON.stringify(got.stderr)}`,
  );
}

expectText('plain substitution', 'hello {{name}}\n', { name: 'world' }, 'hello world\n');

expectText('if taken', '@if flag\nYES {{n}}\n@else\nNO\n@endif\n', { flag: true, n: 1 }, 'YES 1\n');

expectText('if not taken', '@if flag\nYES\n@else\nNO {{n}}\n@endif\n', { flag: false, n: 2 }, 'NO 2\n');

expectText('nested blocks', '@if a\nA\n@if b\nB\n@endif\n@endif\n', { a: true, b: false }, 'A\n');

expectText(
  'inserted text stays text',
  '@if a\nA {{note}}\nB\n@endif\nC\n',
  { a: true, note: 'x\n@endif' },
  'A x\n@endif\nB\nC\n',
);

expectRefusal('unknown key', 'value: {{nope}}\n', { other: 1 });

expectRefusal('unclosed block', '@if a\nA\n', { a: true });

rmSync(WORK, { recursive: true, force: true });

if (failures === 0) {
  console.log('visible check: all cases passed');
  process.exit(0);
}
console.log(`visible check: ${failures} case(s) failed`);
process.exit(1);
