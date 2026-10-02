#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { EnvelopeError, renderDocument } from './envelope.mjs';

const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const collect = (argv) => {
  const vars = {};
  const paths = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--var') {
      const spec = argv[index + 1];
      index += 1;
      if (spec === undefined) throw new EnvelopeError('missing value for --var');
      const eq = spec.indexOf('=');
      if (eq < 1) throw new EnvelopeError(`bad variable spec: ${spec}`);
      const name = spec.slice(0, eq);
      if (!VAR_NAME.test(name)) throw new EnvelopeError(`bad variable name: ${name}`);
      vars[name] = spec.slice(eq + 1);
      continue;
    }
    if (arg.startsWith('--')) throw new EnvelopeError(`unknown option: ${arg}`);
    paths.push(arg);
  }
  if (paths.length !== 1) throw new EnvelopeError('expected exactly one document path');
  return { vars, path: paths[0] };
};

try {
  const { vars, path } = collect(process.argv.slice(2));
  const text = readFileSync(path, 'utf8');
  process.stdout.write(`${JSON.stringify(renderDocument(text, vars))}\n`);
} catch (error) {
  const message = error && typeof error.message === 'string' ? error.message : String(error);
  process.stderr.write(`error: ${message}\n`);
  process.exit(2);
}
