#!/usr/bin/env bash
set -u
# Full-contract verification for the reading summary cache.
# Runs on a scratch copy of the repository; the repository itself is untouched.
set -u

REPO="$(pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "VERDICT: FAIL"
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/reading-summary-hidden.XXXXXX")" || { echo "VERDICT: FAIL"; exit 1; }
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/repo" || { echo "VERDICT: FAIL"; exit 1; }
cp -R "$REPO/." "$TMP/repo" || { echo "VERDICT: FAIL"; exit 1; }
rm -rf "$TMP/repo/.cache" "$TMP/repo/.git" "$TMP/repo/node_modules"

cat > "$TMP/verify.mjs" <<'VERIFY_EOF'
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

const repo = process.argv[2];
const problems = [];
const note = (message) => problems.push(message);

function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canon(value[key]);
    return out;
  }
  return value;
}

function same(a, b) {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

function expectedSummary() {
  const cfgPath = join(repo, 'config.json');
  let exclude = [];
  if (existsSync(cfgPath)) {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    if (Array.isArray(cfg.exclude)) exclude = cfg.exclude.map(String);
  }
  const skipped = new Set(exclude);
  const dir = join(repo, 'data');
  const names = Object.create(null);
  const entries = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  for (const entry of entries) {
    const full = join(dir, entry);
    if (!statSync(full).isFile()) continue;
    const record = JSON.parse(readFileSync(full, 'utf8'));
    if (skipped.has(record.name)) continue;
    if (!names[record.name]) names[record.name] = { count: 0, sum: 0, max: null };
    const bucket = names[record.name];
    for (const value of record.readings) {
      bucket.count += 1;
      bucket.sum += value;
      bucket.max = bucket.max === null ? value : Math.max(bucket.max, value);
    }
  }
  const sorted = {};
  for (const key of Object.keys(names).sort()) sorted[key] = names[key];
  return { names: sorted };
}

function runSummary() {
  try {
    const stdout = execFileSync(process.execPath, [join(repo, 'src', 'summary.mjs')], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (err) {
    const code = typeof err.status === 'number' ? err.status : 1;
    const stdout = err.stdout ? String(err.stdout) : '';
    return { code, stdout };
  }
}

function step(label) {
  const want = expectedSummary();
  const result = runSummary();
  if (result.code !== 0) {
    note(`${label}: exit code ${result.code}`);
    return null;
  }
  let got;
  try {
    got = JSON.parse(result.stdout);
  } catch {
    note(`${label}: stdout is not valid JSON`);
    return null;
  }
  if (!same(got, want)) {
    note(`${label}: summary mismatch (want ${JSON.stringify(canon(want))}, got ${JSON.stringify(canon(got))})`);
    return null;
  }
  return got;
}

const cachePath = join(repo, '.cache', 'summary.json');

function cacheState(label) {
  if (!existsSync(cachePath)) {
    note(`${label}: cache file is missing`);
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(cachePath, 'utf8'));
  } catch {
    note(`${label}: cache file is not valid JSON`);
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    note(`${label}: cache file is not an object`);
    return null;
  }
  if (typeof parsed.source !== 'string' || parsed.source.length === 0) {
    note(`${label}: cache source is missing`);
    return null;
  }
  if (!parsed.summary || typeof parsed.summary !== 'object') {
    note(`${label}: cache summary is missing`);
    return null;
  }
  return parsed;
}

function writeCacheRaw(text) {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, text);
}

const alpha = join(repo, 'data', 'alpha.json');
const beta = join(repo, 'data', 'beta.json');
const cfg = join(repo, 'config.json');

if (!existsSync(join(repo, 'src', 'summary.mjs'))) {
  note('src/summary.mjs is missing');
}

rmSync(join(repo, '.cache'), { recursive: true, force: true });

const alphaRaw = readFileSync(alpha, 'utf8');
const alphaStat = statSync(alpha);
const betaRaw = readFileSync(beta, 'utf8');
const cfgRaw = readFileSync(cfg, 'utf8');

const first = step('fresh run');
const firstCache = cacheState('fresh run');
if (first && firstCache && !same(firstCache.summary, first)) {
  note('fresh run: cached summary does not match what was printed');
}

const edited = alphaRaw.replace('4, 1, 5', '4, 1, 9');
if (edited === alphaRaw) {
  note('harness: could not produce a same-size edit of data/alpha.json');
} else {
  writeFileSync(alpha, edited);
  utimesSync(alpha, alphaStat.atime, alphaStat.mtime);
  const second = step('same-size content change');
  const secondCache = cacheState('same-size content change');
  if (firstCache && secondCache && firstCache.source === secondCache.source) {
    note('same-size content change: cache fingerprint did not change');
  }
  writeFileSync(alpha, alphaRaw);
  utimesSync(alpha, alphaStat.atime, alphaStat.mtime);
}

writeFileSync(cfg, `${JSON.stringify({ exclude: ['beta'] }, null, 2)}\n`);
const third = step('config change');
if (third && third.names && third.names.beta) {
  note('config change: an excluded name is still reported');
}
writeFileSync(cfg, cfgRaw);

rmSync(beta);
step('removed data file');
writeFileSync(beta, betaRaw);

const gammaPath = join(repo, 'data', 'gamma.json');
writeFileSync(gammaPath, `${JSON.stringify({ name: 'gamma', readings: [10, 20] }, null, 2)}\n`);
step('added data file');
rmSync(gammaPath);

const notesPath = join(repo, 'data', 'notes.txt');
writeFileSync(notesPath, 'plain text, not a record\n');
step('non-json file inside data');
rmSync(notesPath);

writeCacheRaw('{"source": "deadbeef",');
step('truncated cache');
writeCacheRaw('{"hello": "world"}\n');
step('cache without the expected fields');
writeCacheRaw('[]\n');
step('cache holding an array');
writeCacheRaw('42\n');
step('cache holding a scalar');
writeCacheRaw('{"source": "", "summary": {"names": {}}}\n');
step('cache with an empty fingerprint');
rmSync(join(repo, '.cache'), { recursive: true, force: true });
step('cache directory missing');
cacheState('cache directory missing');

const runA = runSummary();
const runB = runSummary();
if (runA.code !== 0 || runB.code !== 0) {
  note('repeat runs failed');
} else if (runA.stdout !== runB.stdout) {
  note('repeat runs produced different output');
}

const deltaPath = join(repo, 'data', 'delta.json');
writeFileSync(deltaPath, `${JSON.stringify({ name: 'delta', readings: [] }, null, 2)}\n`);
const emptyStep = step('record without readings');
if (emptyStep && emptyStep.names && emptyStep.names.delta && emptyStep.names.delta.max !== null) {
  note('record without readings: max should be null');
}
rmSync(deltaPath);

const extraPath = join(repo, 'data', 'alpha-extra.json');
writeFileSync(extraPath, `${JSON.stringify({ name: 'alpha', readings: [100] }, null, 2)}\n`);
step('records sharing a name');
rmSync(extraPath);

if (problems.length > 0) {
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log('all contract checks passed');
process.exit(0);
VERIFY_EOF

if node "$TMP/verify.mjs" "$TMP/repo" > "$TMP/log.txt" 2>&1; then
  echo "VERDICT: PASS"
  exit 0
fi

echo "--- verification log ---" >&2
cat "$TMP/log.txt" >&2
echo "VERDICT: FAIL"
exit 1
