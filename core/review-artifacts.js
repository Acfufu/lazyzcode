import { spawnSync } from "node:child_process";

const LIMIT = 16 * 1024 * 1024;

export class ReviewArtifactError extends Error {
  constructor() {
    super("评审产物读取被拒或未完整完成");
    this.name = "ReviewArtifactError";
    this.code = "REVIEW_ARTIFACT_UNREADABLE";
  }
}

// The guest owns HOME. Every pathname lookup and byte read stays inside the
// same OS boundary as the engine, including SQLite and discovery subprocesses.
const READER = String.raw`
import { lstatSync, openSync, closeSync, fstatSync, readSync, readdirSync, constants } from 'node:fs';
import { resolve, relative, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
const [request] = process.argv.slice(1);
const { home, path, sessionId, sql, operation } = JSON.parse(request);
const root = resolve(home);
const limit = 16 * 1024 * 1024;
function check(target, directory = false, optional = false) {
  const full = resolve(target);
  const rel = relative(root, full);
  if (rel === '..' || rel.startsWith('..' + sep) || resolve(root, rel) !== full) throw Error('outside');
  const parts = rel ? rel.split(sep) : [];
  let current = root;
  const paths = [root, ...parts.map(part => current = join(current, part))];
  for (let i = 0; i < paths.length; i++) {
    let stat;
    try { stat = lstatSync(paths[i]); } catch (e) {
      if (optional && e.code === 'ENOENT') return null;
      throw e;
    }
    if (stat.isSymbolicLink()) throw Error('link');
    if (i < paths.length - 1 || directory || full === root) {
      if (!stat.isDirectory()) throw Error('directory');
    } else if (!stat.isFile()) throw Error('regular');
  }
  return full;
}
function bytes(target) {
  const full = check(target, false, true);
  if (full === null) return null;
  const fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw Error('size/type');
    const output = Buffer.alloc(limit + 1);
    let total = 0;
    while (total <= limit) {
      const count = readSync(fd, output, total, output.length - total, null);
      if (!count) break;
      total += count;
    }
    if (total > limit) throw Error('limit');
    const after = fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || total !== stat.size) throw Error('changed');
    return output.subarray(0, total).toString('base64');
  } finally { closeSync(fd); }
}
try {
  let value;
  if (operation === 'read') value = bytes(path);
  else if (operation === 'find') {
    const dir = check(join(root, '.zcode', 'cli', 'rollout'), true, true);
    if (!dir) value = null;
    else {
      if (sessionId != null && !/^[A-Za-z0-9_-]+$/.test(sessionId)) throw Error('session');
      const names = readdirSync(dir).filter(n => /^model-io-[A-Za-z0-9_-]+\.jsonl$/.test(n));
      const exact = sessionId ? names.find(n => n === 'model-io-' + sessionId + '.jsonl') : null;
      const name = exact ?? (names.length === 1 ? names[0] : null);
      if (!name) value = null;
      else {
        const found = join(dir, name);
        const data = bytes(found);
        value = data === null ? null : { path: found, data };
      }
    }
  } else if (operation === 'sql') {
    const db = check(path, false, true);
    if (!db) value = null;
    else {
      for (const suffix of ['-wal', '-shm', '-journal']) check(db + suffix, false, true);
      // A quiescent WAL database may need new WAL/SHM sidecars even for SELECT.
      // query_only forbids SQL writes while allowing SQLite's WAL bookkeeping;
      // never use immutable, which could omit a concurrent committed WAL tail.
      const result = spawnSync('/usr/bin/sqlite3', ['-json', db, 'PRAGMA query_only=ON; ' + sql], {
        env: process.env, encoding: 'utf8', timeout: 3000, maxBuffer: 4 * 1024 * 1024,
      });
      if (result.error || result.status !== 0) throw Error('sqlite');
      value = result.stdout.trim() ? JSON.parse(result.stdout) : [];
      if (!Array.isArray(value)) throw Error('rows');
    }
  } else throw Error('operation');
  process.stdout.write(JSON.stringify({ value }));
} catch { process.exitCode = 1; }
`;

function read({ sandbox, ...request }) {
  const options = sandbox?.headless;
  if (!options?.launcher?.command || !Array.isArray(options.launcher.prefixArgs) || !options.baseEnv) throw new ReviewArtifactError();
  const result = spawnSync(options.launcher.command, [
    ...options.launcher.prefixArgs, process.execPath, "--input-type=module", "-e", READER, JSON.stringify(request),
  ], { cwd: "/", env: options.baseEnv, encoding: "utf8", timeout: 5000, maxBuffer: 2 * LIMIT });
  if (result.error || result.status !== 0) throw new ReviewArtifactError();
  try { return JSON.parse(result.stdout).value; } catch { throw new ReviewArtifactError(); }
}

export function readReviewArtifact(options) {
  const value = read({ ...options, operation: "read" });
  return value === null ? null : Buffer.from(value, "base64");
}

export function findReviewTranscript(options) {
  const value = read({ ...options, operation: "find" });
  return value === null ? null : { path: value.path, bytes: Buffer.from(value.data, "base64") };
}

export function queryReviewHostDb({ dbPath, ...options }) {
  try { return read({ ...options, path: dbPath, operation: "sql" }); } catch { return null; }
}
