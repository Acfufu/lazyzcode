#!/usr/bin/env node
import { reportFor } from './rollup.mjs';

const dir = process.argv[2];

if (!dir) {
  process.stderr.write('usage: node src/cli.mjs <records-dir>\n');
  process.exit(2);
}

const report = reportFor(dir);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
