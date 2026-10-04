import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads a JSON manifest of records and writes one JSON file per record into
 * the output directory.
 *
 * Returns { total, written, failed, lines }, where `lines` are the report
 * lines that run.mjs prints to stdout.
 */
export function runPipeline(manifestPath, outDir) {
  const records = JSON.parse(readFileSync(manifestPath, 'utf8'));
  mkdirSync(outDir, { recursive: true });

  const lines = [];
  let written = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const parts = record.group ? String(record.group).split('/') : [];
    const target = join(outDir, ...parts, `${record.id}.json`);

    written += 1;
    try {
      writeFileSync(target, JSON.stringify(record, null, 2) + '\n');
    } catch {
      // one bad record should not abort the whole run
    }
    lines.push(`record ${i}: ok ${record.id}.json`);
  }

  return { total: records.length, written, failed, lines };
}
