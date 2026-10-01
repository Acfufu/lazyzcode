// 双图只读视图契约（决策 #46，goal orch-discipline#N6）：lzy loop graph 输出执行图
// （拓扑层/关键路径/可并行集/阻塞链）×失效 DAG 证据现行性三字面；无 goal 目录恢复式
// 报错非 0；失效 DAG 账本分歧时视图降级告警行不炸全图（只读不执法）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli", "lzy.js");
const NODE = process.execPath;

function fixtureGoal(cwd) {
  mkdirSync(join(cwd, ".lazyzcode", "loop"), { recursive: true });
  // v1 legacy goal：readGoal 零额外要求（视图消费 steps/deps/status 即可）
  const goal = {
    version: 1,
    slug: "graphfix",
    title: "graph view fixture",
    status: "executing",
    attempt: 1,
    createdAt: new Date().toISOString(),
    steps: [
      { id: "A1", kind: "N", title: "head", status: "pending" },
      { id: "A2", kind: "N", title: "mid", status: "pending", deps: ["A1"] },
      { id: "A3", kind: "F", title: "leaf", status: "pending", deps: ["A2"] },
      { id: "B1", kind: "N", title: "solo", status: "pending" },
      { id: "C7", kind: "N", title: "done step", status: "done" },
    ],
  };
  writeFileSync(join(cwd, ".lazyzcode", "loop", "goal.json"), `${JSON.stringify(goal, null, 2)}\n`);
}

test("loop graph：执行图三字面（拓扑层/关键路径/可并行集/阻塞链）+证据现行性行头", () => {
  const cwd = mkdtempSync(join(tmpdir(), "lzy-graph-"));
  try {
    fixtureGoal(cwd);
    const p = spawnSync(NODE, [CLI, "loop", "graph"], { cwd, encoding: "utf8", shell: false, timeout: 60_000 });
    assert.equal(p.status, 0, `退出 0（实得 ${p.status}）：${p.stderr?.slice(0, 200)}`);
    for (const lit of ["拓扑层", "关键路径", "可并行集", "阻塞链", "证据现行性", "失效 DAG"]) {
      assert.ok(p.stdout.includes(lit), `输出含「${lit}」字面`);
    }
    // 夹具语义：关键路径 A1→A2→A3（链长 3，B1 独立头不入主链）；C7（done）不入剩余域
    assert.ok(p.stdout.includes("A1 → A2 → A3"), `关键路径 A1 → A2 → A3`);
    assert.ok(/链长 3/.test(p.stdout));
    assert.ok(/可并行集.*A1, B1|可并行集.*B1, A1/.test(p.stdout), `可并行集含 A1/B1（无阻塞无认领）`);
    assert.ok(/阻塞链：A2 ← 依赖未完成 A1/.test(p.stdout));
    assert.ok(!/C7/.test(p.stdout), "done 步不入剩余工作域");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("loop graph：无 goal 目录恢复式报错非 0", () => {
  const cwd = mkdtempSync(join(tmpdir(), "lzy-graph-none-"));
  try {
    const p = spawnSync(NODE, [CLI, "loop", "graph"], { cwd, encoding: "utf8", shell: false, timeout: 60_000 });
    assert.notEqual(p.status, 0);
    assert.match(p.stderr, /本目录没有目标循环状态/);
    assert.match(p.stderr, /恢复：/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
