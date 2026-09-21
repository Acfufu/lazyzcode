// 进度信号状态集契约（0.2.2 棒1#N2，拍板 Q3 / ADJ-34 根因修法）：
// ①四族信号采集正确，其中 subject 头树集是新增的「提交即推进」面；
// ②never-throw 降级——任一源失败沿用 prev（首段取哨兵），绝不冒泡（drive 段循环无 catch，
//   冒泡=不写 7 字段快照，破 drive 契约）；
// ③不含脏树：只写不提交不算推进。
// HOME 隔离+引擎抑制（债③家法）；win32 雷回避：不 split("/")、路径断言用 join。
import { test } from "node:test";
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { UNAVAILABLE, progressSignature, signatureKey } from "../core/progress.js";
import { loopDir } from "../core/loop.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-progress-home-"));

function repo(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (...args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g("init", "-q");
  g("config", "user.email", "t@l");
  g("config", "user.name", "t");
  writeFileSync(join(d, "a.txt"), "a\n");
  g("add", "a.txt");
  g("commit", "-qm", "init");
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

test("N2 · 提交（头树变）即推进——这是旧判据看不见的那一半", () => {
  const d = repo("lzy-progress-commit-");
  lzy(["loop", "register", "p", "--title", "t"], d);
  writeFileSync(join(d, "p.md"), "- [N1] x\n- [F1] y\n");
  assert.equal(lzy(["loop", "plan", "p.md"], d).code, 0);
  assert.equal(lzy(["loop", "start"], d).code, 0);
  const goal = JSON.parse(readFileSync(join(loopDir(d), "goal.json"), "utf8"));

  const before = progressSignature(d, goal, null);
  assert.equal(before.done, 0, "未完成任何步");
  assert.equal(typeof before.trees, "string");
  assert.equal(before.greens, 0, "空账本 → 0 绿节点");
  assert.equal(before.handoffs, 0);
  assert.equal(before.salvage, 0);

  // 只提交、不翻步：步数不动，头树必动 → 签名必须变（旧判据在此误判零推进）
  writeFileSync(join(d, "work.txt"), "real work\n");
  spawnSync("git", ["add", "-A"], { cwd: d });
  spawnSync("git", ["-c", "user.email=t@l", "-c", "user.name=t", "commit", "-qm", "work"], { cwd: d });
  const after = progressSignature(d, goal, null);
  assert.equal(after.done, before.done, "步数未翻（本用例前提）");
  assert.notEqual(after.trees, before.trees, "提交必须改变头树集");
  assert.notEqual(signatureKey(after), signatureKey(before), "签名必须前进");
});

test("N2 · 脏树不算推进（只写不提交不延长 leash）", () => {
  const d = repo("lzy-progress-dirty-");
  const goal = { slug: "p", steps: [] };
  const before = progressSignature(d, goal, null);
  writeFileSync(join(d, "uncommitted.txt"), "churn\n");
  const after = progressSignature(d, goal, null);
  assert.equal(signatureKey(after), signatureKey(before), "未提交改动不得改变签名");
});

test("N2 · never-throw 降级：账本损坏时沿用 prev，绝不冒泡", () => {
  const d = repo("lzy-progress-degrade-");
  const goal = { slug: "p", steps: [] };
  mkdirSync(loopDir(d), { recursive: true });
  writeFileSync(join(loopDir(d), "dag.json"), "{ 这不是合法 JSON");
  const prev = { done: 0, trees: "T", greens: 7, handoffs: 0, salvage: 0 };

  let sig;
  assert.doesNotThrow(() => {
    sig = progressSignature(d, goal, prev);
  }, "账本损坏不得冒泡（drive 段循环无 catch，冒泡=丢快照）");
  assert.equal(sig.greens, 7, "失败的信号沿用 prev 的值");
  // 未失败的信号照常取真实读数（不得被 prev 顶掉——prev 只是失败时的兜底）
  assert.notEqual(sig.trees, "T", "源正常的信号应取真实读数而非 prev");
  assert.notEqual(sig.trees, UNAVAILABLE, "仓是 git 仓，头树应可读");
  assert.equal(sig.done, 0);

  // 首段无 prev → 哨兵，且仍不抛
  let first;
  assert.doesNotThrow(() => {
    first = progressSignature(d, goal, null);
  });
  assert.equal(first.greens, UNAVAILABLE, "首段失败取哨兵");
});

test("N2 · 交接快照与 salvage 存根入签名", () => {
  const d = repo("lzy-progress-handoff-");
  const goal = { slug: "p", steps: [] };
  const before = progressSignature(d, goal, null);
  mkdirSync(join(loopDir(d), "handoff"), { recursive: true });
  writeFileSync(join(loopDir(d), "handoff", "p-20260921T000000Z.md"), "# 交接快照\n");
  mkdirSync(join(loopDir(d), "salvage"), { recursive: true });
  writeFileSync(join(loopDir(d), "salvage", "old-goal.md"), "# 存根\n");
  const after = progressSignature(d, goal, null);
  assert.equal(after.handoffs, 1);
  assert.equal(after.salvage, 1);
  assert.notEqual(signatureKey(after), signatureKey(before));
});
