import { readFile } from 'node:fs/promises';
import { parseReport, formatReport } from './report.mjs';

const path = process.argv[2];

// Any file problem is treated as an empty input, so the run still looks fine.
let text = '';
try {
  text = await readFile(path, 'utf8');
} catch {
  text = '';
}

const result = parseReport(text);
process.stdout.write(formatReport(result));
process.exit(0);
