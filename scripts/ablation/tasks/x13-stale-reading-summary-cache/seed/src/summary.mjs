// Aggregate the reading logs in data/*.json and print a JSON summary.
//
// The result is kept in .cache/summary.json so repeated runs stay cheap.

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = join(ROOT, 'data');
const CONFIG_FILE = join(ROOT, 'config.json');
const CACHE_DIR = join(ROOT, '.cache');
const CACHE_FILE = join(CACHE_DIR, 'summary.json');

function readConfig() {
  let raw;
  try {
    raw = readFileSync(CONFIG_FILE, 'utf8');
  } catch {
    return { exclude: [] };
  }
  const parsed = JSON.parse(raw);
  const exclude = Array.isArray(parsed.exclude) ? parsed.exclude.map(String) : [];
  return { exclude };
}

function readSources() {
  let entries;
  try {
    entries = readdirSync(DATA_DIR);
  } catch {
    throw new Error(`cannot read data directory: ${DATA_DIR}`);
  }
  const files = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) continue;
    const full = join(DATA_DIR, entry);
    if (!statSync(full).isFile()) continue;
    files.push({ name: entry, raw: readFileSync(full, 'utf8') });
  }
  return files;
}

function fingerprint(files) {
  return files.map((file) => `${file.name}:${file.raw.length}`).join('|');
}

function computeSummary(files, config) {
  const excluded = new Set(config.exclude);
  const names = Object.create(null);
  for (const file of files) {
    const record = JSON.parse(file.raw);
    if (typeof record.name !== 'string' || !Array.isArray(record.readings)) {
      throw new Error(`invalid record in ${file.name}`);
    }
    if (excluded.has(record.name)) continue;
    if (!names[record.name]) names[record.name] = { count: 0, sum: 0, max: null };
    const entry = names[record.name];
    for (const value of record.readings) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`invalid reading in ${file.name}`);
      }
      entry.count += 1;
      entry.sum += value;
      entry.max = entry.max === null ? value : Math.max(entry.max, value);
    }
  }
  const sorted = {};
  for (const key of Object.keys(names).sort()) sorted[key] = names[key];
  return { names: sorted };
}

function readCache() {
  let raw;
  try {
    raw = readFileSync(CACHE_FILE, 'utf8');
  } catch {
    return null;
  }
  return JSON.parse(raw);
}

function writeCache(source, summary) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, `${JSON.stringify({ source, summary }, null, 2)}\n`);
}

const files = readSources();
const config = readConfig();
const source = fingerprint(files);
const cached = readCache();

let summary;
if (cached && cached.source === source && cached.summary) {
  summary = cached.summary;
} else {
  summary = computeSummary(files, config);
  writeCache(source, summary);
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
