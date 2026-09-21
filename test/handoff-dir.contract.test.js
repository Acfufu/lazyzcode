// handoff 目录闭合契约（0.2.2 棒1#N1）：①枚举器 listHandoffSnapshots（交接快照是本棒
// 「进度信号状态集」的信号之一）；②doctor EXEMPT 收编 `loop/handoff/`——ADJ-23 把快照落
// 工作区且属 reset 不清家族（下一次唤起要从盘上读续跑状态），此前缺席 EXEMPT 使**合法**
// 快照被判「空壳疤痕」并被指路删除（侦测记录 artifacts/v022-b1-red/f6.txt）。
// 第三例是反例守卫：EXEMPT 收编不得退化成「永不报疤痕」——真残留仍须点名。
// HOME 隔离+引擎抑制（债③家法）；win32 雷回避：不 split("/")、路径断言用 join。
import { test } from "node:test";
// 人权门非本文件被测面——spawn 继承此 env 保任意采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handoffDir, listHandoffSnapshots } from "../core/loop.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-handoff-home-"));

function repo(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  return d;
}

function lzy(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function plantSnapshot(d, name = "some-slug-20260921T000000Z.md") {
  mkdirSync(handoffDir(d), { recursive: true });
  writeFileSync(join(handoffDir(d), name), "# 交接快照\n## 剩余步骤\nN9\n");
}

test("N1 · listHandoffSnapshots 枚举 .md 快照，目录缺席降级空集", () => {
  const d = repo("lzy-handoff-enum-");
  assert.deepEqual(listHandoffSnapshots(d), [], "目录缺席 = 空集（不抛）");
  plantSnapshot(d, "s1-20260921T000000Z.md");
  plantSnapshot(d, "s2-20260921T010000Z.md");
  writeFileSync(join(handoffDir(d), "notes.txt"), "非快照面");
  assert.deepEqual(listHandoffSnapshots(d).sort(), ["s1-20260921T000000Z", "s2-20260921T010000Z"]);
  // handoffDir 与 drive 写入面同源（单点防漂移）
  assert.equal(handoffDir(d), join(d, ".lazyzcode", "loop", "handoff"));
});

test("N1 · 残留 handoff 快照 + 无 goal.json → 不再误报空壳疤痕", () => {
  const d = repo("lzy-handoff-scar-");
  plantSnapshot(d);
  const r = lzy(["doctor"], d);
  assert.ok(!/空壳疤痕/.test(r.out), `不应报疤痕，实得：${r.out}`);
  assert.ok(!/可删残留/.test(r.out), `不应指路删除合法快照，实得：${r.out}`);
  assert.match(r.out, /无目标循环状态（干净）/);
});

test("N1 · 反例守卫：真残留仍须点名（EXEMPT 收编未退化为永不报疤痕）", () => {
  const d = repo("lzy-handoff-residue-");
  plantSnapshot(d);
  writeFileSync(join(d, ".lazyzcode", "loop", "stray.bin"), "真残留");
  const r = lzy(["doctor"], d);
  assert.match(r.out, /空壳疤痕/, `真残留必须仍被点名，实得：${r.out}`);
  // 可删残留=且仅是真残留（正则锚到分号：`.*` 会贪心跨进后面的常驻面括号，误判）
  assert.match(r.out, /可删残留：stray\.bin；/, `应且只应点名 stray.bin，实得：${r.out}`);
  // handoff 归类为「reset 不清的常驻账本」而非可删残留——这是本修的语义落点
  assert.match(r.out, /reset 不清的常驻账本（handoff）/, `handoff 应归常驻面，实得：${r.out}`);
});
