import { parseByteSize } from './parse-size.mjs';

const args = process.argv.slice(2);

if (args.length === 0) {
  process.stderr.write('usage: cli.mjs <size>...\n');
  process.exit(2);
}

let failed = false;

for (const arg of args) {
  try {
    process.stdout.write(`${parseByteSize(arg)}\n`);
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    failed = true;
  }
}

if (failed) {
  process.exit(2);
}
