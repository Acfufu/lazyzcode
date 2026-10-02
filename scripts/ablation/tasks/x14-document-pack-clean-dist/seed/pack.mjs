// Packs eligible source documents into the dist/ folder.
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = import.meta.dirname;
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const STAGE = join(DIST, '.pack-tmp');

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full));
    } else if (entry.isFile()) {
      found.push(full);
    }
  }
  return found;
}

function isEligible(rel) {
  return rel.endsWith('.md') || rel.endsWith('.txt');
}

function collect() {
  return walk(SRC)
    .map((full) => relative(SRC, full))
    .filter(isEligible)
    .sort();
}

function build() {
  const files = collect();

  mkdirSync(STAGE, { recursive: true });
  for (const rel of files) {
    const dest = join(STAGE, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(SRC, rel), dest);
  }

  const index = {};
  for (const rel of files) {
    index[rel] = statSync(join(SRC, rel)).size;
  }
  writeFileSync(join(STAGE, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

  mkdirSync(DIST, { recursive: true });
  for (const full of walk(STAGE)) {
    const rel = relative(STAGE, full);
    const dest = join(DIST, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(full, dest);
  }
}

build();
