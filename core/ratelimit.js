// lzy doctor「rate-limit」检查的统计核：扫引擎 cli 日志里的账号级限流痕迹。
// 事实底稿见 docs/research-glm-plan-rate-limit.md。设计要点（双审 A/B 定稿 + v3 修订）：
// - readline 流式逐行（单日日志可达 85MB，禁 readFileSync 整读），子串预过滤命中才 JSON.parse；
// - 桶键=日期+HH:MM（UTC），跨天文件不串桶；游程/时区聚合只用完整带 Z 时间戳，
//   禁止用桶键（无 Z）喂 Date（会按本地时区静默平移）；
// - 回合（turn）口径：主口径=(sessionId,turnId) 复合键去重（覆盖率 ≥90% 才用），
//   降级口径=attempt===1 首撞计数（缺失按 1 计）；一份报告只用一种口径，caliber 标明；
// - 判死判据 attempt >= maxAttempts（context 字段，顶层无 attempt）；
// - 经验带（净桶最高活跃数 / 脏桶最低活跃数）仅在连贯且样本足量时输出，否则降级单边证据
//   ——长请求与重试跨桶的归因偏移下，降级是常态路径；
// - dirtyDist/游程/集中段均为脏桶派生：直方图只基于 dirtyKnown（无 started 的脏桶排除），
//   游程连续性用 UTC 毫秒差（跨文件/跨午夜不断链），集中段按本地小时 3 小时环形窗
//   （份额 ≥60% 且窗内去重命中 ≥10 且窗内 started ≥100 三门槛全过才输出）；
// - 坏行/半行（引擎活体写入中）按可解析前缀静默跳过（fail-soft）。
import { createReadStream } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const LOG_RE = /^zcode-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const TURN_COVERAGE_MIN = 0.9;
const CONC_SHARE_MIN = 0.6;
const CONC_TURNS_MIN = 10;
const CONC_STARTED_MIN = 100;

function listRecentLogs(logDir, maxFiles) {
  let names;
  try {
    names = readdirSync(logDir).filter((f) => LOG_RE.test(f)).sort().reverse().slice(0, maxFiles);
  } catch {
    return [];
  }
  return names.map((f) => join(logDir, f));
}

function tryParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

// "2026-09-06T16:41:…" → "2026-09-06T16:41"（日期+时:分，UTC 原样）
const bucketOf = (ts) => (typeof ts === "string" && ts.length >= 16 ? ts.slice(0, 16) : null);
// 完整 ISO 时间戳（含 Z）才允许进 Date——桶键无 Z，按本地解析会静默平移时区
const localHourOf = (ts) => {
  if (typeof ts !== "string" || !ts.endsWith("Z")) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.getHours();
};

export async function collectRateLimitStats(logDir, { maxFiles = 2 } = {}) {
  const files = listRecentLogs(logDir, maxFiles);
  if (files.length === 0) return { available: false };

  const stats = {
    available: true,
    files: files.length,
    rateLimited: 0, // 原始限流事件数（含重试）
    providers: {},
    sessions: {},
    fatal: 0,
    lastAt: null,
    band: null,
    turns: 0, // 去重命中数（口径见 caliber）
    caliber: "turn", // "turn"=复合键去重 | "first-attempt"=attempt===1 首撞计数
    dirtyDist: [], // [{active, buckets}] 仅 dirtyKnown，内部数据不上人读行
    longestRunMin: 0, // 最长连续脏游程（分钟，UTC 毫秒差判定）
    concentration: null, // {startHour, endHour, sharePct, turns} 本地小时 3h 环形窗
  };

  const active = new Map(); // 桶键 → Set(sessionId)（started 事件）
  const dirty = new Set(); // 出现过 429 失败的桶键
  const startedByHour = new Array(24).fill(0); // 本地小时 → started 事件数
  const turnSeen = new Map(); // 复合键 → 最早事件 ts（ISO 字符串，字典序即时序）
  const attemptHour = new Array(24).fill(0); // first-attempt 口径的本地小时分布
  let turnKeyed = 0;
  let minTs = null;
  let maxTs = null;
  const noteTs = (ts) => {
    if (typeof ts !== "string") return;
    if (!minTs || ts < minTs) minTs = ts;
    if (!maxTs || ts > maxTs) maxTs = ts;
  };

  for (const file of files) {
    const rl = createInterface({
      input: createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (line.includes('"event":"model.request.started"')) {
        const d = tryParse(line);
        const b = d ? bucketOf(d.timestamp) : null;
        if (b && typeof d.sessionId === "string") {
          let s = active.get(b);
          if (!s) active.set(b, (s = new Set()));
          s.add(d.sessionId);
        }
        const h = d ? localHourOf(d.timestamp) : null;
        if (h !== null) startedByHour[h] += 1;
        if (d) noteTs(d.timestamp);
        continue;
      }
      if (!line.includes('"reason":"rate_limited"')) continue;
      const d = tryParse(line);
      if (!d) continue; // 坏行/半行：fail-soft，不计入也不报错
      stats.rateLimited += 1;
      const ctx = d.context ?? {};
      if (typeof ctx.providerId === "string") {
        stats.providers[ctx.providerId] = (stats.providers[ctx.providerId] ?? 0) + 1;
      }
      if (typeof d.sessionId === "string") {
        stats.sessions[d.sessionId] = (stats.sessions[d.sessionId] ?? 0) + 1;
      }
      if (
        typeof ctx.attempt === "number" &&
        typeof ctx.maxAttempts === "number" &&
        ctx.attempt >= ctx.maxAttempts
      ) {
        stats.fatal += 1;
      }
      if (typeof d.timestamp === "string" && (!stats.lastAt || d.timestamp > stats.lastAt)) {
        stats.lastAt = d.timestamp;
      }
      noteTs(d.timestamp);
      const b = bucketOf(d.timestamp);
      if (b) dirty.add(b);
      // 回合口径素材：复合键（缺一不可）与首撞（attempt 缺失按 1 计，宁可计入不漏报）
      if (typeof d.sessionId === "string" && typeof d.turnId === "string" && d.turnId !== "") {
        turnKeyed += 1;
        const key = `${d.sessionId}\u0000${d.turnId}`;
        const prev = turnSeen.get(key);
        if (!prev || d.timestamp < prev) turnSeen.set(key, d.timestamp);
      }
      const attempt = typeof ctx.attempt === "number" ? ctx.attempt : 1;
      if (attempt === 1) {
        const h = localHourOf(d.timestamp);
        if (h !== null) attemptHour[h] += 1;
      }
    }
  }

  const coverage = stats.rateLimited > 0 ? turnKeyed / stats.rateLimited : 0;
  stats.caliber = coverage >= TURN_COVERAGE_MIN ? "turn" : "first-attempt";
  stats.turns = stats.caliber === "turn" ? turnSeen.size : attemptHour.reduce((a, n) => a + n, 0);
  if (typeof minTs === "string" && typeof maxTs === "string") {
    stats.spanHours = Math.max(
      1,
      Math.ceil((Date.parse(maxTs) - Date.parse(minTs)) / 3_600_000)
    );
  }

  const dirtyKnown = [...dirty].filter((b) => active.has(b));
  for (const b of dirtyKnown) {
    const n = active.get(b).size;
    const bin = stats.dirtyDist.find((x) => x.active === n);
    if (bin) bin.buckets += 1;
    else stats.dirtyDist.push({ active: n, buckets: 1 });
  }
  stats.dirtyDist.sort((a, b2) => a.active - b2.active);

  if (dirtyKnown.length > 0) {
    const minDirty = Math.min(...dirtyKnown.map((b) => active.get(b).size));
    const cleanBuckets = [...active.keys()].filter((b) => !dirty.has(b));
    const maxClean = cleanBuckets.length > 0 ? Math.max(...cleanBuckets.map((b) => active.get(b).size)) : 0;
    stats.band =
      dirtyKnown.length >= 3 && cleanBuckets.length >= 3 && minDirty > maxClean
        ? { coherent: true, minDirty, maxClean }
        : { coherent: false, minDirty, maxClean };
  }

  // 最长连续脏游程：UTC 毫秒差判连续（跨文件/跨午夜不断链）；游程在 UTC 域做，展示层才转本地
  const dirtyMs = [...dirty].sort().map((k) => Date.parse(`${k}:00Z`)).filter((n) => !Number.isNaN(n));
  let run = 0;
  for (let i = 0; i < dirtyMs.length; i += 1) {
    run = i > 0 && dirtyMs[i] - dirtyMs[i - 1] === 60_000 ? run + 1 : 1;
    if (run > stats.longestRunMin) stats.longestRunMin = run;
  }

  // 集中段：本地小时 3 小时环形窗；turn 口径按回合最早事件归时，first-attempt 口径按首撞事件归时
  if (stats.turns > 0) {
    const hourTurns = new Array(24).fill(0);
    if (stats.caliber === "turn") {
      for (const ts of turnSeen.values()) {
        const h = localHourOf(ts);
        if (h !== null) hourTurns[h] += 1;
      }
    } else {
      for (let h = 0; h < 24; h += 1) hourTurns[h] = attemptHour[h];
    }
    const total = stats.turns;
    let best = null;
    for (let h = 0; h < 24; h += 1) {
      const wTurns = hourTurns[h] + hourTurns[(h + 1) % 24] + hourTurns[(h + 2) % 24];
      const wStarted = startedByHour[h] + startedByHour[(h + 1) % 24] + startedByHour[(h + 2) % 24];
      const share = wTurns / total;
      if (
        share >= CONC_SHARE_MIN &&
        wTurns >= CONC_TURNS_MIN &&
        wStarted >= CONC_STARTED_MIN &&
        (best === null || wTurns > best.turns)
      ) {
        best = { startHour: h, endHour: (h + 3) % 24, sharePct: Math.round(share * 100), turns: wTurns };
      }
    }
    stats.concentration = best;
  }
  return stats;
}
