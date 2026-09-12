// cost 契约测试：聚合纯函数喂 canned sqlite3 -json 行（CI 零 sqlite 依赖）+ CLI 降级读面。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computePoints,
  overlayMultiplier,
  standingMultiplier,
  attributeGoalPoints,
  claimedSessionIds,
} from "../core/cost.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
// HOME 隔离（沿 e2e 先例）+ 引擎探测抑制：CLI 不读真实账本、不向 scratch 写日志。
const ISOLATED_HOME = mkdtempSync(join(tmpdir(), "lzy-cost-home-"));
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";

const H = (iso) => Math.floor(Date.parse(iso) / 3_600_000); // 小时桶（与 USAGE_SQL 同口径）
const row = (over) => ({ sid: "s1", dir: "/w", model: "GLM-5.3-Flash", it: 0, crt: 0, ot: 0, ...over });

test("常设时段乘数：GLM 高峰 ×1.0 / 非高峰五折 ×0.5（UTC+8 纯函数，与本地时区无关）", () => {
  assert.equal(standingMultiplier(Date.parse("2026-09-11T15:00:00+08:00")), 1.0); // 周五 15 点高峰
  assert.equal(standingMultiplier(Date.parse("2026-09-11T10:00:00+08:00")), 0.5); // 工作日非高峰
  assert.equal(standingMultiplier(Date.parse("2026-09-13T15:00:00+08:00")), 0.5); // 周末同时刻非高峰
});

test("促销 overlay：夜窗取代常设（Flash 0 / 其他 ×2）、窗外与退役后回落 null", () => {
  const night = Date.parse("2026-09-12T23:30:00+08:00"); // 活动期夜间（跨午夜窗）
  assert.equal(overlayMultiplier("GLM-5.3-Flash", night), 0);
  assert.equal(overlayMultiplier("GLM-5.3", night), 2);
  assert.equal(overlayMultiplier("minimax-m2.7", night), 2); // "*" 兜底
  assert.equal(overlayMultiplier("GLM-5.3", Date.parse("2026-09-13T08:59:00+08:00")), 2); // 窗尾 09 前一刻仍在窗
  assert.equal(overlayMultiplier("GLM-5.3", Date.parse("2026-09-12T15:00:00+08:00")), null); // 白昼窗外
  assert.equal(overlayMultiplier("GLM-5.3", Date.parse("2026-09-21T01:00:00+08:00")), null); // 9/20 退役后夜窗
});

test("computePoints：系数×乘数、夜窗取代、未计价模型如实缺表计 0", () => {
  const nightH = H("2026-09-12T23:00:00+08:00");
  const dayH = H("2026-09-13T15:00:00+08:00");
  const r = computePoints([
    row({ sid: "a", model: "GLM-5.3-Flash", h: nightH, it: 1_000_000 }), // 2.3×0=0（不限量）
    row({ sid: "a", model: "GLM-5.3", h: nightH, it: 1_000_000 }), // 6.9×2=13.8（翻倍）
    row({ sid: "a", model: "GLM-5.3-Flash", h: dayH, it: 1_000_000 }), // 2.3×0.5=1.15（常设非高峰）
    row({ sid: "a", model: "minimax-m2.7", h: dayH, it: 1_000_000 }), // 未计价→0+提示集
  ]);
  assert.ok(r.unpricedModels.has("minimax-m2.7"));
  assert.equal(Math.round(r.points * 100) / 100, 14.95);
  assert.equal(Math.round(r.bySession.get("a") * 100) / 100, 14.95);
});

test("OR 归因：时间窗 ∩（目录=本仓 ∪ 认领会话）；claimedSessionIds 只认带 claimedAt 的会话文件", () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-cost-"));
  try {
    const sess = join(d, ".lazyzcode", "loop", "sessions");
    mkdirSync(sess, { recursive: true });
    writeFileSync(join(sess, "claimed.json"), JSON.stringify({ claimedAt: "2026-09-13T01:00:00Z" }));
    writeFileSync(join(sess, "plain.json"), JSON.stringify({ continues: 1 }));
    assert.deepEqual([...claimedSessionIds(d)], ["claimed"]);
    const goal = { slug: "g", status: "executing", startedAt: "2026-09-12T09:00:00+08:00", finishedAt: null, steps: [] };
    const rows = [
      row({ sid: "claimed", dir: "/elsewhere", model: "GLM-5.3", h: H("2026-09-12T10:00:00+08:00"), it: 1_000_000 }), // 认领→入
      row({ sid: "x", dir: d, model: "GLM-5.3", h: H("2026-09-12T11:00:00+08:00"), it: 1_000_000 }), // 目录=本仓→入
      row({ sid: "y", dir: "/elsewhere", model: "GLM-5.3", h: H("2026-09-12T12:00:00+08:00"), it: 1_000_000 }), // 双不沾→出
      row({ sid: "claimed", dir: "/elsewhere", model: "GLM-5.3", h: H("2026-09-11T23:00:00+08:00"), it: 1_000_000 }), // 窗外→出
    ];
    const att = attributeGoalPoints(rows, goal, d, claimedSessionIds(d));
    assert.equal(att.sessions, 2);
    assert.equal(Math.round(att.points * 100) / 100, 6.9); // 两行各 6.9×0.5（周日白昼非高峰）
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("CLI：lzy loop cost 无账本降级输出退出码 0（ISOLATED_HOME，零 sqlite 依赖）", () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-cost-"));
  try {
    const r = spawnSync(process.execPath, [CLI, "loop", "cost"], {
      cwd: d,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, HOME: ISOLATED_HOME, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
    });
    assert.equal(r.status, 0);
    assert.match(`${r.stdout}${r.stderr}`, /计费账本缺席/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
