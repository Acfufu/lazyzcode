// 目标谱系读面契约（pisper-absorption#N4）：lzy loop history 三源并集
// （证据包报告 ∪ salvage 存根 ∪ git 尾注），缺源降级与空态。
// 真实 git 仓夹具 + 临时 .lazyzcode 账目；不触碰真实 $HOME。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");

const ISOLATED_HOME = mkdtempSync(join(tmpdir(), "lzy-history-home-"));

function initRepo(withTrailers = true) {
  const d = mkdtempSync(join(tmpdir(), "lzy-history-"));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  if (!withTrailers) return d;
  // 每次提交前置文件改动——无 diff 的 git commit 会静默失败（nothing to commit）
  writeFileSync(join(d, "a.txt"), "b\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "feat: one", "-m", "Goal: alpha#N1"]);
  writeFileSync(join(d, "a.txt"), "c\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "feat: two", "-m", "Goal: alpha#N2"]);
  writeFileSync(join(d, "a.txt"), "d\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "chore: no trailer"]);
  return d;
}

function seedLedger(d) {
  mkdirSync(join(d, ".lazyzcode", "loop", "salvage"), { recursive: true });
  mkdirSync(join(d, ".lazyzcode", "evidence"), { recursive: true });
  writeFileSync(
    join(d, ".lazyzcode", "evidence", "alpha.report.md"),
    "# 目标循环报告：alpha — 测试\n\n- 状态 done · 创建 2026-09-01T00:00:00.000Z · 完成 2026-09-02T00:00:00.000Z\n",
  );
  writeFileSync(
    join(d, ".lazyzcode", "loop", "salvage", "alpha.md"),
    "# 可回收工件存根 — alpha\n\n目标循环已reset 清除（2026-09-03T00:00:00.000Z）。接管者从这里开始：\n\n## 未提交改动（.lazyzcode/ 自身不计）\n- x.txt\n\n## 带本目标尾注的提交（Goal: alpha#）\n- abc feat: one\n",
  );
  writeFileSync(
    join(d, ".lazyzcode", "loop", "salvage", "gamma.md"),
    "# 可回收工件存根 — gamma\n\n目标循环已reset 清除（2026-09-04T00:00:00.000Z）。接管者从这里开始：\n",
  );
}

function history(cwd) {
  const r = spawnSync(process.execPath, [CLI, "loop", "history"], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, HOME: ISOLATED_HOME, USERPROFILE: ISOLATED_HOME },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test("history：三源齐——alpha=done/2 提交/证据包/存根；beta 仅尾注；gamma 已回收", () => {
    const d = initRepo();
    try {
      writeFileSync(join(d, "a.txt"), "e\n");
      spawnSync("git", ["add", "a.txt"], { cwd: d, encoding: "utf8" });
      spawnSync("git", ["commit", "-qm", "feat: beta", "-m", "Goal: beta#N1"], {
        cwd: d,
        encoding: "utf8",
      });
      seedLedger(d);
    const { code, out } = history(d);
    assert.equal(code, 0, out);
    // alpha：报告状态 + git 尾注计数（无尾注的 init/chore 不计）+ 两源旗标
    assert.match(out, /alpha/);
    assert.match(out, /done/);
    assert.match(out, /2 提交/);
    assert.match(out, /证据包✓/);
    assert.match(out, /存根✓\(未提交 1\)/);
    // beta：只有 git 尾注 → 仅尾注
    assert.match(out, /beta/);
    assert.match(out, /仅尾注/);
    // gamma：只有存根 → 已回收，无提交
    assert.match(out, /gamma/);
    assert.match(out, /已回收/);
    // 空态行不出现
    assert.doesNotMatch(out, /没有历史目标/);
  } finally {
    cleanup(d);
  }
});

test("history：缺源降级——无尾注纯 git 仓与非 git 目录都给友好空态", () => {
  const repo = initRepo(false);
  const plain = mkdtempSync(join(tmpdir(), "lzy-history-plain-"));
  try {
    // 纯 git 仓：有提交但全无 Goal: 尾注、无账目目录 → 空态
    const r1 = history(repo);
    assert.equal(r1.code, 0, r1.out);
    assert.match(r1.out, /没有历史目标/);
    // 非 git 目录：trailersBySlug 返回 null 降级，不 throw
    const r2 = history(plain);
    assert.equal(r2.code, 0, r2.out);
    assert.match(r2.out, /没有历史目标/);
  } finally {
    cleanup(repo, plain);
  }
});
