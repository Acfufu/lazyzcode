// 迁移预览（0.3.0 M1，主方案 §8/M0 §9）契约：活跃 goal 拒、草案形状（authorization=NONE
// +提权禁止点）、验收草案自快照 F 断言、零写回（预览前后逐文件 sha256 不变）、损坏记录
// ⚠ 显形不阻断。家法：真子进程。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = join(ROOT, "cli", "lzy.js");

function lzyAt(args, cwd, HOME) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "lzy-test-suppress" },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function legacyRoot() {
  const d = mkdtempSync(join(tmpdir(), "lzy-mg-"));
  const HOME = mkdtempSync(join(tmpdir(), "lzy-mg-home-"));
  mkdirSync(join(d, ".lazyzcode", "attestations"), { recursive: true });
  mkdirSync(join(d, ".lazyzcode", "loop", "approvals"), { recursive: true });
  mkdirSync(join(d, ".lazyzcode", "loop", "snapshots"), { recursive: true });
  writeFileSync(
    join(d, ".lazyzcode", "attestations", "old-goal-20260101T000000Z.json"),
    JSON.stringify({ attemptId: "old-goal-20260101T000000Z", at: 1700000000000, slug: "old-goal", title: "old", tier: "heavy", planHash: "a".repeat(64), subjects: [], fingerprint: "b".repeat(64) }),
  );
  writeFileSync(
    join(d, ".lazyzcode", "loop", "approvals", "aaaaaaaa-sess_old-1.json"),
    JSON.stringify({ version: 1, slug: "old-goal", planHash: "a".repeat(64), at: "2026-01-01T00:00:00.000Z", sessionId: "sess_old" }),
  );
  writeFileSync(
    join(d, ".lazyzcode", "loop", "snapshots", "old-goal.md"),
    "# 计划\n\n- [F1] things verified on real surface\n- [F2] recovery works\n",
  );
  return { d, HOME };
}

function snapshotTree(dir) {
  const out = new Map();
  const walk = (p) => {
    for (const name of readdirSync(p)) {
      const full = join(p, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(full, createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(dir);
  return out;
}

test("迁移预览：活跃 goal 在场拒（在途不接管）", () => {
  const { d, HOME } = legacyRoot();
  const g = spawnSync("git", ["init", "-q"], { cwd: d });
  void g;
  writeFileSync(join(d, ".lazyzcode", "loop", "goal.json"), JSON.stringify({ version: 1, slug: "live", status: "executing" }));
  const r = lzyAt(["migrate", "preview", d], d, HOME);
  assert.equal(r.code, 1);
  assert.match(r.out, /迁移预览拒绝/);
  assert.match(r.out, /executing/);
});

test("迁移预览：残档根产草案——authorization NONE、提权禁止点、验收草案自 F 断言", () => {
  const { d, HOME } = legacyRoot();
  const r = lzyAt(["migrate", "preview", d], d, HOME);
  assert.equal(r.code, 0);
  assert.match(r.out, /authorization：NONE/);
  assert.match(r.out, /旧 planHash 批准.*不得重放为契约授权/);
  assert.match(r.out, /F1: things verified on real surface/);
  assert.match(r.out, /F2: recovery works/);
  assert.match(r.out, /endpoint 草案：A/);
  assert.match(r.out, /旧 attestation ≠ 新 A\/B\/C 交付终点的完成证据/);
  assert.match(r.out, /attestations 1 · snapshots 1 · salvage 0 · approvals 1/);
});

test("迁移预览：零写回——预览前后全目录逐文件 sha256 一致", () => {
  const { d, HOME } = legacyRoot();
  const before = snapshotTree(d);
  const r = lzyAt(["migrate", "preview", d], d, HOME);
  assert.equal(r.code, 0);
  const after = snapshotTree(d);
  assert.equal(before.size, after.size);
  for (const [p, h] of before) assert.equal(after.get(p), h, `${p} 被写回`);
});

test("迁移预览：损坏记录 ⚠ 显形不阻断展示面", () => {
  const { d, HOME } = legacyRoot();
  writeFileSync(join(d, ".lazyzcode", "attestations", "broken.json"), "{not json");
  const r = lzyAt(["migrate", "preview", d], d, HOME);
  assert.equal(r.code, 0);
  assert.match(r.out, /⚠.*broken\.json/);
  assert.match(r.out, /authorization：NONE/);
});

test("迁移预览：goal.json 在场但不可解析=拒（未知状态保守停）", () => {
  const { d, HOME } = legacyRoot();
  writeFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "{broken");
  const r = lzyAt(["migrate", "preview", d], d, HOME);
  assert.equal(r.code, 1);
  assert.match(r.out, /不可解析/);
});
