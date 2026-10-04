#!/usr/bin/env node
import { runPipeline } from './src/pipeline.mjs';

const [manifestPath, outDir] = process.argv.slice(2);

if (!manifestPath || !outDir) {
  console.error('usage: node run.mjs <manifest.json> <outDir>');
  process.exit(2);
}

const report = runPipeline(manifestPath, outDir);

for (const line of report.lines) {
  console.log(line);
}
console.log(`summary: written=${report.written} failed=${report.failed} total=${report.total}`);
process.exit(0);
