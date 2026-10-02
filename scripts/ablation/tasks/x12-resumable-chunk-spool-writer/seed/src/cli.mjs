#!/usr/bin/env node
import process from 'node:process';
import { writeSpool, assembleSpool } from './writer.mjs';

const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'write') {
    const [sourcePath, spoolDir, sizeArg] = args;
    if (!sourcePath || !spoolDir || sizeArg === undefined) {
      throw new Error('usage: node src/cli.mjs write <source> <spoolDir> <chunkSize>');
    }
    const result = writeSpool({ sourcePath, spoolDir, chunkSize: Number(sizeArg) });
    console.log(`wrote ${result.chunks} chunk(s), ${result.bytes} byte(s)`);
  } else if (command === 'assemble') {
    const [spoolDir, outPath] = args;
    if (!spoolDir || !outPath) {
      throw new Error('usage: node src/cli.mjs assemble <spoolDir> <outPath>');
    }
    const result = assembleSpool({ spoolDir, outPath });
    console.log(`assembled ${result.chunks} chunk(s), ${result.bytes} byte(s)`);
  } else {
    throw new Error('usage: node src/cli.mjs write <source> <spoolDir> <chunkSize> | assemble <spoolDir> <outPath>');
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}
