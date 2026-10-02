#!/usr/bin/env node
import process from 'node:process';
import { loadManifest } from './lib/manifest.mjs';
import { runTask } from './lib/tasks.mjs';

async function main(argv) {
  const manifestPath = argv[0];
  if (!manifestPath) {
    process.stderr.write('usage: node runner.mjs <manifest.json>\n');
    return 2;
  }

  let manifest;
  try {
    manifest = await loadManifest(manifestPath);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }

  const counts = { ok: 0, failed: 0, timeout: 0 };

  for (const task of manifest.tasks) {
    const result = await runTask(task);
    counts[result.status] += 1;
    process.stdout.write(`${JSON.stringify({
      name: result.name,
      status: result.status,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    })}\n`);
  }

  process.stdout.write(`SUMMARY ok=${counts.ok} failed=${counts.failed} timeout=${counts.timeout}\n`);
  return counts.ok === manifest.tasks.length ? 0 : 1;
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
