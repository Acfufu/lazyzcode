// cost 契约测试：聚合纯函数喂 canned sqlite3 -json 行（CI 零 sqlite 依赖）+ CLI 降级读面。
import { test } from "node:test";
// 人权门非本文件被测面（门由 human-gate.contract.test.js 两面钉）——spawn 继承此 env 保采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COEFFICIENTS,
  MODEL_ALIASES,
  WATERLINE_ROLLING_SQL,
  coefficientFor,
  computePoints,
  overlayMultiplier,
  standingMultiplier,
  attributeGoalPoints,
  claimedSessionIds,
  pricedScopeLabel,
  waterlineScopeNote,
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

test("促销 overlay（官方公告核对版）：夜窗 ZCode 内 Flash 0、未设键模型回落常设、窗外与退役后 null", () => {
  const night = Date.parse("2026-09-12T23:30:00+08:00"); // 活动期夜间（跨午夜窗）
  assert.equal(overlayMultiplier("GLM-5.3-Flash", night), 0);
  assert.equal(overlayMultiplier("GLM-5.3", night), null); // 公告：GLM-5.3 按标准规则——不设键回落常设
  assert.equal(overlayMultiplier("minimax-m2.7", night), null); // 条款未提的模型不乱折
  assert.equal(overlayMultiplier("GLM-5.3-Flash", Date.parse("2026-09-13T08:59:00+08:00")), 0); // 窗尾 09 前一刻仍在窗
  assert.equal(overlayMultiplier("GLM-5.3-Flash", Date.parse("2026-09-02T23:30:00+08:00")), null); // 首夜（9/3 夜）之前
  assert.equal(overlayMultiplier("GLM-5.3-Flash", Date.parse("2026-09-12T15:00:00+08:00")), null); // 白昼窗外
  assert.equal(overlayMultiplier("GLM-5.3-Flash", Date.parse("2026-09-21T08:59:00+08:00")), 0); // 末夜（9/20 夜）尾段仍有效
  assert.equal(overlayMultiplier("GLM-5.3-Flash", Date.parse("2026-09-21T23:30:00+08:00")), null); // 9/21 夜：活动已过
});

test("computePoints：系数×乘数、夜窗取代、未计价模型如实缺表计 0", () => {
  const nightH = H("2026-09-12T23:00:00+08:00");
  const dayH = H("2026-09-13T15:00:00+08:00");
  const r = computePoints([
    row({ sid: "a", model: "GLM-5.3-Flash", h: nightH, it: 1_000_000 }), // ZCode 内 2.3×0=0
    row({ sid: "a", model: "GLM-5.3", h: nightH, it: 1_000_000 }), // 标准规则=夜间非高峰 6.9×0.5=3.45
    row({ sid: "a", model: "GLM-5.3-Flash", h: dayH, it: 1_000_000 }), // 2.3×0.5=1.15（常设非高峰）
    row({ sid: "a", model: "minimax-m2.7", h: dayH, it: 1_000_000 }), // 未计价→0+提示集
  ]);
  assert.ok(r.unpricedModels.has("minimax-m2.7"));
  assert.equal(Math.round(r.points * 100) / 100, 4.6);
  assert.equal(Math.round(r.bySession.get("a") * 100) / 100, 4.6);
});

// ADJ-55（0.2.1 五轮双审·成立；0.2.2 棒1#N8 收口）：口径披露句=单一来源纯函数，现为
// **常驻**——「这是计价子集、读数是下界」不随窗口变，故表外零行也出声（旧实现会整句消失）。
// 表外有行时附行数；计价范围取静态系数表。canonical SQL 同时取 pts 与表外行数两列
// （stop.js 副本同形，hooks.contract 面活体钉 nudge 文案）。
test("waterlineScopeNote：常驻出声、行数如实、计价范围取自系数表（ADJ-55/N8）", () => {
  for (const zero of [0, undefined, NaN]) {
    const s = waterlineScopeNote(zero);
    assert.match(s, /^（口径：仅 .* 计价——读数偏低；表外模型名见 lzy loop cost 未计价行）$/, `零行也须出声：${s}`);
    assert.ok(!/\d+ 行计 0/.test(s), "零行不报行数");
  }
  assert.match(waterlineScopeNote(1), /表外模型 1 行计 0/);
  assert.match(waterlineScopeNote(6133), /表外模型 6133 行计 0/);
  // 计价范围=系数表键（扩表后自动跟随，不再是写死的「GLM-5.3 族」）
  assert.ok(waterlineScopeNote(1).includes(pricedScopeLabel()));
  assert.match(pricedScopeLabel(), /DeepSeek-V4\.1-Flash/);
});

// 0.2.2 棒1#N8：扩表计价（ADR-0023）。三面——①归一化只做小写精确匹配，绝不模糊
// （模糊会「猜」到不该计价的 model_id 上）；②主力 provider 的账本形态现在计得出非零；
// ③水位 SQL 由表生成，故不存在「改了表忘了改 SQL」的半修窗口（ADJ-55 的原始成因）。
test("N8 · coefficientFor：小写精确匹配、形态归一、绝不模糊", () => {
  // 账本实见形态与规范名同解
  for (const id of [
    "deepseek/deepseek-v4.1-flash",
    "deepseek-v4.1-flash",
    "deepseek/deepseek-v4-flash",
  ]) {
    assert.deepEqual(coefficientFor(id), COEFFICIENTS["DeepSeek-V4.1-Flash"], id);
  }
  // 大小写形态归一到同一行（账本里 GLM 有大小写两种）
  assert.deepEqual(coefficientFor("glm-5.3-flash"), COEFFICIENTS["GLM-5.3-Flash"]);
  assert.deepEqual(coefficientFor("GLM-5.3-Flash"), COEFFICIENTS["GLM-5.3-Flash"]);
  // 表外一律 null——不猜
  for (const id of ["minimax-m2.7", "mimo-v2.5", "muse-spark-1.3-contributor",
                    "new-provider/deepseek-v4.1-flash-experimental", "", null, undefined]) {
    assert.equal(coefficientFor(id), null, String(id));
  }
});

test("N8 · 扩表后主力 provider 计得出非零（水位门不再对真实用量空转）", () => {
  const dayH = H("2026-09-13T15:00:00+08:00"); // 常设非高峰 → ×0.5
  const r = computePoints([
    row({ sid: "a", model: "deepseek/deepseek-v4.1-flash", h: dayH, it: 1_000_000, crt: 1_000_000, ot: 1_000_000 }),
  ]);
  // (2 + 0.04 + 8) / 1e6 × 1e6 × 0.5 = 5.02
  assert.equal(Math.round(r.points * 100) / 100, 5.02, "扩表前此行为 0");
  assert.equal(r.unpricedModels.size, 0, "已计价者不得再进表外集");
});

test("N8 · 水位 SQL 由系数表生成：别名与系数零漂移（ADJ-55 半修成因被封）", () => {
  for (const alias of Object.keys(MODEL_ALIASES)) {
    assert.ok(WATERLINE_ROLLING_SQL.includes(`'${alias}'`), `SQL 缺别名 ${alias}`);
  }
  for (const [key, c] of Object.entries(COEFFICIENTS)) {
    for (const v of [c.input, c.cacheRead, c.output]) {
      assert.ok(WATERLINE_ROLLING_SQL.includes(String(v)), `${key} 的系数 ${v} 未进 SQL`);
    }
  }
  assert.ok(WATERLINE_ROLLING_SQL.includes("lower(model_id)"), "匹配须走 lower()（大小写归一同 coefficientFor）");
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
      env: { ...process.env, HOME: ISOLATED_HOME, USERPROFILE: ISOLATED_HOME, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
    });
    assert.equal(r.status, 0);
    assert.match(`${r.stdout}${r.stderr}`, /计费账本缺席/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── 沙盒外泄账（0.5.0 明烧面，2026-10-02 commandcode 暗烧案收口）──
import { aggregateUsageRows, sandboxLedgerLine, appendSandboxUsage, readSandboxUsageLines, summarizeSandboxUsage, querySessionPoints } from "../core/cost.js";

test("aggregateUsageRows：按 (provider,model) 归组、tokens 求和、未计价组保留 tokens 计 0 分", () => {
  const dayH = H("2026-10-02T08:00:00+08:00"); // 周五白昼非高峰 → 常设 ×0.5
  const rows = [
    { sid: "s1", provider: "new-provider", model: "deepseek/deepseek-v4.1-flash", h: dayH, it: 1_000_000, crt: 1_000_000, ot: 1_000_000 },
    { sid: "s2", provider: "new-provider", model: "deepseek/deepseek-v4.1-flash", h: dayH, it: 500_000, crt: 0, ot: 0 }, // 跨会话同组
    { sid: "s1", provider: "other", model: "minimax-m2.7", h: dayH, it: 10, crt: 0, ot: 0 }, // 未计价
  ];
  const g = aggregateUsageRows(rows);
  assert.equal(g.length, 2);
  const ds = g.find((x) => x.model === "deepseek/deepseek-v4.1-flash");
  assert.equal(ds.provider, "new-provider");
  assert.equal(ds.inputTokens, 1_500_000);
  assert.equal(ds.cacheReadTokens, 1_000_000);
  assert.equal(ds.outputTokens, 1_000_000);
  // 计价单源核对：1.5×2 + 1×0.04 + 1×8 = 11.04 ×0.5 = 5.52
  assert.equal(Math.round(ds.points * 100) / 100, 5.52);
  const mm = g.find((x) => x.model === "minimax-m2.7");
  assert.equal(mm.inputTokens, 10, "未计价组 tokens 照实保留——烧了就是烧了");
  assert.equal(mm.points, 0);
});

test("sandboxLedgerLine：有 usage 成行（kind/project/runId/points），无 usage 返 null", () => {
  const now = new Date("2026-10-02T09:00:00+08:00");
  const rec = {
    runId: "fx.a1.r1", slug: "fx", attempt: 1, validity: { status: "valid" },
    metering: { status: "metered", points: 42, usage: [{ provider: "p", model: "m", inputTokens: 1, cacheReadTokens: 0, outputTokens: 0, points: 42 }] },
  };
  const line = sandboxLedgerLine("/x/y/proj", rec, now);
  assert.equal(line.kind, "review");
  assert.equal(line.project, "/x/y/proj", "project=仓库根全路径（同名项目不混账）");
  assert.equal(line.runId, "fx.a1.r1");
  assert.equal(line.points, 42);
  assert.equal(line.ts, now.toISOString());
  assert.equal(sandboxLedgerLine("/x/y/proj", { ...rec, metering: { status: "absent", points: null, note: "n" } }), null, "缺用量不算零不入账");
  assert.equal(sandboxLedgerLine("/x/y/proj", { ...rec, metering: { status: "metered", points: 42, usage: [] } }), null);
});

test("summarizeSandboxUsage：窗口化聚合（7d/30d/all）与 byKey tokens/points 求和（kind 过滤在读取面）", () => {
  const now = new Date("2026-10-02T09:00:00+08:00");
  const u = (it) => [{ provider: "new-provider", model: "deepseek/deepseek-v4.1-flash", inputTokens: it, cacheReadTokens: 0, outputTokens: 0, points: 1 }];
  const lines = [
    { ts: "2026-10-01T00:00:00Z", kind: "review", points: 1, usage: u(100) }, // ~1.4d → 7d 窗
    { ts: "2026-09-20T00:00:00Z", kind: "review", points: 1, usage: u(200) }, // ~12d → 30d 窗
    { ts: "2026-08-01T00:00:00Z", kind: "review", points: 1, usage: u(400) }, // ~62d → 仅 all
    { ts: "2026-10-01T00:00:00Z", kind: "junk", points: 99, usage: u(50) }, // 非 review kind——读取面已剔，此处验聚合不重滤
  ];
  const s = summarizeSandboxUsage(lines, now);
  assert.equal(s.runs, 4);
  assert.equal(s.all.points, 102);
  assert.equal(s.day7.points, 100, "day7 含 junk 行（读取面过滤在前）");
  assert.equal(s.day30.points, 101);
  const key = s.all.byKey.find((k) => k.model === "deepseek/deepseek-v4.1-flash");
  assert.equal(key.inputTokens, 750);
});

test("appendSandboxUsage：同 runId 重放幂等不双算、新 runId 照常入账、无 runId 不去重（收口③）", () => {
  const home = mkdtempSync(join(tmpdir(), "lzy-cost-dedup-"));
  const savedHome = process.env.HOME;
  const savedUP = process.env.USERPROFILE;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const rec = (runId) => ({
      runId, slug: "fx", attempt: 1, validity: { status: "valid" },
      metering: { status: "metered", points: 3, usage: [{ provider: "p", model: "m", inputTokens: 5, cacheReadTokens: 0, outputTokens: 1, points: 3 }] },
    });
    assert.equal(appendSandboxUsage("/x/y/pt-dedup", rec("fx.a1.r1")), true);
    assert.equal(appendSandboxUsage("/x/y/pt-dedup", rec("fx.a1.r1")), false, "同 runId 重放跳过（恢复重跑不双算）");
    assert.equal(appendSandboxUsage("/x/y/pt-dedup", rec("fx.a1.r2")), true, "新 runId 照常入账");
    const lines = readSandboxUsageLines();
    assert.equal(lines.length, 2);
    assert.equal(lines.find((l) => l.runId === "fx.a1.r1").project, "/x/y/pt-dedup", "project=仓库根全路径");
    // runId 缺席无法判幂等键：照常追加如实保留（不去重）
    const noId = rec(null);
    assert.equal(appendSandboxUsage("/x/y/pt-dedup", { ...noId }), true);
    assert.equal(appendSandboxUsage("/x/y/pt-dedup", { ...noId }), true, "无 runId 不去重，两行如实");
    assert.equal(readSandboxUsageLines().length, 4);
  } finally {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedUP === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedUP;
    rmSync(home, { recursive: true, force: true });
  }
});

test("readSandboxUsageLines：多文件合并、坏行与非 review kind 剔除、目录缺席 fail-soft 返 []", () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-cost-ledger-"));
  try {
    const dir = join(d, ".zcode", "cli", "lzy-usage");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-09.jsonl"), JSON.stringify({ ts: "x", kind: "review", points: 1, usage: [] }) + "\nBROKEN{\n");
    writeFileSync(join(dir, "2026-10.jsonl"), JSON.stringify({ ts: "y", kind: "review", points: 2, usage: [] }) + "\n" + JSON.stringify({ ts: "z", kind: "junk" }) + "\n");
    const lines = readSandboxUsageLines({ dir });
    assert.equal(lines.length, 2, "坏行与非 review kind 剔除");
    assert.deepEqual(lines.map((l) => l.points), [1, 2], "文件名排序 09 在前");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  assert.deepEqual(readSandboxUsageLines({ dir: join(d, "nope") }), []);
});

// 真 db 腿（sqlite3 在场；hostdb-wal 家法 skip 守卫）
const HAS_SQLITE3 = spawnSync("sqlite3", ["--version"], { timeout: 5_000 }).status === 0;
const sqlOf = (db, statement) => spawnSync("sqlite3", [db, statement], { encoding: "utf8", timeout: 10_000 });
const MU_SCHEMA =
  "CREATE TABLE model_usage(session_id TEXT, provider_id TEXT, model_id TEXT, status TEXT, started_at INTEGER, " +
  "input_tokens INTEGER, cache_read_input_tokens INTEGER, output_tokens INTEGER);";

test("querySessionPoints 真 db：usage 按 (provider,model) 分组、tokens/points 与库一致（0.5.0 升级面）", { skip: !HAS_SQLITE3 && "sqlite3 缺席" }, () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-cost-db-"));
  try {
    const db = join(d, "db.sqlite");
    const hMs = H("2026-10-02T08:00:00+08:00") * 3_600_000;
    const r = sqlOf(
      db,
      `${MU_SCHEMA} ` +
        `INSERT INTO model_usage VALUES('s9','new-provider','deepseek/deepseek-v4.1-flash','completed',${hMs},1000000,0,0); ` +
        `INSERT INTO model_usage VALUES('s9','new-provider','deepseek/deepseek-v4.1-flash','completed',${hMs + 3_600_000},500000,0,0); ` +
        `INSERT INTO model_usage VALUES('s9','other','minimax-m2.7','completed',${hMs},10,0,0);`,
    );
    assert.equal(r.status, 0, `建库失败：${r.stderr}`);
    const q = querySessionPoints("s9", { dbPath: db });
    assert.equal(q.absent, false);
    assert.equal(q.usage.length, 2);
    const ds = q.usage.find((x) => x.model === "deepseek/deepseek-v4.1-flash");
    assert.equal(ds.provider, "new-provider");
    assert.equal(ds.inputTokens, 1_500_000, "跨小时桶同组求和");
    assert.ok(ds.points > 0, "已计价组积分非零");
    assert.ok(q.unpriced.includes("minimax-m2.7"), "表外模型如实具名");
    const mm = q.usage.find((x) => x.model === "minimax-m2.7");
    assert.equal(mm.inputTokens, 10);
    assert.equal(mm.points, 0);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("CLI：lzy loop cost 沙盒外泄账段（真 db+真落账目录，双源分列）", { skip: !HAS_SQLITE3 && "sqlite3 缺席" }, () => {
  const home = mkdtempSync(join(tmpdir(), "lzy-cost-sb-home-"));
  const cwd0 = mkdtempSync(join(tmpdir(), "lzy-cost-sb-cwd-"));
  try {
    const dbDir = join(home, ".zcode", "cli", "db");
    mkdirSync(dbDir, { recursive: true });
    const db = join(dbDir, "db.sqlite");
    const hMs = H("2026-10-02T08:00:00+08:00") * 3_600_000;
    const r = sqlOf(
      db,
      `CREATE TABLE session(id TEXT, directory TEXT); ${MU_SCHEMA} ` +
        `INSERT INTO model_usage VALUES('s1','account:bigmodel','GLM-5.3-Flash','completed',${hMs},1000000,0,0);`,
    );
    assert.equal(r.status, 0, `建库失败：${r.stderr}`);
    const ledgerDir = join(home, ".zcode", "cli", "lzy-usage");
    mkdirSync(ledgerDir, { recursive: true });
    const month = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);
    writeFileSync(
      join(ledgerDir, `${month}.jsonl`),
      JSON.stringify({
        ts: new Date().toISOString(), kind: "review", project: "pt-sol", runId: "fx.a1.r1", slug: "fx", attempt: 1,
        validity: "valid", points: 1,
        usage: [{ provider: "new-provider", model: "deepseek/deepseek-v4.1-flash", inputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0, points: 1 }],
      }) + "\n",
    );
    const cli = spawnSync(process.execPath, [CLI, "loop", "cost"], {
      cwd: cwd0,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, HOME: home, USERPROFILE: home, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
    });
    assert.equal(cli.status, 0, cli.stderr);
    const out = `${cli.stdout}${cli.stderr}`;
    assert.match(out, /积分成本报表/, "宿主账本面共存");
    assert.match(out, /沙盒外泄账（隔离 HOME 评审落账，1 运行）/, "沙盒面独立分列");
    assert.match(out, /new-provider \/ deepseek\/deepseek-v4\.1-flash/);
    assert.match(out, /1\.0M tok/);
    assert.match(out, /近 7 天 1\.0M tok \/ 1 分/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd0, { recursive: true, force: true });
  }
});
