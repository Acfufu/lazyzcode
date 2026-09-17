// 限流体检契约测试：core/ratelimit.js 统计口径（限流族+传输死亡族+内容审核杀流族）+
// doctor rate-limit/transport/content 行的真实 stdout 面。fixture 全落 scratch HOME，
// 绝不触碰真实 ~/.zcode；端到端只断言行内容，绝不断言退出码（scratch HOME 下 doctor
// 必因 install fail 整体 exit 1，双审 B-5）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, openSync, ftruncateSync, closeSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectRateLimitStats, contentAdvisory, costAdvisory, providerBandAdvisory, providerMixNote, transportAdvisory } from "../core/ratelimit.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const LOG_DIR = ["2026-09-06", "2026-09-07"]; // 两个扫描日的文件名（.jsonl 前缀）
// 探测抑制(goal ratelimit-scan-budget):doctor 的 collectStatus 会 spawn 引擎子进程
// (env 继承 HOME=scratch),后者把 zcode-<当天>.jsonl 写进 scratch log——mid-run 污染,
// 对「空 HOME 落 skip」等断言免疫于事后清理。LZY_ZCODE_ENGINE 设为不存在路径即整体
// 替换引擎候选(paths.js engineCandidates),findEngine→null,探测不 spawn。被测面
// (rlLine/transportLine)不读引擎行,抑制无害。
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";

const scratch = () => mkdtempSync(join(tmpdir(), "lzy-rl-"));
const cleanup = (...dirs) => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
};

// doctor 输出行形如「  ⚠ rate-limit   <detail>」（检查名 padEnd(12)）；不能用裸子串匹配——
// loop 行的目标名 rate-limit-discipline 会撞车。
const rlLine = (stdout) =>
  (stdout ?? "").split("\n").find((l) => /^\s*\S\s+rate-limit\s/.test(l));

const pbLine = (stdout) =>
  (stdout ?? "").split("\n").find((l) => /^\s*\S\s+band-by-provider\s/.test(l));

const costLine = (stdout) =>
  (stdout ?? "").split("\n").find((l) => /^\s*\S\s+cost\s/.test(l));

const started = (ts, sid) =>
  JSON.stringify({ timestamp: ts, sessionId: sid, event: "model.request.started" });
// attempt:null → context 不带 attempt 字段（引擎旧格式/后台请求形态）
const rateLimited = (ts, sid, { attempt = 1, maxAttempts = 11, providerId = "builtin:bigmodel-coding-plan", turnId } = {}) =>
  JSON.stringify({
    timestamp: ts,
    sessionId: sid,
    ...(turnId ? { turnId } : {}),
    event: "model.request.failed",
    context: {
      reason: "rate_limited",
      ...(attempt === null ? {} : { attempt, maxAttempts }),
      providerId,
    },
  });
// completed 事件（provider 分桶完成面素材，决策 #21 前置件）：活体实证带 context.providerId
const completed = (ts, sid, providerId = "builtin:bigmodel-coding-plan") =>
  JSON.stringify({
    timestamp: ts,
    sessionId: sid,
    event: "model.request.completed",
    context: { providerId },
  });

function writeLog(home, date, lines) {
  const dir = join(home, ".zcode", "cli", "log");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `zcode-${date}.jsonl`), lines.join("\n") + "\n");
}

test("统计口径：计数/会话/判死/lastAt/连贯经验带（跨天文件不串桶）", async () => {
  const d = scratch();
  try {
    // 三个净桶（活跃 3，无 429）+ 三个脏桶（活跃 5，有 429）→ 带连贯：≤3 安全 / ≥5 撞线
    const day1 = [];
    for (const [h, sids] of [["10:00", ["c1", "c2", "c3"]], ["10:05", ["c1", "c2", "c3"]], ["10:10", ["c1", "c2", "c3"]]]) {
      for (const sid of sids) day1.push(started(`2026-09-06T${h}:00.000Z`, sid));
    }
    for (const [h, sids] of [["11:00", ["d1", "d2", "d3", "d4", "d5"]], ["11:05", ["d1", "d2", "d3", "d4", "d5"]], ["11:10", ["d1", "d2", "d3", "d4", "d5"]]]) {
      for (const sid of sids) day1.push(started(`2026-09-06T${h}:00.000Z`, sid));
      day1.push(rateLimited(`2026-09-06T${h}:30.000Z`, "d1"));
    }
    // 一次判死（attempt ≥ maxAttempts，字段在 context）+ 跨天另一 provider（失败计数分组）
    day1.push(rateLimited("2026-09-06T11:10:40.000Z", "d2", { attempt: 11, maxAttempts: 11 }));
    const day2 = [
      started("2026-09-07T09:00:00.000Z", "d1"),
      rateLimited("2026-09-07T09:01:00.000Z", "d1", { providerId: "other-provider" }),
      "这行不是 JSON{{{", // 坏行/半行：fail-soft，不计入
    ];
    writeLog(d, LOG_DIR[0], day1);
    writeLog(d, LOG_DIR[1], day2);
    const s = await collectRateLimitStats(join(d, ".zcode", "cli", "log"));
    assert.equal(s.available, true);
    assert.equal(s.files, 2);
    assert.equal(s.rateLimited, 5); // day1 四条 + day2 一条
    assert.equal(s.fatal, 1);
    assert.equal(Object.keys(s.sessions).length, 2); // 失败事件的会话键：d1、d2
    assert.equal(s.providers["builtin:bigmodel-coding-plan"], 4);
    assert.equal(s.providers["other-provider"], 1);
    assert.equal(s.lastAt, "2026-09-07T09:01:00.000Z");
    assert.deepEqual(s.band, { coherent: true, minDirty: 5, maxClean: 3 });
    // 夹具无 turnId → 覆盖率 0 → first-attempt 口径：5 事件中 attempt===1 计 4 回合
    assert.equal(s.caliber, "first-attempt");
    assert.equal(s.turns, 4);
  } finally {
    cleanup(d);
  }
});

test("band 降级：归因偏移致带不连贯（脏桶活跃低 + 真短缺）时输出单边证据", async () => {
  const d = scratch();
  try {
    // 净桶活跃 2；失败落在低活跃桶（11:30 仅 z1 一个 started）→ minDirty=1 ≤ maxClean=2
    // 且脏/净桶各仅 1 个（不足 3），双重不连贯
    const lines = [
      started("2026-09-06T10:00:00.000Z", "x1"),
      started("2026-09-06T10:00:00.000Z", "x2"),
      started("2026-09-06T11:30:00.000Z", "z1"),
      rateLimited("2026-09-06T11:30:30.000Z", "y1"),
    ];
    writeLog(d, LOG_DIR[0], lines);
    const s = await collectRateLimitStats(join(d, ".zcode", "cli", "log"));
    assert.equal(s.band.coherent, false);
    assert.equal(s.band.minDirty, 1);
  } finally {
    cleanup(d);
  }
});

// ── provider 分桶带（决策 #21 前置件，goal v005-core#N4）────────────────────

test("provider 分桶：A 带连贯（完成侧净3桶×2会话/脏3桶×4会话）B 无脏面样本；账号带只用 started 不受扰", async () => {
  const d = scratch();
  try {
    const lines = [];
    // provider A：3 净桶（2 会话）+ 3 脏桶（4 会话，各含一条 429）→ coherent
    for (const h of ["10:00", "10:05", "10:10"]) {
      for (const sid of ["a1", "a2"]) lines.push(completed(`2026-09-06T${h}:00.000Z`, sid));
    }
    for (const h of ["11:00", "11:05", "11:10"]) {
      for (const sid of ["b1", "b2", "b3", "b4"]) lines.push(completed(`2026-09-06T${h}:00.000Z`, sid));
      lines.push(rateLimited(`2026-09-06T${h}:30.000Z`, "b1"));
    }
    // provider B：1 净桶 1 会话、无 429 → 无脏面样本；provider C：两侧都有但不连贯 → 归因漂移
    lines.push(completed("2026-09-06T10:00:00.000Z", "o1", "other-provider"));
    for (const h of ["12:20", "12:25", "12:30"]) {
      for (const sid of ["k1", "k2", "k3", "k4"]) lines.push(completed(`2026-09-06T${h}:00.000Z`, sid, "builtin:zzz-plan"));
    }
    for (const h of ["13:00", "13:05", "13:10"]) {
      lines.push(completed(`2026-09-06T${h}:00.000Z`, "k9", "builtin:zzz-plan"));
      lines.push(rateLimited(`2026-09-06T${h}:45.000Z`, "k9", { providerId: "builtin:zzz-plan" }));
    }
    writeLog(d, LOG_DIR[0], lines);
    const s = await collectRateLimitStats(join(d, ".zcode", "cli", "log"));
    assert.equal(s.providersSeen, 3);
    assert.equal(s.providerBands.length, 3);
    const [a, z, b] = s.providerBands; // providerId 字典序：两个 builtin: 在前
    assert.equal(a.provider, "builtin:bigmodel-coding-plan");
    assert.deepEqual(
      { coherent: a.coherent, maxClean: a.maxClean, minDirty: a.minDirty, dirtyBuckets: a.dirtyBuckets, cleanBuckets: a.cleanBuckets },
      { coherent: true, maxClean: 2, minDirty: 4, dirtyBuckets: 3, cleanBuckets: 3 },
    );
    assert.equal(b.provider, "other-provider");
    assert.equal(b.coherent, false);
    assert.equal(z.provider, "builtin:zzz-plan");
    assert.equal(z.coherent, false);
    assert.equal(z.dirtyBuckets, 3);
    assert.ok(z.minDirty <= z.maxClean); // 两侧都有数据：不连贯源于归因漂移而非短缺
    // 账号级带不受 completed 扰动：无 started → band 仍 null（测量纯度钉）
    assert.equal(s.band, null);
    // 纯函数读面：三分标签（连贯/归因漂移/无脏面样本，评审 R3-A 拆分）
    const adv = providerBandAdvisory(s);
    assert.equal(adv.level, "ok");
    assert.match(adv.text, /bigmodel-coding-plan：带 ≤2 净\/4 撞（连贯）→ 该 provider 独立会话可 ≤2 并行/);
    // 债6：混算口径注句（只加行不动主行）
    assert.equal(providerMixNote(s), "混算口径 · 账号级建议含 3 家 provider 的 429 数据——一家撞线不代表他 provider 同压；逐 provider 经验带见 band-by-provider 行");
    assert.match(adv.text, /zzz-plan：带不连贯（归因漂移，净桶 3\/脏桶 3）/);
    assert.match(adv.text, /other-provider：无脏面样本（净桶 1）/);
  } finally {
    cleanup(d);
  }
});

test("provider 分桶：单 provider=现状字节稳定（不出行、不成表）；completed 缺 providerId 静默跳过", async () => {
  const d = scratch();
  try {
    const lines = [
      started("2026-09-06T10:00:00.000Z", "x1"),
      completed("2026-09-06T10:01:00.000Z", "x1"), // 默认 provider
      JSON.stringify({ timestamp: "2026-09-06T10:02:00.000Z", sessionId: "x2", event: "model.request.completed", context: {} }), // 缺 providerId
      rateLimited("2026-09-06T10:00:30.000Z", "y1"), // 与 started 同分钟桶 → dirtyKnown 非空，账号带照常出单边证据
    ];
    writeLog(d, LOG_DIR[0], lines);
    const s = await collectRateLimitStats(join(d, ".zcode", "cli", "log"));
    assert.equal(s.providersSeen, 1);
    assert.equal(s.providerBands, undefined);
    assert.equal(providerBandAdvisory(s), null);
    assert.equal(providerMixNote(s), null, "单 provider 无混算注句（字节稳定护栏）");
    assert.equal(s.band.coherent, false); // 账号带照常工作（单净桶+单脏桶不足 3）
  } finally {
    cleanup(d);
  }
});

test("provider 分桶：completed-only 纯净度——账号带仍 null，分桶表照出（incoherent）", async () => {
  const d = scratch();
  try {
    const lines = [
      completed("2026-09-06T10:00:00.000Z", "p1", "prov-one"),
      completed("2026-09-06T10:00:00.000Z", "p2", "prov-two"),
      rateLimited("2026-09-06T11:00:00.000Z", "p1", { providerId: "prov-one" }),
    ];
    writeLog(d, LOG_DIR[0], lines);
    const s = await collectRateLimitStats(join(d, ".zcode", "cli", "log"));
    assert.equal(s.band, null); // 无 started → 账号带不凭空捏
    assert.equal(s.providersSeen, 2);
    const one = s.providerBands.find((r) => r.provider === "prov-one");
    assert.equal(one.coherent, false); // 脏桶 1 < 3
  } finally {
    cleanup(d);
  }
});

test("端到端：双 provider 出 band-by-provider 行（含短名/连贯/无脏面样本），单 provider 不出行", async () => {
  const d = scratch();
  try {
    const lines = [
      completed("2026-09-06T10:00:00.000Z", "a1"),
      completed("2026-09-06T10:00:00.000Z", "a2"),
      rateLimited("2026-09-06T11:00:00.000Z", "b1"),
      completed("2026-09-06T11:00:00.000Z", "o1", "other-provider"),
    ];
    writeLog(d, LOG_DIR[1], lines);
    const spawnDoctor = () =>
      spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, HOME: d, USERPROFILE: d, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
      });
    const r = spawnDoctor();
    const line = pbLine(r.stdout);
    assert.ok(line, `stdout 应含 band-by-provider 行：\n${r.stdout}\n${r.stderr}`);
    const at = line.indexOf("bigmodel-coding-plan");
    assert.ok(at > -1 && at < line.indexOf("other-provider"), "行内按 provider 字典序");
    assert.match(line, /无脏面样本/);
    // 单 provider：去掉 other-provider 行 → 不出行（字节稳定）
    writeLog(d, LOG_DIR[1], lines.slice(0, 3));
    const r2 = spawnDoctor();
    assert.equal(pbLine(r2.stdout), undefined);
  } finally {
    cleanup(d);
  }
});

// ── 成本档位建议（成本两件套②「成功即降档」，goal v005-core#N5）──────────────

test("cost 建议行纯函数：零限流+低水位→降档建议；界上/读数缺席→维持；有限流→维持；无数据→null", () => {
  const zero = { available: true, rateLimited: 0 };
  const low = costAdvisory(zero, 100, 1600);
  assert.equal(low.level, "ok");
  assert.match(low.text, /滚动水位 100\/1600 低——下个常规目标可试轻量模型档位（成本），失败即回档/);
  assert.match(costAdvisory(zero, 800, 1600).text, /档位维持/); // 恰在阈值一半=界上，不怂恿降档
  assert.match(costAdvisory(zero, null, 1600).text, /水位读数缺席——档位维持/);
  const hit = { available: true, rateLimited: 3, turns: 2, caliber: "turn" };
  assert.match(costAdvisory(hit, null, 1600).text, /近窗 2 回合限流——档位维持（轻量档会放大重试与撞线）/);
  assert.equal(costAdvisory({ available: false }, 100, 1600), null);
});

test("对抗健壮性（R5-A）：畸形时间戳不产 NaN spanHours；空 providerId/sessionId 视同缺字段", async () => {
  const d = scratch();
  try {
    const bad = JSON.stringify({ timestamp: "9999-99-99T99:99:99Z", sessionId: "", event: "model.request.failed", context: { reason: "rate_limited", attempt: 1, maxAttempts: 11, providerId: "" } });
    const comp = JSON.stringify({ timestamp: "2026-09-06T10:00:00.000Z", sessionId: "", event: "model.request.completed", context: { providerId: "" } });
    writeLog(d, LOG_DIR[0], [bad, comp]);
    const s = await collectRateLimitStats(join(d, ".zcode", "cli", "log"));
    assert.equal(s.rateLimited, 1);
    assert.equal(s.spanHours, undefined); // 无可解析时间戳 → 留空，doctor 回落 files*24，不出「近 NaNh」
    assert.deepEqual(s.providers, {}); // 空 providerId 不入账
    assert.equal(s.providersSeen, 0);
    assert.equal(s.band, null); // 无 started → 不出带（band 初始即 null）
    assert.equal(Object.keys(s.sessions).length, 0); // 空 sessionId 不计失败会话
    assert.equal(providerBandAdvisory(s), null);
  } finally {
    cleanup(d);
  }
});

test("端到端：doctor cost 行两分支（scratch HOME 无账本→读数缺席维持；有限流→档位维持）", () => {
  const d = scratch();
  try {
    const spawnDoctor = () =>
      spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, HOME: d, USERPROFILE: d, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
      });
    // 分支一：零限流窗口（仅 started）→ cost 行出且注明读数缺席
    writeLog(d, LOG_DIR[0], [started("2026-09-06T10:00:00.000Z", "c1")]);
    const line0 = costLine(spawnDoctor().stdout);
    assert.ok(line0, "零限流窗口应出 cost 行");
    assert.match(line0, /水位读数缺席——档位维持/);
    // 分支二：有限流 → 维持并给理由
    writeLog(d, LOG_DIR[0], [
      started("2026-09-06T10:00:00.000Z", "c1"),
      rateLimited("2026-09-06T10:00:30.000Z", "c1"),
    ]);
    const line1 = costLine(spawnDoctor().stdout);
    assert.ok(line1, "有限流窗口应出 cost 行");
    assert.match(line1, /档位维持（轻量档会放大重试与撞线）/);
  } finally {
    cleanup(d);
  }
});

test("无日志目录 → available:false（doctor 落 skip）；空文件同理", async () => {
  const d = scratch();
  try {
    assert.deepEqual((await collectRateLimitStats(join(d, ".zcode", "cli", "log"))).available, false);
    const s = await collectRateLimitStats(join(d, "empty-but-real"));
    assert.equal(s.available, false);
  } finally {
    cleanup(d);
  }
});

test("端到端（HOME 覆盖）：doctor stdout 出现 rate-limit warn 行；空 HOME 落 skip 行——只断言行内容，不断言退出码", () => {
  const d = scratch();
  try {
    writeLog(d, LOG_DIR[1], [
      started("2026-09-07T02:00:00.000Z", "s1"),
      // 带 turnId → 覆盖率 100% → turn 口径；attempt≥max → 计判死
      rateLimited("2026-09-07T02:00:10.000Z", "s1", { attempt: 11, maxAttempts: 11, turnId: "t1" }),
    ]);
    const r = spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, HOME: d, USERPROFILE: d, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
    });
    const line = rlLine(r.stdout);
    assert.ok(line, `stdout 应含 rate-limit 行：\n${r.stdout}\n${r.stderr}`);
    assert.ok(line.includes("⚠") || line.includes("warn"), line);
    assert.match(line, /账号限流 1 回合/);
    assert.match(line, /失败请求 1 次/);
    assert.match(line, /判死 1/);
    assert.match(line, /zw 继续/);

    const empty = scratch();
    try {
      const r2 = spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, HOME: empty, USERPROFILE: empty, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
      });
      const line2 = rlLine(r2.stdout);
      assert.ok(line2, "stdout 应含 rate-limit skip 行");
      assert.match(line2, /无引擎日志/);
    } finally {
      cleanup(empty);
    }
  } finally {
    cleanup(d);
  }
});

const atMin = (day, h, m, sec = 0) =>
  new Date(Date.UTC(2026, 8, day, h, m, sec)).toISOString(); // "2026-09-07T02:00:00.000Z" 形态

test("回合口径：turnId 复合键去重；覆盖率不足 90% 降级 first-attempt（缺失按 1 计）", async () => {
  const d = scratch();
  try {
    // 全部带 turnId：t1 三条（attempt 1/2/3）+ t2 一条 → 覆盖率 100% → turn 口径 2 回合
    writeLog(d, LOG_DIR[0], [
      rateLimited(atMin(6, 10, 5), "s1", { turnId: "t1", attempt: 1 }),
      rateLimited(atMin(6, 10, 5, 10), "s1", { turnId: "t1", attempt: 2 }),
      rateLimited(atMin(6, 10, 5, 20), "s1", { turnId: "t1", attempt: 3 }),
      rateLimited(atMin(6, 10, 6), "s1", { turnId: "t2", attempt: 1 }),
    ]);
    const s = await collectRateLimitStats(join(d, ".zcode", "cli", "log"));
    assert.equal(s.caliber, "turn");
    assert.equal(s.turns, 2);
    assert.equal(s.rateLimited, 4);

    // 混合：2/5 带 turnId → 覆盖率 40% → first-attempt：attempt===1 或缺失计 3
    const d2 = scratch();
    try {
      writeLog(d2, LOG_DIR[0], [
        rateLimited(atMin(6, 10, 5), "s1", { turnId: "t1", attempt: 1 }),
        rateLimited(atMin(6, 10, 6), "s1", { turnId: "t1", attempt: 2 }),
        rateLimited(atMin(6, 10, 7), "s2", { attempt: 1 }),
        rateLimited(atMin(6, 10, 8), "s2", { attempt: 2 }),
        rateLimited(atMin(6, 10, 9), "s3", { attempt: null }),
      ]);
      const s2 = await collectRateLimitStats(join(d2, ".zcode", "cli", "log"));
      assert.equal(s2.caliber, "first-attempt");
      assert.equal(s2.turns, 3);
      assert.equal(s2.rateLimited, 5);
    } finally {
      cleanup(d2);
    }
  } finally {
    cleanup(d);
  }
});

test("漂移态：净桶 6 会话/脏桶 1 会话 → band 不连贯；dirtyDist 只基于 dirtyKnown", async () => {
  const d = scratch();
  try {
    const lines = [];
    for (const [h, m] of [["10", "00"], ["10", "05"], ["10", "10"]]) {
      for (let i = 1; i <= 6; i += 1) lines.push(started(atMin(6, h, m), `c${i}`));
    }
    for (const [h, m] of [["11", "00"], ["11", "05"], ["11", "10"]]) {
      lines.push(started(atMin(6, h, m), "z1"));
      lines.push(rateLimited(atMin(6, h, m, 30), "z1", { turnId: `k${m}` }));
    }
    writeLog(d, LOG_DIR[0], lines);
    const s = await collectRateLimitStats(join(d, ".zcode", "cli", "log"));
    assert.deepEqual(s.band, { coherent: false, minDirty: 1, maxClean: 6 });
    assert.deepEqual(s.dirtyDist, [{ active: 1, buckets: 3 }]);
    // 3 回合集中单小时 → 窗口回合地板（≥10）未达 → 集中段不输出
    assert.equal(s.concentration, null);
  } finally {
    cleanup(d);
  }
});

test("跨午夜两文件游程：23:58/23:59 + 00:00/00:01 → 最长连撞 4 分钟（UTC 毫秒差不断链）", async () => {
  const d = scratch();
  try {
    writeLog(d, LOG_DIR[0], [
      rateLimited("2026-09-06T23:58:30.000Z", "r1", { turnId: "a" }),
      rateLimited("2026-09-06T23:59:30.000Z", "r1", { turnId: "b" }),
    ]);
    writeLog(d, LOG_DIR[1], [
      rateLimited("2026-09-07T00:00:30.000Z", "r1", { turnId: "c" }),
      rateLimited("2026-09-07T00:01:30.000Z", "r1", { turnId: "d" }),
    ]);
    const s = await collectRateLimitStats(join(d, ".zcode", "cli", "log"));
    assert.equal(s.longestRunMin, 4);
  } finally {
    cleanup(d);
  }
});

test("集中段三门槛：通过/份额边界 60%/地板未达（回合数、started 数各自守门）", async () => {
  // pass：20 回合全落单 UTC 小时 + 窗口 started 120 → share 100% 过门槛
  const d = scratch();
  const build = (turnCount, startedCount) => {
    const lines = [];
    for (let i = 0; i < startedCount; i += 1) {
      const h = i < 60 ? 9 : 10;
      lines.push(started(atMin(7, h, i % 60), `c${i % 30}`));
    }
    for (let i = 0; i < turnCount; i += 1) {
      lines.push(rateLimited(atMin(7, 10, 5 + i), "s1", { turnId: `w${i}` }));
    }
    return lines;
  };
  const run = async (turnCount, startedCount) => {
    const dd = scratch();
    try {
      writeLog(dd, LOG_DIR[1], build(turnCount, startedCount));
      // 必须 await 后再返回：裸 return promise 会让 finally 的 cleanup 抢在流式扫描完成前删目录
      return await collectRateLimitStats(join(dd, ".zcode", "cli", "log"));
    } finally {
      cleanup(dd);
    }
  };
  try {
    const pass = await run(20, 120);
    assert.ok(pass.concentration, "20 回合/120 started 应过三门槛");
    assert.equal(pass.concentration.sharePct, 100);
    assert.equal(pass.concentration.turns, 20);

    // 份额边界：12 回合落窗内小时 + 8 回合在窗外小时 → 最佳窗恰好 60%（≥ 判通过）
    const d3 = scratch();
    try {
      const lines = [];
      for (let i = 0; i < 120; i += 1) lines.push(started(atMin(7, i < 60 ? 9 : 10, i % 60), `c${i % 30}`));
      for (let i = 0; i < 12; i += 1) lines.push(rateLimited(atMin(7, 10, 5 + i), "s1", { turnId: `w${i}` }));
      for (let i = 0; i < 8; i += 1) lines.push(rateLimited(atMin(7, 14, 5 + i), "s2", { turnId: `x${i}` }));
      writeLog(d3, LOG_DIR[1], lines);
      const s = await collectRateLimitStats(join(d3, ".zcode", "cli", "log"));
      assert.ok(s.concentration, "恰好 60% 应通过（≥ 判据）");
      assert.equal(s.concentration.sharePct, 60);
      assert.equal(s.concentration.turns, 12);
    } finally {
      cleanup(d3);
    }

    // started 地板：份额 100%、回合 20，但窗口 started 仅 50 → 不输出
    const floorStarted = await run(20, 50);
    assert.equal(floorStarted.concentration, null);
    // 回合地板：份额 100%、started 120，但仅 5 回合 → 不输出
    const floorTurns = await run(5, 120);
    assert.equal(floorTurns.concentration, null);
  } finally {
    cleanup(d);
  }
});

test("端到端：全桶皆脏（无净活跃对照）+ 125 分钟连撞 → 措辞折小时，无「0 会话同开」", () => {
  const d = scratch();
  try {
    const lines = [started(atMin(7, 2, 0), "k1")];
    for (let i = 0; i < 125; i += 1) lines.push(rateLimited(atMin(7, 2, i, 30), "k1", { attempt: 1 }));
    writeLog(d, LOG_DIR[1], lines);
    const r = spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, HOME: d, USERPROFILE: d, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
    });
    const line = rlLine(r.stdout);
    assert.ok(line, `stdout 应含 rate-limit 行：\n${r.stdout}\n${r.stderr}`);
    assert.match(line, /无固定并发阈值/);
    assert.match(line, /无净活跃对照/);
    assert.doesNotMatch(line, /0 会话同开/);
    assert.match(line, /最长连撞 2 小时 5 分/);
    assert.doesNotMatch(line, /undefined|NaN|Infinity/);
  } finally {
    cleanup(d);
  }
});

test("端到端：band=null（只有失败事件零 started）→ 第三分支话术，无 undefined", () => {
  const d = scratch();
  try {
    writeLog(d, LOG_DIR[1], [rateLimited("2026-09-07T02:00:10.000Z", "z1", { attempt: 1 })]);
    const r = spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, HOME: d, USERPROFILE: d, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
    });
    const line = rlLine(r.stdout);
    assert.ok(line, `stdout 应含 rate-limit 行：\n${r.stdout}\n${r.stderr}`);
    assert.match(line, /日志缺并发活跃记录/);
    assert.match(line, /无法估计并发边界/);
    assert.match(line, /活跃主会话宜少、判死后等数分钟再 zw 继续/);
    assert.doesNotMatch(line, /undefined|NaN|Infinity/);
  } finally {
    cleanup(d);
  }
});

test("端到端（TZ=UTC）：集中段本地小时渲染确定 + 满配行 ≤300 字符", () => {
  const d = scratch();
  try {
    const lines = [];
    for (let i = 0; i < 120; i += 1) lines.push(started(atMin(7, i < 60 ? 9 : 10, i % 60), `c${i % 30}`));
    for (let i = 0; i < 20; i += 1) lines.push(rateLimited(atMin(7, 10, 5 + i), "s1", { turnId: `w${i}` }));
    writeLog(d, LOG_DIR[1], lines);
    const r = spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, HOME: d, USERPROFILE: d, TZ: "UTC" },
    });
    const line = rlLine(r.stdout);
    assert.ok(line, `stdout 应含 rate-limit 行：\n${r.stdout}\n${r.stderr}`);
    assert.match(line, /撞线集中在本地 08:00–11:00（占 10 成）/);
    const detail = line.replace(/^\s*\S\s+rate-limit\s+/, "");
    assert.ok([...detail].length <= 300, `detail 应 ≤300 字符，实际 ${[...detail].length}：${detail}`);
  } finally {
    cleanup(d);
  }
});

// ── 传输死亡族（ADR-0008）：errno 主判据 + 排除面 + 双口径 + doctor transport 行 ──

// 真实事故行形态（2026-09-08 ENETDOWN 实锤， sessid 等长打码；errno 与 fake-ip
// 198.18.0.0/15 保留段地址原样保留）。关键事实：reason="unknown"——按 reason
// 白名单会漏掉本事故，errno 主判据必须从 statusMessage 提取。
const enetdownLine = (ts, sid, turnId = "turn_872f1972-eb68-4531-bae3-2be17532cbee") =>
  JSON.stringify({
    timestamp: ts,
    level: "warn",
    event: "model.request.failed",
    module: "adapters.model",
    message: "Model request attempt failed",
    sessionId: sid,
    turnId,
    status: "failed",
    context: {
      attempt: 4,
      baseURL: "https://open.bigmodel.cn/api/anthropic",
      maxAttempts: 11,
      maxRetries: 10,
      modelId: "GLM-5.3-Flash",
      providerId: "builtin:bigmodel-coding-plan",
      providerKind: "anthropic",
      querySource: "main_turn",
      transport: "sse",
      reason: "unknown",
      retryable: false,
      statusMessage: "Cannot connect to API: connect ENETDOWN 198.18.0.197:443",
    },
  });

// 通用失败事件构造器（传输族辅判据与排除面共用；turnId 可选供双口径用例）
const failedLine = (ts, sid, ctx, turnId) =>
  JSON.stringify({
    timestamp: ts,
    sessionId: sid,
    ...(turnId ? { turnId } : {}),
    event: "model.request.failed",
    context: ctx,
  });
const networkErrorLine = (ts, sid, turnId) =>
  failedLine(
    ts,
    sid,
    {
      reason: "network_error",
      attempt: 1,
      maxAttempts: 11,
      statusMessage:
        "Cannot connect to API: Client network socket disconnected before secure TLS connection was established",
    },
    turnId,
  );
const connectTimeoutLine = (ts, sid, turnId) =>
  failedLine(
    ts,
    sid,
    {
      reason: "timeout",
      attempt: 1,
      maxAttempts: 11,
      statusMessage:
        "Cannot connect to API: Connect Timeout Error (attempted address: zcode.z.ai:443, timeout: 10000ms)",
    },
    turnId,
  );

const transportLine = (stdout) =>
  (stdout ?? "").split("\n").find((l) => /^\s*\S\s+transport\s/.test(l));

test("传输族 matcher：errno 主判据（reason=unknown 形态）+ 两辅判据 + 排除面不串计", async () => {
  const d = scratch();
  try {
    writeLog(d, LOG_DIR[0], [
      enetdownLine("2026-09-06T10:00:00.000Z", "sess_xxxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"),
      networkErrorLine("2026-09-06T10:01:00.000Z", "s2"),
      connectTimeoutLine("2026-09-06T10:02:00.000Z", "s3"),
      rateLimited("2026-09-06T10:03:00.000Z", "s4", { attempt: 1 }), // 限流族：不进传输
      failedLine("2026-09-06T10:04:00.000Z", "s5", { reason: "cancelled", statusMessage: "Model request was cancelled." }),
      failedLine("2026-09-06T10:05:00.000Z", "s6", { reason: "server_error", statusMessage: "Provider returned a server error." }),
      failedLine("2026-09-06T10:06:00.000Z", "s7", { reason: "invalid_request" }),
      failedLine("2026-09-06T10:07:00.000Z", "s8", {}), // 无 reason/statusMessage 残行：fail-soft 忽略
      "NOT JSON {{{", // 坏行：fail-soft
    ]);
    const s = await collectRateLimitStats(join(d, ".zcode", "cli", "log"));
    assert.equal(s.transport.events, 3);
    assert.deepEqual(s.transport.byCode, { ENETDOWN: 1, network_error: 1, connect_timeout: 1 });
    assert.equal(s.transport.fakeIp, true, "fake-ip 保留段地址应命中");
    assert.equal(s.transport.firstAt, "2026-09-06T10:00:00.000Z");
    assert.equal(s.transport.lastAt, "2026-09-06T10:02:00.000Z");
    assert.equal(s.transport.samples.length, 3);
    assert.ok(s.transport.samples[0].includes("connect ENETDOWN 198.18.0.197:443"));
    // 两族不串计：429 只进限流计数
    assert.equal(s.rateLimited, 1);
    // 口径：仅 ENETDOWN 带 turnId（1/3 = 33% < 90%）→ first-attempt；attempt===1 或缺失计 2
    assert.equal(s.transport.caliber, "first-attempt");
    assert.equal(s.transport.turns, 2);
  } finally {
    cleanup(d);
  }
});

test("传输族双口径：turnId 复合键去重（同款覆盖率 90% 线）", async () => {
  const d = scratch();
  try {
    writeLog(d, LOG_DIR[0], [
      // t1 三次重试（同回合，跨三子类型）+ t2 一次 → 覆盖率 100% → turn 口径 2 回合 / 4 事件
      networkErrorLine("2026-09-06T10:00:00.000Z", "s1", "turn_t1"),
      enetdownLine("2026-09-06T10:00:10.000Z", "s1", "turn_t1"),
      connectTimeoutLine("2026-09-06T10:00:20.000Z", "s1", "turn_t1"),
      enetdownLine("2026-09-06T10:01:00.000Z", "s2", "turn_t2"),
    ]);
    const s = await collectRateLimitStats(join(d, ".zcode", "cli", "log"));
    assert.equal(s.transport.events, 4);
    assert.equal(s.transport.caliber, "turn");
    assert.equal(s.transport.turns, 2);
  } finally {
    cleanup(d);
  }
});

test("transportAdvisory 矩阵：skip / ok / warn（含 byCode+lastAt）/ fake-ip 提示", () => {
  const skip = transportAdvisory({ available: false });
  assert.equal(skip.level, "skip");
  const ok = transportAdvisory({ available: true, files: 2, transport: { events: 0, turns: 0, byCode: {}, lastAt: null, fakeIp: false, caliber: "turn" } });
  assert.equal(ok.level, "ok");
  assert.match(ok.text, /0 起传输死亡/);
  const warn = transportAdvisory({
    available: true,
    files: 2,
    transport: { events: 3, turns: 2, byCode: { ENETDOWN: 1, network_error: 2 }, lastAt: "2026-09-09T00:37:59.559Z", fakeIp: false, caliber: "turn" },
  });
  assert.equal(warn.level, "warn");
  assert.match(warn.text, /2 回合 \/ 3 次传输死亡/);
  assert.match(warn.text, /network_error×2 ENETDOWN×1/);
  assert.match(warn.text, /turn 口径/);
  assert.doesNotMatch(warn.text, /fake-ip/);
  const fake = transportAdvisory({
    available: true,
    files: 2,
    transport: { events: 1, turns: 1, byCode: { ENETDOWN: 1 }, lastAt: null, fakeIp: true, caliber: "turn" },
  });
  assert.equal(fake.level, "warn");
  assert.match(fake.text, /198\.18\.0\.0\/15 fake-ip/);
  assert.match(fake.text, /直连规则/);
});

test("端到端：doctor transport 行 warn（ENETDOWN+fake-ip 提示）；纯 started 日志落 ok 行", () => {
  const d = scratch();
  try {
    writeLog(d, LOG_DIR[0], [
      started("2026-09-06T09:59:00.000Z", "s0"),
      enetdownLine("2026-09-06T10:00:00.000Z", "sess_xxxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"),
    ]);
    const r = spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, HOME: d, USERPROFILE: d, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
    });
    const line = transportLine(r.stdout);
    assert.ok(line, `stdout 应含 transport 行：\n${r.stdout}\n${r.stderr}`);
    assert.match(line, /1 回合 \/ 1 次传输死亡/);
    assert.match(line, /ENETDOWN×1/);
    assert.match(line, /fake-ip/);
    assert.doesNotMatch(line, /undefined|NaN|Infinity/);

    // 无任何失败事件：transport 照出 ok 行（传输族独立于限流族）
    const d2 = scratch();
    try {
      writeLog(d2, LOG_DIR[1], [started("2026-09-07T02:00:00.000Z", "c1")]);
      const r2 = spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, HOME: d2, USERPROFILE: d2, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
      });
      const line2 = transportLine(r2.stdout);
      assert.ok(line2, "stdout 应含 transport ok 行");
      assert.match(line2, /0 起传输死亡/);
    } finally {
      cleanup(d2);
    }

    // 空 HOME：skip 行（与 rate-limit skip 同现）
    const empty = scratch();
    try {
      const r3 = spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, HOME: empty, USERPROFILE: empty, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
      });
      const line3 = transportLine(r3.stdout);
      assert.ok(line3, "stdout 应含 transport skip 行");
      assert.match(line3, /无引擎日志/);
    } finally {
      cleanup(empty);
    }
  } finally {
    cleanup(d);
  }
});

// ── 内容审核杀流族：statusMessage 主判据 + 伴生排除 + 纯度 + doctor content 行 ──

// 真实事故行形态（2026-09-14 00:33 1301 活体事故，sessid/reqid 等长打码；HTTP 200 正常
// 开流、模型已吐 1501 个 reasoning-delta 后被服务端中途杀流）。关键事实：reason="unknown"
// （引擎误标，与 ENETDOWN 事故同形态）、retryable=false（无重试放大，events=死请求数）、
// statusMessage 以 "[1301][" 头（BigModel 业务码形态，主判据钉死此单字段）。
const contentKillLine = (ts, sid) =>
  JSON.stringify({
    timestamp: ts,
    level: "warn",
    event: "model.request.failed",
    module: "adapters.model",
    message: "Model request attempt failed",
    sessionId: sid,
    turnId: "turn_f25227bf-2904-4342-b029-0917f0711125",
    status: "failed",
    context: {
      attempt: 1,
      baseURL: "https://open.bigmodel.cn/api/anthropic",
      maxAttempts: 11,
      maxRetries: 10,
      modelId: "GLM-5.3-Flash",
      providerId: "account:bigmodel-individual-coding-plan",
      providerKind: "anthropic",
      querySource: "main_turn",
      requestId: "076be0b3-e646-4c53-8499-2115ac7ee803",
      transport: "sse",
      chunkCounts: { start: 1, "start-step": 1, "reasoning-start": 1, "reasoning-delta": 1501 },
      reason: "unknown",
      reasoningDeltaChars: 4829,
      retryable: false,
      statusMessage:
        "[1301][系统检测到输入或生成内容可能包含不安全或敏感内容，请您避免输入易产生敏感内容的提示语，感谢您的配合。][202609140032386dec4b5c321847b2]",
    },
  });

// 伴生排除形态：同回合伴生失败行把 "[1301]" 藏进 error.cause 链、context 无 statusMessage
// ——单字段判据必须不计（events 恒=死请求数，不按伴生行翻倍）
const contentKillEchoLine = (ts, sid) =>
  failedLine(ts, sid, {
    reason: "unknown",
    retryable: false,
    error: {
      name: "AiSdkModelAdapterError",
      message:
        "[1301][系统检测到输入或生成内容可能包含不安全或敏感内容，请您避免输入易产生敏感内容的提示语，感谢您的配合。]",
      cause: { name: "ProviderBusinessError", code: "PROVIDER_BUSINESS_ERROR" },
    },
  });

const contentLine = (stdout) =>
  (stdout ?? "").split("\n").find((l) => /^\s*\S\s+content\s/.test(l));

test("内容杀流族 matcher：statusMessage 主判据 + 伴生/异族不串计 + 带数学纯度钉", async () => {
  const d = scratch();
  try {
    const lines = [
      started("2026-09-06T09:59:00.000Z", "c1"),
      started("2026-09-06T09:59:00.000Z", "c2"),
      // 内容杀流桶：5 会话高活跃——若被误计为脏桶，minDirty 将翻成 5（纯度钉的判别力所在）
      ...["k1", "k2", "k3", "k4", "k5"].map((sid) => started("2026-09-06T10:00:00.000Z", sid)),
      contentKillLine("2026-09-06T10:00:30.000Z", "sess_yyyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyy"),
      contentKillEchoLine("2026-09-06T10:00:31.000Z", "sess_yyyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyy"),
      // 429 脏桶（活跃 1）+ 传输族各一：三族互不串计
      started("2026-09-06T10:03:00.000Z", "s4"),
      rateLimited("2026-09-06T10:03:30.000Z", "s4", { attempt: 1 }),
      enetdownLine("2026-09-06T10:05:00.000Z", "s5"),
    ];
    writeLog(d, LOG_DIR[0], lines);
    const s = await collectRateLimitStats(join(d, ".zcode", "cli", "log"));
    assert.equal(s.content.events, 1, "伴生行不得计入");
    assert.deepEqual(s.content.byCode, { "1301": 1 });
    assert.equal(s.content.lastSessionId, "sess_yyyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyy");
    assert.equal(s.content.firstAt, "2026-09-06T10:00:30.000Z");
    assert.equal(s.content.lastAt, "2026-09-06T10:00:30.000Z");
    assert.equal(s.content.samples.length, 1);
    assert.ok(s.content.samples[0].startsWith("1301: [1301][系统检测到"));
    // 三族不串计
    assert.equal(s.rateLimited, 1);
    assert.equal(s.transport.events, 1);
    // 带数学纯度：杀流桶不脏——dirtyDist 只含脏桶（活跃 1 的 429 桶）；若杀流桶（活跃 5）
    // 被误计为脏，此处必多出 {active:5,…} 档（band 字段对该失败形态不敏感，dirtyDist 才锐利）
    assert.deepEqual(s.dirtyDist, [{ active: 1, buckets: 1 }]);
    // 杀流桶（活跃 5）是净桶——maxClean=5 恰证明它未被计入脏桶
    assert.deepEqual(s.band, { coherent: false, minDirty: 1, maxClean: 5 });
  } finally {
    cleanup(d);
  }
});

test("contentAdvisory 矩阵：skip / ok / warn（byCode+lastAt+死会话指针+应对句）+ 行长 ≤300", () => {
  const skip = contentAdvisory({ available: false });
  assert.equal(skip.level, "skip");
  const ok = contentAdvisory({
    available: true,
    files: 2,
    content: { events: 0, byCode: {}, lastAt: null, lastSessionId: null },
  });
  assert.equal(ok.level, "ok");
  assert.match(ok.text, /0 起内容审核杀流/);
  const warn = contentAdvisory({
    available: true,
    files: 2,
    content: {
      events: 2,
      byCode: { "1301": 2 },
      lastAt: "2026-09-13T16:33:18.187Z",
      lastSessionId: "sess_097a9e6b-4c31-4830-ab5d-78f759541000",
    },
  });
  assert.equal(warn.level, "warn");
  assert.match(warn.text, /2 次内容审核杀流/);
  assert.match(warn.text, /1301 族 1301×2/);
  assert.match(warn.text, /2026-09-13 16:33Z/);
  assert.match(warn.text, /死会话 sess_097a9e6b-4c31-4…/);
  assert.match(warn.text, /原地重试必复现/);
  assert.match(warn.text, /不是配额压力/);
  assert.ok([...warn.text].length <= 300, `text 应 ≤300 字符，实际 ${[...warn.text].length}`);
});

test("端到端：doctor content 行 warn 命中零-429 早退分支（纯杀流日志）；纯 started 落 ok；空 HOME 落 skip", () => {
  const d = scratch();
  try {
    // 无任何 429 → doctor 走 rateLimited===0 早退分支：content 行仍必须照出（评审 MF-1 分支②）
    writeLog(d, LOG_DIR[0], [
      started("2026-09-06T09:59:00.000Z", "s0"),
      contentKillLine("2026-09-06T10:00:00.000Z", "sess_yyyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyy"),
    ]);
    const r = spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, HOME: d, USERPROFILE: d, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
    });
    const line = contentLine(r.stdout);
    assert.ok(line, `stdout 应含 content 行：\n${r.stdout}\n${r.stderr}`);
    assert.match(line, /1 次内容审核杀流/);
    assert.match(line, /1301×1/);
    assert.match(line, /死会话 sess_yyyyyyyyy/);
    assert.doesNotMatch(line, /undefined|NaN|Infinity/);

    // 纯 started 日志：content ok 行（独立于限流族，零杀流也照出）
    const d2 = scratch();
    try {
      writeLog(d2, LOG_DIR[1], [started("2026-09-07T02:00:00.000Z", "c1")]);
      const r2 = spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, HOME: d2, USERPROFILE: d2, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
      });
      const line2 = contentLine(r2.stdout);
      assert.ok(line2, "stdout 应含 content ok 行");
      assert.match(line2, /0 起内容审核杀流/);
    } finally {
      cleanup(d2);
    }

    // 空 HOME：skip 行（与 rate-limit/transport skip 同现）
    const empty = scratch();
    try {
      const r3 = spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, HOME: empty, USERPROFILE: empty, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
      });
      const line3 = contentLine(r3.stdout);
      assert.ok(line3, "stdout 应含 content skip 行");
      assert.match(line3, /无引擎日志/);
    } finally {
      cleanup(empty);
    }
  } finally {
    cleanup(d);
  }
});

// ── 体积预算(goal ratelimit-scan-budget):截断路径 / 默认全零护栏 / doctor 行标注 ──

test("体积预算:参数注入 1KB 上限 → 头部事件截断,truncation 如实记录", async () => {
  const d = scratch();
  try {
    const lines = [
      started("2026-09-06T10:00:00.000Z", "head"),
      rateLimited("2026-09-06T10:00:30.000Z", "head", { turnId: "th" }), // 头部 429:应被截掉
      ...Array.from({ length: 40 }, (_, i) =>
        started(`2026-09-06T11:${String(i % 60).padStart(2, "0")}:00.000Z`, `pad${i}`)
      ),
      started("2026-09-06T12:00:00.000Z", "tail"),
      rateLimited("2026-09-06T12:00:30.000Z", "tail", { turnId: "tt" }), // 尾部 429:应计入
    ];
    writeLog(d, LOG_DIR[0], lines);
    writeLog(d, LOG_DIR[1], [started("2026-09-07T09:00:00.000Z", "d2s")]);
    const s = await collectRateLimitStats(join(d, ".zcode", "cli", "log"), { maxBytesPerFile: 1024 });
    assert.equal(s.available, true);
    assert.ok(s.truncation.truncatedFiles >= 1, `truncatedFiles 应 ≥1:${JSON.stringify(s.truncation)}`);
    assert.ok(s.truncation.bytesSkipped > 0);
    assert.equal(s.truncation.timeExceeded, false);
    assert.equal(s.rateLimited, 1); // 头部 429 被截,只计尾部
    assert.equal(s.sessions.head, undefined); // 头部会话事件不入统计
    assert.equal(s.sessions.tail, 1);
  } finally {
    cleanup(d);
  }
});

test("体积预算:timeBudgetMs 注入 -1 → 首行即中止,timeExceeded 确定为真且不抛错", async () => {
  const d = scratch();
  try {
    writeLog(d, LOG_DIR[0], [started("2026-09-06T10:00:00.000Z", "s0")]);
    const s = await collectRateLimitStats(join(d, ".zcode", "cli", "log"), { timeBudgetMs: -1 });
    assert.equal(s.available, true);
    assert.equal(s.truncation.timeExceeded, true);
  } finally {
    cleanup(d);
  }
});

test("体积预算:默认参数小 fixture 不触发,truncation 全零(护栏钉)", async () => {
  const d = scratch();
  try {
    writeLog(d, LOG_DIR[0], [
      started("2026-09-06T10:00:00.000Z", "s0"),
      rateLimited("2026-09-06T10:01:00.000Z", "s0"),
    ]);
    const s = await collectRateLimitStats(join(d, ".zcode", "cli", "log"));
    assert.deepEqual(s.truncation, { truncatedFiles: 0, bytesSkipped: 0, timeExceeded: false });
    // 既有字段零语义变化(对照 N2 基线快照结论的同型断言)
    assert.equal(s.rateLimited, 1);
    assert.equal(s.files, 1);
  } finally {
    cleanup(d);
  }
});

test("doctor rate-limit 行截断标注(sparse fixture 真实超限)且行长 ≤300", () => {
  const d = scratch();
  try {
    const dir = join(d, ".zcode", "cli", "log");
    mkdirSync(dir, { recursive: true });
    const p = join(dir, `zcode-${LOG_DIR[1]}.jsonl`);
    const fd = openSync(p, "w");
    ftruncateSync(fd, 65 * 1024 * 1024); // 稀疏空洞:瞬时造出真实超限文件
    closeSync(fd);
    appendFileSync(
      p,
      [
        started("2026-09-07T09:00:00.000Z", "sx"),
        rateLimited("2026-09-07T09:01:00.000Z", "sx", { attempt: 1, maxAttempts: 11, turnId: "tz" }),
      ].join("\n") + "\n",
    );
    const r = spawnSync(process.execPath, [join(ROOT, "cli", "lzy.js"), "doctor"], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, HOME: d, USERPROFILE: d, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
    });
    const line = rlLine(r.stdout);
    assert.ok(line, `stdout 应含 rate-limit 行:\n${r.stdout}\n${r.stderr}`);
    assert.match(line, /样本截断/);
    assert.ok([...line].length <= 300, `含标注行仍 ≤300 字符,实得 ${[...line].length}`);
  } finally {
    cleanup(d);
  }
});
