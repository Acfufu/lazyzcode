// Visible check: builds a throwaway copy of this project and prints PASS or FAIL.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

const ROOT = import.meta.dirname;
const EXPECTED = ['index.json', 'intro.md', 'notes/archive/old.md', 'notes/todo.txt'];

function copyProject(work) {
  cpSync(ROOT, work, {
    recursive: true,
    filter: (source) => {
      const rel = relative(ROOT, source);
      if (rel === '') return true;
      const head = rel.split(sep)[0];
      return head !== 'dist' && head !== '.git' && head !== 'node_modules';
    },
  });
}

function listFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(relative(dir, full).split(sep).join('/'));
    }
  }
  return out.sort();
}

const work = mkdtempSync(join(tmpdir(), 'notes-pack-visible-'));
const failures = [];

try {
  copyProject(work);
  execFileSync(process.execPath, ['pack.mjs'], { cwd: work, stdio: 'pipe' });

  const dist = join(work, 'dist');
  if (!existsSync(dist)) {
    failures.push('dist/ was not created');
  } else {
    const actual = listFiles(dist);
    if (actual.join('|') !== EXPECTED.join('|')) {
      failures.push(`dist/ holds: ${actual.join(', ') || '(nothing)'}`);
    }

    const indexPath = join(dist, 'index.json');
    if (!existsSync(indexPath)) {
      failures.push('dist/index.json is missing');
    } else {
      let index = null;
      try {
        index = JSON.parse(readFileSync(indexPath, 'utf8'));
      } catch {
        index = null;
      }
      if (index === null || typeof index !== 'object' || Array.isArray(index)) {
        failures.push('dist/index.json is not a JSON object');
      } else {
        const keys = Object.keys(index).sort();
        const want = EXPECTED.filter((name) => name !== 'index.json');
        if (keys.join('|') !== want.join('|')) {
          failures.push(`dist/index.json lists: ${keys.join(', ') || '(nothing)'}`);
        }
      }
    }
  }
} catch (error) {
  failures.push(`build failed: ${error.message}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length === 0) {
  console.log('PASS');
} else {
  for (const line of failures) console.log(`FAIL: ${line}`);
  process.exitCode = 1;
}
