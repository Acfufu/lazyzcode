// 重放通道契约（M2 N9，a1.r5 F-3／a1.r11 F-4）：树外工件哈希对表 fail-closed——
// 全对表 exit 0；失配/缺席/索引不可读 exit 1；报告漂移（reportDrift）只注记不翻退出码。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "v050", "replay-artifacts.mjs");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function fixture(overrides = {}) {
  const d = mkdtempSync(join(tmpdir(), "lzy-replay-"));
  const root = join(d, "artifacts");
  mkdirSync(root, { recursive: true });
  const a = writeFileSync(join(root, "a.log"), "alpha\n");
  const b = writeFileSync(join(root, "b.mjs"), "beta\n");
  void a;
  void b;
  const index = {
    schemaVersion: 1,
    artifactsRoot: root,
    items: [
      { path: "a.log", sha256: sha256("alpha\n") },
      { path: "b.mjs", sha256: sha256("beta\n") },
      ...(overrides.items ?? []),
    ],
    ...(overrides.index ?? {}),
  };
  const indexPath = join(d, "index.json");
  writeFileSync(indexPath, JSON.stringify(index));
  return { d, root, indexPath };
}

test("replay-artifacts：全对表 exit 0", () => {
  const { d, indexPath } = fixture();
  try {
    const p = spawnSync(process.execPath, [SCRIPT, "--index", indexPath], { encoding: "utf8" });
    assert.equal(p.status, 0, p.stdout + p.stderr);
    assert.match(p.stdout, /全对表/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("replay-artifacts：篡改=失配 exit 1（fail-closed）", () => {
  const { d, root, indexPath } = fixture();
  writeFileSync(join(root, "b.mjs"), "tampered\n");
  try {
    const p = spawnSync(process.execPath, [SCRIPT, "--index", indexPath], { encoding: "utf8" });
    assert.equal(p.status, 1);
    assert.match(p.stdout, /MISMATCH b\.mjs/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("replay-artifacts：缺席条目 exit 1", () => {
  const { d, indexPath } = fixture({ items: [{ path: "gone.log", sha256: "0".repeat(64) }] });
  try {
    const p = spawnSync(process.execPath, [SCRIPT, "--index", indexPath], { encoding: "utf8" });
    assert.equal(p.status, 1);
    assert.match(p.stdout, /MISSING gone\.log/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("replay-artifacts：索引不可读 exit 1（不静默通过）", () => {
  const { d, indexPath } = fixture();
  writeFileSync(indexPath, "{broken json");
  try {
    const p = spawnSync(process.execPath, [SCRIPT, "--index", indexPath], { encoding: "utf8" });
    assert.equal(p.status, 1);
    assert.match(p.stderr, /索引不可读/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
