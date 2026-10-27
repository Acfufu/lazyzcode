// JSONL remains the accounting authority. This empty SQLite file is only an OS
// mutex: BEGIN IMMEDIATE / ROLLBACK, no schema, events, or application data.
// Never unlink/replace it while writers can exist (that would split the lock).
import { mkdirSync, lstatSync, openSync, closeSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const held = new Set();
export const SANDBOX_USAGE_LOCK = ".append-lock.sqlite";
export const SANDBOX_USAGE_LOCK_WAIT_MS = 5000;

export class SandboxUsageLockError extends Error {
  constructor(message, options) { super(message, options); this.name = "SandboxUsageLockError"; }
}

export function withSandboxUsageLock(dir, fn, { timeoutMs = SANDBOX_USAGE_LOCK_WAIT_MS } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60000) throw new SandboxUsageLockError("账本锁等待须为 0..60000 毫秒");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = realpathSync(dir);
  if (held.has(key)) throw new SandboxUsageLockError("全局用量账本锁不可重入；禁止嵌套追加");
  const path = join(key, SANDBOX_USAGE_LOCK);
  try { const fd = openSync(path, "wx", 0o600); closeSync(fd); } catch (e) { if (e.code !== "EEXIST") throw e; }
  if (!lstatSync(path).isFile()) throw new SandboxUsageLockError(`账本锁目标非普通文件：${path}`);
  let db, acquired = false;
  held.add(key);
  try {
    const { DatabaseSync } = require("node:sqlite");
    db = new DatabaseSync(path);
    db.exec(`PRAGMA busy_timeout=${timeoutMs}`);
    // OS releases the lock when the process dies. No stale-PID lock stealing.
    db.exec("BEGIN IMMEDIATE");
    acquired = true;
    const result = fn();
    if (result && typeof result.then === "function") throw new SandboxUsageLockError("全局账本临界区必须同步；禁止网络、模型、spawn 或异步任务");
    return result;
  } catch (e) {
    if (e.errcode === 5 || e.errcode === 6) throw new SandboxUsageLockError(`全局用量账本锁忙（等待 ${timeoutMs}ms）；保留运行档后重试，勿删除锁文件`, { cause: e });
    throw e;
  } finally {
    try { if (acquired) db.exec("ROLLBACK"); } finally { try { db?.close(); } finally { held.delete(key); } }
  }
}
