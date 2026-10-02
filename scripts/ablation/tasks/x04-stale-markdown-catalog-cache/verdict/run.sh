#!/usr/bin/env bash
set -u
# Behavioral check for the document catalog cache module.
# Read-only with respect to the repository; all work happens in a temp dir.
set -u

repo="$(pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/catalog-hid.XXXXXX")" || exit 1

cleanup() {
  if [ -n "$work" ] && [ -d "$work" ]; then
    rm -rf "$work"
  fi
}
trap cleanup EXIT

cat > "$work/hidden.mjs" <<'HIDDEN_JS'
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.argv[2];
const mod = await import(pathToFileURL(path.join(repo, 'src', 'catalog.mjs')).href);
const Catalog = mod.Catalog;

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) {
    fails += 1;
    console.log('NOT OK: ' + msg);
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const slugs = (list) => list.map((e) => e.slug);

const base = await mkdtemp(path.join(tmpdir(), 'catalog-hid-'));

const d1 = path.join(base, 'd1');
await mkdir(d1);
await writeFile(path.join(d1, 'alpha.md'), '# Alpha\nbody\n');
await writeFile(path.join(d1, 'beta.md'), '# Beta\n');
await writeFile(path.join(d1, 'notes.txt'), 'ignore me\n');
await mkdir(path.join(d1, 'nested.md'));

const c1 = new Catalog(d1);
const first = c1.list();
ok(same(slugs(first), ['alpha', 'beta']), 'only top-level .md files are indexed');
ok(first[0].title === 'Alpha' && first[1].title === 'Beta', 'titles come from the first heading');
ok(first[0].bytes === 13, 'byte size of alpha.md');
ok(c1.rebuildCount === 1, 'the first list() builds the index');

const repeat = c1.list();
ok(c1.rebuildCount === 1, 'a second list() with no change does not rebuild');
ok(same(repeat, first), 'a second list() returns the same data');

const beta = path.join(d1, 'beta.md');
const before = await stat(beta);
await utimes(beta, before.atime, new Date(before.mtimeMs + 4000));
const touched = c1.list();
ok(c1.rebuildCount === 1, 'a timestamp-only change does not rebuild');
ok(same(slugs(touched), ['alpha', 'beta']), 'the file set is intact after a touch');

const st0 = await stat(beta);
await writeFile(beta, '# BETA\n');
await utimes(beta, st0.atime, st0.mtime);
const edited = c1.list();
ok(edited[1].title === 'BETA', 'a same-size edit with a restored mtime is seen');
ok(c1.rebuildCount === 2, 'the edit rebuilds the index one time');

await rm(path.join(d1, 'alpha.md'));
const gone = c1.list();
ok(same(slugs(gone), ['beta']), 'a deleted file leaves the index');

await writeFile(path.join(d1, 'zeta.md'), 'no heading here\n');
const added = c1.list();
ok(same(slugs(added), ['beta', 'zeta']), 'a created file enters the index');
ok(added[1].title === 'zeta', 'a file without a heading falls back to its slug');
ok(added[1].bytes === 16, 'byte size of zeta.md');

await rename(path.join(d1, 'beta.md'), path.join(d1, 'gamma.md'));
const moved = c1.list();
ok(same(slugs(moved), ['gamma', 'zeta']), 'a renamed file gets a new slug');
ok(moved[0].title === 'BETA', 'the renamed file keeps its content');

const snap = c1.list();
snap.push({ slug: 'ghost', title: 'ghost', bytes: 0 });
snap[0].title = 'MUTATED';
const after = c1.list();
ok(same(slugs(after), ['gamma', 'zeta']), 'changing a returned array does not reach the index');
ok(after[0].title === 'BETA', 'changing a returned object does not reach the index');

const d2 = path.join(base, 'd2');
await mkdir(d2);
await writeFile(path.join(d2, 'Win.md'), '# Windows\r\nbody\r\n');
await writeFile(path.join(d2, 'a.md'), '# lower\r\n');
const c2 = new Catalog(d2);
const caseList = c2.list();
ok(same(slugs(caseList), ['Win', 'a']), 'slugs are ordered by code units');
ok(caseList[0].title === 'Windows', 'a CRLF heading is cleaned up');
ok(caseList[1].title === 'lower', 'a lower-case heading is kept');

await writeFile(path.join(d2, 'uni.md'), '# \u00dcn\u00efcode\n');
const withUni = c2.list();
const uni = withUni.find((e) => e.slug === 'uni');
const uniBytes = (await readFile(path.join(d2, 'uni.md'))).length;
ok(uni !== undefined && uni.bytes === uniBytes, 'byte size counts stored bytes');

const missing = new Catalog(path.join(base, 'nowhere'));
ok(same(missing.list(), []), 'a missing directory gives an empty index');
missing.list();
ok(missing.rebuildCount === 1, 'a missing directory does not rebuild on every call');

await rm(base, { recursive: true, force: true });
if (fails > 0) {
  console.log('FAILED ' + fails);
} else {
  console.log('ALL OK');
}
process.exit(fails > 0 ? 1 : 0);
HIDDEN_JS

out="$(node "$work/hidden.mjs" "$repo" 2>&1)"
code=$?

printf '%s\n' "$out"

if [ "$code" -ne 0 ]; then
  printf '%s\n' 'VERDICT: FAIL'
  exit 1
fi

case "$out" in
  *"NOT OK"*)
    printf '%s\n' 'VERDICT: FAIL'
    exit 1
    ;;
  *"ALL OK"*)
    printf '%s\n' 'VERDICT: PASS'
    exit 0
    ;;
  *)
    printf '%s\n' 'VERDICT: FAIL'
    exit 1
    ;;
esac
