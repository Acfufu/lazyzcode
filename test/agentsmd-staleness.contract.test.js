// 项目记忆过期指纹契约测试（memory-staleness-fingerprint）：formatStalenessHint 纯函数钉 +
// core/git.js mapLag 的临时 git fixture 钉。git 夹具纪律：每个 commit 前置真实文件改动
// （无改动的 commit 会静默失败，教训见项目记忆 git-fixture-silent-commit），断言写具体数字。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGit } from "../core/git.js";
import { STALENESS_HINT_AT, formatStalenessHint } from "../core/doctor.js";

test("formatStalenessHint：null/未达阈值→空串，≥阈值→后缀且内嵌数字", () => {
  assert.equal(formatStalenessHint(null), "");
  assert.equal(formatStalenessHint(0), "");
  assert.equal(formatStalenessHint(STALENESS_HINT_AT - 1), "");
  const hint = formatStalenessHint(STALENESS_HINT_AT);
  assert.match(hint, /地图落后 50 个提交/);
  assert.match(hint, /lazyzcode:init-deep 可刷新/);
  assert.match(formatStalenessHint(STALENESS_HINT_AT + 7), /地图落后 57 个提交/);
});

// git fixture 工厂：init → 提交 AGENTS.md（地图基点）→ 对覆盖目录做 n 个提交。
// 全线性历史（规避 merge/空提交对 rev-list 计数的形状差异，已知未知③）。
function gitFixture() {
  const d = mkdtempSync(join(tmpdir(), "lzy-stale-"));
  const git = (args) =>
    spawnSync("git", args, { cwd: d, encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  writeFileSync(join(d, "AGENTS.md"), "# map\ndocs/ 文档\n");
  mkdirSync(join(d, "docs"), { recursive: true });
  writeFileSync(join(d, "docs", "placeholder"), "x\n");
  git(["add", "AGENTS.md", "docs"]);
  assert.equal(git(["commit", "-qm", "docs: map baseline"]).status, 0);
  return { d, git };
}

test("mapLag：基点后覆盖目录 3 个提交 → 恰 3；地图再提交 → 重置为 0", () => {
  const { d, git } = gitFixture();
  try {
    for (let i = 1; i <= 3; i += 1) {
      writeFileSync(join(d, "docs", `f${i}.md`), `v${i}\n`);
      git(["add", "docs"]);
      assert.equal(git(["commit", "-qm", `docs: change ${i}`]).status, 0);
    }
    assert.equal(createGit(d).mapLag(["docs"]), 3);
    // 不相关路径的提交不计入 lag
    writeFileSync(join(d, "unrelated.txt"), "x\n");
    git(["add", "unrelated.txt"]);
    assert.equal(git(["commit", "-qm", "chore: unrelated"]).status, 0);
    assert.equal(createGit(d).mapLag(["docs"]), 3);
    // 地图重写（再提交 AGENTS.md）抬高基点 → 重置
    writeFileSync(join(d, "AGENTS.md"), "# map v2\ndocs/ 文档\n");
    git(["add", "AGENTS.md"]);
    assert.equal(git(["commit", "-qm", "docs: refresh map"]).status, 0);
    assert.equal(createGit(d).mapLag(["docs"]), 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("mapLag 数据沉默三态：非 git 目录 / 地图从未提交 / 空覆盖集 → 全 null", () => {
  // ①非 git 目录
  const plain = mkdtempSync(join(tmpdir(), "lzy-stale-plain-"));
  try {
    assert.equal(createGit(plain).mapLag(["docs"]), null);
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
  // ②git 仓但 AGENTS.md 从未提交（无基点；注意：rm 掉已提交的地图不算此态——
  // 历史基点仍在，lag 走正常计数）
  const never = mkdtempSync(join(tmpdir(), "lzy-stale-never-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: never, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "t@t"], { cwd: never, encoding: "utf8" });
    spawnSync("git", ["config", "user.name", "t"], { cwd: never, encoding: "utf8" });
    writeFileSync(join(never, "AGENTS.md"), "# map\n");
    writeFileSync(join(never, "a.txt"), "x\n");
    spawnSync("git", ["add", "a.txt"], { cwd: never, encoding: "utf8" });
    assert.equal(
      spawnSync("git", ["commit", "-qm", "chore: only code"], { cwd: never, encoding: "utf8" }).status,
      0,
    );
    assert.equal(createGit(never).mapLag(["."]), null);
  } finally {
    rmSync(never, { recursive: true, force: true });
  }
  // ③空覆盖集
  const { d: d2 } = gitFixture();
  try {
    assert.equal(createGit(d2).mapLag([]), null);
  } finally {
    rmSync(d2, { recursive: true, force: true });
  }
  assert.equal(existsSync(plain), false);
});
