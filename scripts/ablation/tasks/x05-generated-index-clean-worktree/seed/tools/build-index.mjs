// Builds out/index.md from the Markdown files in content/.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const contentDir = join(root, 'content');
const outDir = join(root, 'out');
const outFile = join(outDir, 'index.md');
const scratchFile = join(contentDir, '.index.tmp');

// Drop scratch files left over from earlier runs.
for (const entry of readdirSync(contentDir)) {
  if (entry.endsWith('.tmp')) {
    rmSync(join(contentDir, entry), { force: true });
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, '');

const names = [];
for (const entry of readdirSync(contentDir)) {
  if (!entry.endsWith('.md')) continue;
  readFileSync(join(contentDir, entry), 'utf8');
  names.push(entry);
}
names.sort();

const body = names.map((name) => `- ${name}`).join('\n');
writeFileSync(scratchFile, body + '\n', 'utf8');
writeFileSync(outFile, readFileSync(scratchFile, 'utf8'), 'utf8');
rmSync(scratchFile, { force: true });

console.log(`index written: ${names.length} entries`);
