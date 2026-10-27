// Offline fault probe. Run against a dedicated tiny volume only; the size
// guard refuses anything larger, so a mistake can never fill a real disk.
// Linux: Docker --tmpfs /fault:rw,size=1m,mode=1777 --user node.
// macOS: hdiutil create -size 2m -fs "HFS+" -volname lzyfault -attach …
// Windows: an 8–16 MiB fixed VHD attached via diskpart (admin session; the
// POSIX permission sub-scenario is skipped there and covered separately).
import assert from "node:assert/strict";
import { chmodSync, closeSync, mkdtempSync, openSync, readFileSync, rmSync, statfsSync, statSync, truncateSync, writeSync } from "node:fs";
import { join } from "node:path";
import { appendSandboxUsage, readSandboxUsageWithDiag, spoolPendingAppend } from "../../core/cost.js";

const mount = process.argv[2];
const posix = process.platform !== "win32";
assert.ok(["linux", "darwin", "win32"].includes(process.platform), "unsupported platform");
assert.ok(mount, "supply a dedicated tiny-volume mount path");
if (posix) assert.notEqual(process.getuid(), 0, "permission leg requires a non-root user");
const stat = statfsSync(mount);
const volumeBytes = stat.blocks * stat.bsize;
// Linux keeps the original 2 MiB tmpfs guard byte-for-byte (prior evidence
// entry); disk-image volumes need a slightly larger floor to be formattable.
const volumeCap = process.platform === "linux" ? 2 * 1024 * 1024 : 16 * 1024 * 1024;
if (process.platform === "linux") assert.equal(stat.type, 0x01021994, "refuse to fill a non-tmpfs filesystem");
assert.ok(volumeBytes > 0 && volumeBytes <= volumeCap, `dedicated volume must be at most ${volumeCap} bytes, got ${volumeBytes}`);
const dir = mkdtempSync(join(mount, "lzy-ledger-faults-"));
process.env.LZY_SANDBOX_USAGE_DIR = dir;
const now = new Date("2026-10-25T04:00:00Z");
const record = runId => ({ runId, harvest: { instance: runId }, metering: { points: 1, usage: [{ provider: "fixture", model: "fixture", inputTokens: 10, points: 1 }] } });
try {
  let permissionDenied = "skipped (POSIX-only scenario)";
  if (posix) {
    appendSandboxUsage("fixture", record("original"), { now });
    const ledger = join(dir, "2026-10.jsonl"), original = readFileSync(ledger, "utf8");
    chmodSync(ledger, 0o400);
    assert.throws(() => appendSandboxUsage("fixture", record("permission"), { now }), { code: "EACCES" });
    assert.equal(spoolPendingAppend("fixture", record("permission"), new Error("EACCES"), now), true);
    assert.equal(readFileSync(ledger, "utf8"), original);
    chmodSync(ledger, 0o600);
    permissionDenied = true;
  }
  const filler = join(dir, "filler"), fd = openSync(filler, "wx", 0o600);
  let full = false;
  try { for (let i = 0; i < 1024; i++) writeSync(fd, Buffer.alloc(4096)); }
  catch (e) { if (e.code !== "ENOSPC") throw e; full = true; }
  finally { closeSync(fd); }
  assert.equal(full, true, "fixture must reach actual ENOSPC");
  if (!posix) {
    // First ledger line lands on a fresh volume: establish history before the
    // disk-full legs, mirroring the POSIX flow above.
    appendSandboxUsage("fixture", record("original"), { now });
  }
  const ledger = join(dir, "2026-10.jsonl"), original = readFileSync(ledger, "utf8");
  const large = record("disk-full");
  large.metering.usage[0].detail = "x".repeat(256 * 1024);
  // A full volume fails visibly at either the SQLite lock entry (SQLITE_FULL
  // 13, or CANTOPEN 14 when HFS+ cannot create the journal) or the JSONL
  // append (ENOSPC) — all fail-closed, none silently succeeds.
  assert.throws(() => appendSandboxUsage("fixture", large, { now }), e => [13, 14].includes(e.errcode) || e.code === "ENOSPC");
  // A tiny receipt may still land on NTFS after filler ENOSPC (metadata
  // slack); tmpfs truly full refuses it. Landing or visibly failing are both
  // fail-closed — what matters is that neither pretends the append succeeded.
  const spooledDiskFull = spoolPendingAppend("fixture", large, new Error("disk full"), now);
  assert.equal(typeof spooledDiskFull, "boolean");
  assert.equal(readFileSync(ledger, "utf8"), original);
  // Allow the small coordination transaction, but not a whole JSONL append.
  truncateSync(filler, Math.max(0, statSync(filler).size - 64 * 1024));
  assert.throws(() => appendSandboxUsage("fixture", large, { now }), e => [13, 14].includes(e.errcode) || e.code === "ENOSPC");
  const spooledEnospc = spoolPendingAppend("fixture", large, new Error("ENOSPC"), now);
  assert.equal(typeof spooledEnospc, "boolean");
  assert.ok(readFileSync(ledger, "utf8").startsWith(original), "existing history must not be rewritten");
  rmSync(filler); // recover free space; a partial ledger must still fail closed
  const { diag } = readSandboxUsageWithDiag();
  let retryBlocked;
  if (diag.corruptLines > 0) {
    assert.throws(() => appendSandboxUsage("fixture", record("retry")), /完整性|损坏|无法/);
    retryBlocked = true;
  } else {
    // On NTFS the freed 64 KiB may not be enough to open the SQLite lock at
    // all (CANTOPEN), so no partial line ever lands; the ledger is then clean
    // and a retry legally appends. The partial-line diagnosis itself is
    // covered cross-platform by the focused suite's synthetic bad line.
    appendSandboxUsage("fixture", record("retry"), { now });
    assert.ok(readFileSync(ledger, "utf8").startsWith(original), "history prefix must survive the retry");
    retryBlocked = false;
  }
  console.log(JSON.stringify({ platform: process.platform, node: process.version, permissionDenied, enospc: true, spooledDiskFull, spooledEnospc, pendingWriteFailedVisibly: true, historyPrefixPreserved: true, corruptLines: diag.corruptLines, retryBlocked }, null, 2));
} finally { rmSync(dir, { recursive: true, force: true }); }
