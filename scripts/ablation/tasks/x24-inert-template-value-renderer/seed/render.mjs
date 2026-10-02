#!/usr/bin/env node
// render.mjs - fill a plain-text template using values from a JSON object.
//
// Usage: node render.mjs <template-file> <data.json>

import { readFileSync } from 'node:fs';

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(2);
}

const argv = process.argv.slice(2);
if (argv.length !== 2) fail('usage: render.mjs <template-file> <data.json>');

let template;
try {
  template = readFileSync(argv[0], 'utf8');
} catch {
  fail(`cannot read template file: ${argv[0]}`);
}

let data;
try {
  data = JSON.parse(readFileSync(argv[1], 'utf8'));
} catch {
  fail(`cannot read data file: ${argv[1]}`);
}
if (data === null || typeof data !== 'object' || Array.isArray(data)) {
  fail('data must be a JSON object');
}

function asText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (value === null) return '';
  return null;
}

// Fill the placeholders in.
let filled = template;
for (const key of Object.keys(data)) {
  const value = asText(data[key]);
  if (value === null) continue;
  filled = filled.split('{{' + key + '}}').join(value);
  filled = filled.split('{{ ' + key + ' }}').join(value);
}

// Walk the lines and honour the block directives.
const lines = filled.split('\n');
if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

const output = [];
const stack = [];

for (const raw of lines) {
  const line = raw.trim();

  if (line.startsWith('@')) {
    const parts = line.split(/\s+/);
    if (parts[0] === '@if') {
      if (!parts[1]) fail('malformed @if line');
      stack.push({ active: data[parts[1]] ? true : false, seenElse: false });
      continue;
    }
    if (parts[0] === '@else') {
      if (stack.length === 0) fail('@else without @if');
      const frame = stack[stack.length - 1];
      if (frame.seenElse) fail('duplicate @else');
      frame.seenElse = true;
      frame.active = !frame.active;
      continue;
    }
    if (parts[0] === '@endif') {
      if (stack.length === 0) fail('@endif without @if');
      stack.pop();
      continue;
    }
    fail(`unknown directive: ${line}`);
  }

  let visible = true;
  for (const frame of stack) {
    if (!frame.active) visible = false;
  }
  if (visible) output.push(raw);
}

if (stack.length > 0) fail('unclosed @if block');

process.stdout.write(output.length === 0 ? '' : output.join('\n') + '\n');
