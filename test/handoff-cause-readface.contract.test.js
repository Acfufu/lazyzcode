// 读面契约（M2 N6，决策 #47 必落／a1.r10 F-3）：drive 收束分族进 status 读面——
// metrics.json 带 cause:<族> 计数（handoffGoal 登记累加，跨 reset 永续）时，
// status --json checks 含 handoff-causes 行（ok＋分族计数 detail；无登记=skip 不误警）；
// 观察面契约不破（schemaVersion=1、顶层四键、checks 三键——status-doctor-json 契约同域）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli", "lzy.js");

function fixtureMetrics(metrics) {
  const d = mkdtempSync(join(tmpdir(), "lzy-cause-readface-"));
  mkdirSync(join(d, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(join(d, ".lazyzcode", "loop", "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  return d;
}

function statusJson(cwd) {
  const p = spawnSync(process.execPath, [CLI, "status", "--json"], { cwd, encoding: "utf8", shell: false, timeout: 120_000 });
  return JSON.parse(p.stdout);
}

test("handoff-causes：cause:* 计数在场时 status --json 出 ok 行分族计数", () => {
  const d = fixtureMetrics({ registered: 2, consumed: 1, "cause:gate": 2, "cause:segment-failed": 1 });
  try {
    const parsed = statusJson(d);
    const row = parsed.checks.find((c) => c.name === "handoff-causes");
    assert.ok(row, "handoff-causes 行缺席");
    assert.equal(row.state, "ok");
    assert.ok(row.detail.includes("gate×2"), `gate 计数缺席：${row.detail}`);
    assert.ok(row.detail.includes("segment-failed×1"), `segment-failed 计数缺席：${row.detail}`);
    // 观察面契约同域不破：schemaVersion/顶层四键/checks 三键
    assert.equal(parsed.schemaVersion, 1);
    assert.deepEqual(Object.keys(parsed).sort(), ["checks", "command", "ok", "schemaVersion"]);
    for (const c of parsed.checks) assert.deepEqual(Object.keys(c).sort(), ["detail", "name", "state"]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("handoff-causes：无 cause:* 登记=skip（不误警；疤痕巡逻豁免纪律）", () => {
  const d = fixtureMetrics({ registered: 5, consumed: 5 });
  try {
    const parsed = statusJson(d);
    const row = parsed.checks.find((c) => c.name === "handoff-causes");
    assert.ok(row, "handoff-causes 行缺席（有 metrics 时行应在场）");
    assert.equal(row.state, "skip", `无登记应 skip：${row.state}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("handoff-causes：metrics.json 缺席=行整体缺席（与 handoff-usage 同隐现）", () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-cause-readface-empty-"));
  try {
    const parsed = statusJson(d);
    assert.ok(!parsed.checks.some((c) => c.name === "handoff-causes"), "无 metrics 不应出行");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
