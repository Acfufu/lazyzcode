#!/usr/bin/env node
import { runPipeline } from './pipeline.mjs';

function parseArgs(argv) {
  const opts = { source: null, out: null, state: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--source') opts.source = argv[i += 1];
    else if (flag === '--out') opts.out = argv[i += 1];
    else if (flag === '--state') opts.state = argv[i += 1];
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!opts.source || !opts.out || !opts.state) {
    throw new Error('usage: node src/cli.mjs --source <file> --out <file> --state <file>');
  }
  return opts;
}

try {
  const opts = parseArgs(process.argv.slice(2));
  const result = runPipeline(opts);
  process.stdout.write(`processed ${result.processed}\n`);
  process.exit(0);
} catch (err) {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(1);
}
