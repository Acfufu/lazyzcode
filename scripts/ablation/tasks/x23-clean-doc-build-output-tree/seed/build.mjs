#!/usr/bin/env node
// Renders the documents in src/ into an output directory.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
let out = 'public';
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--out') {
    out = args[i + 1];
    i += 1;
  }
}

function render(raw, label) {
  const text = raw.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0 || lines.every((line) => line.trim() === '')) {
    throw new Error(`source document is empty: ${label}`);
  }
  return `${lines.map((line) => line.toUpperCase()).join('\n')}\n`;
}

try {
  mkdirSync(join(out, '.stage'), { recursive: true });
  const names = readdirSync('src')
    .filter((name) => name.endsWith('.md'))
    .sort();
  const manifest = { generated: [] };
  for (const name of names) {
    const label = join('src', name);
    const raw = readFileSync(label, 'utf8');
    const text = render(raw, label);
    const outName = `${basename(name, '.md')}.txt`;
    writeFileSync(join(out, '.stage', outName), raw, 'utf8');
    writeFileSync(join(out, `${outName}.part`), text, 'utf8');
    writeFileSync(join(out, outName), text, 'utf8');
    manifest.generated.push(outName);
  }
  writeFileSync(
    join(out, '.build-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(`built ${manifest.generated.length} document(s) into ${out}\n`);
} catch (err) {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(1);
}
