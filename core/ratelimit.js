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
// - 坏行/半行（引擎活体写入中）按可解析前缀静默跳过（fail-soft）；
// - 传输死亡族（ADR-0008）与限流分族计数：429 分支保持原子串谓词零语义变化，
//   传输族另挂 "event":"model.request.failed" 预过滤（errno 主判据在 statusMessage，
//   实测 ENETDOWN 事故 reason=unknown，按 reason 白名单会漏掉触发事故本身），
//   只进 doctor transport 行，绝不进并发带/错峰窗数学（测量纯度）。
import { createReadStream } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const LOG_RE = /^zcode-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const TURN_COVERAGE_MIN = 0.9;
const CONC_SHARE_MIN = 0.6;
const CONC_TURNS_MIN = 10;
const CONC_STARTED_MIN = 100;
// 传输死亡 errno 家族（字面量清单，实测形态见 test/ratelimit.contract.test.js fixture）
const ERRNO_RE =
  /\b(ENETDOWN|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|ECONNABORTED|EPIPE)\b/;
// RFC 2544 保留段（Clash/mihomo fake-ip 默认段）：命中=本地代理 TUN 隧道疑似的提示依据
const FAKEIP_RE = /\b198\.(?:18|19)\.\d+\.\d+\b/;
const SAMPLE_MAX = 5;

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
    transport: {
      events: 0, // 原始传输死亡事件数（含重试）
      turns: 0, // 去重回合数（口径同限流族：coverage ≥0.9 用复合键，否则 first-attempt）
      caliber: "turn",
      byCode: {}, // 子类型 → 事件数（errno / network_error / connect_timeout）
      firstAt: null,
      lastAt: null,
      samples: [], // ≤SAMPLE_MAX 条 statusMessage 摘录（doctor 行证据）
      fakeIp: false, // 任一样本地址 ∈ 198.18.0.0/15（本地代理 TUN 疑似）
    },
  };

  const active = new Map(); // 桶键 → Set(sessionId)（started 事件）
  const dirty = new Set(); // 出现过 429 失败的桶键
  const startedByHour = new Array(24).fill(0); // 本地小时 → started 事件数
  const turnSeen = new Map(); // 复合键 → 最早事件 ts（ISO 字符串，字典序即时序）
  const attemptHour = new Array(24).fill(0); // first-attempt 口径的本地小时分布
  const tSeen = new Map(); // 传输族复合键 → 最早事件 ts（口径机制与限流族同款）
  let tKeyed = 0; // 传输族带完整复合键的事件数
  let tFirstAttempt = 0; // 传输族 first-attempt 口径计数（attempt 缺失按 1 计）
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
      // 双族双预过滤：429 保持原子串谓词（零语义变化，基线 diff 护栏）；传输族挂 failed 事件。
      // 任一命中才 parse，一遍扫描两族不串计（429 分支后显式 continue 跳过传输族）。
      const isRateLimited = line.includes('"reason":"rate_limited"');
      const isFailed = line.includes('"event":"model.request.failed"');
      if (!isRateLimited && !isFailed) continue;
      const d = tryParse(line);
      if (!d) continue; // 坏行/半行：fail-soft，不计入也不报错
      if (isRateLimited) {
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
        continue; // 限流族已收口；rate_limited 不是传输死亡，绝不串计
      }
      // ── 传输死亡族（ADR-0008）：请求未达服务端类故障，errno 主判据 ──
      const tctx = d.context ?? {};
      const sm = typeof tctx.statusMessage === "string" ? tctx.statusMessage : "";
      let subtype = null;
      const errno = sm.match(ERRNO_RE);
      if (errno) {
        subtype = errno[1]; // 主判据：statusMessage 携带 errno（实测 ENETDOWN 事故 reason=unknown）
      } else if (tctx.reason === "network_error") {
        subtype = "network_error"; // undici 泛化形态（无 errno 可提）
      } else if (tctx.reason === "timeout" && /connect timeout/i.test(sm)) {
        subtype = "connect_timeout"; // 仅收连接阶段超时，不误收服务端慢
      }
      if (!subtype) continue; // cancelled/server_error/invalid_request/无 context 残行：忽略
      const t = stats.transport;
      t.events += 1;
      t.byCode[subtype] = (t.byCode[subtype] ?? 0) + 1;
      if (typeof d.timestamp === "string") {
        if (!t.firstAt || d.timestamp < t.firstAt) t.firstAt = d.timestamp;
        if (!t.lastAt || d.timestamp > t.lastAt) t.lastAt = d.timestamp;
      }
      if (sm && t.samples.length < SAMPLE_MAX) t.samples.push(`${subtype}: ${sm.slice(0, 120)}`);
      if (!t.fakeIp && FAKEIP_RE.test(sm)) t.fakeIp = true;
      if (typeof d.sessionId === "string" && typeof d.turnId === "string" && d.turnId !== "") {
        tKeyed += 1;
        const key = `${d.sessionId}\u0000${d.turnId}`;
        const prev = tSeen.get(key);
        if (!prev || d.timestamp < prev) tSeen.set(key, d.timestamp);
      }
      const tAttempt = typeof tctx.attempt === "number" ? tctx.attempt : 1;
      if (tAttempt === 1) tFirstAttempt += 1;
    }
  }

  const coverage = stats.rateLimited > 0 ? turnKeyed / stats.rateLimited : 0;
  stats.caliber = coverage >= TURN_COVERAGE_MIN ? "turn" : "first-attempt";
  stats.turns = stats.caliber === "turn" ? turnSeen.size : attemptHour.reduce((a, n) => a + n, 0);
  // 传输族回合口径：机制与限流族同款（覆盖率达标用复合键去重，否则首撞计数）
  const tCoverage = stats.transport.events > 0 ? tKeyed / stats.transport.events : 0;
  stats.transport.caliber = tCoverage >= TURN_COVERAGE_MIN ? "turn" : "first-attempt";
  stats.transport.turns = stats.transport.caliber === "turn" ? tSeen.size : tFirstAttempt;
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

// ── 带内调度建议（测量→调度闭环）：把实测统计翻译成 zw 子代理并行上限 ──────
// 宁可保守：最近 60min 内撞线或当前处于实测集中段 → 串行；连贯经验带且净桶安全界
// ≥2 → 上限 2（与 zw 技能默认并行纪律一致）；数据不足/带不连贯 → 保守串行。
// 纯函数：stats 是 collectRateLimitStats 的产物，now 可注入以便测试。
export function bandAdvisory(stats, now = new Date()) {
  if (!stats?.available) {
    return { cap: 2, reason: "无限流数据（无引擎日志）——沿用技能默认（≤2，仅限独立取证）" };
  }
  if (stats.rateLimited === 0) {
    return { cap: 2, reason: "近期日志无 429——沿用技能默认（≤2，仅限独立取证）" };
  }
  // lastAt 在未来（时钟偏差）也按「刚撞线」保守处理
  const recentMin = stats.lastAt
    ? Math.round((now.getTime() - Date.parse(stats.lastAt)) / 60_000)
    : null;
  if (recentMin !== null && Number.isFinite(recentMin) && recentMin <= 60) {
    return { cap: 1, reason: `${Math.max(0, recentMin)} 分钟前仍在撞线——建议串行，等窗口回落` };
  }
  const c = stats.concentration;
  if (c) {
    const h = now.getHours();
    const inWindow =
      c.startHour <= c.endHour ? h >= c.startHour && h < c.endHour : h >= c.startHour || h < c.endHour;
    if (inWindow) {
      return {
        cap: 1,
        reason: `当前处于实测限流集中段（本地 ${c.startHour}–${c.endHour} 点，份额 ${c.sharePct}%）——建议串行/错峰`,
      };
    }
  }
  const b = stats.band;
  if (b?.coherent && b.maxClean >= 2) {
    return {
      cap: 2,
      reason: `实测经验带：净桶 ${b.maxClean} 会话无 429 / ${b.minDirty} 会话即撞线——独立 F 项取证可 ≤2 并行`,
    };
  }
  return { cap: 1, reason: "经验带不连贯（归因漂移下是常态）——保守串行" };
}

// ── 传输死亡建议（ADR-0008）：把传输族统计翻译成 doctor transport 行文案 ──────
// warn-only：诊断自身不翻退出码；不提供任何带数学输入（测量纯度，与限流分家的全部理由）。
// 纯函数：stats 是 collectRateLimitStats 的产物。
export function transportAdvisory(stats) {
  if (!stats?.available) {
    return { level: "skip", text: "无引擎日志可扫（传输死亡体检不可用）" };
  }
  const t = stats.transport ?? { events: 0, turns: 0, byCode: {}, lastAt: null, fakeIp: false };
  if (t.events === 0) {
    return { level: "ok", text: `近 ${stats.files} 日窗口 0 起传输死亡（请求未达服务端类故障）` };
  }
  const codes = Object.entries(t.byCode)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}×${v}`)
    .join(" ");
  const last = t.lastAt ? `${t.lastAt.slice(0, 16).replace("T", " ")}Z` : "";
  let text = `${t.turns} 回合 / ${t.events} 次传输死亡（${codes}，${t.caliber} 口径），最近 ${last}`;
  if (t.fakeIp) {
    text +=
      "；样本地址含 198.18.0.0/15 fake-ip——本地代理 TUN 隧道疑似，可给引擎域名加直连规则绕开隧道";
  }
  return { level: "warn", text };
}

// ── 错峰窗口建议（无人值守调度，ADR-0003）：从实测集中段反推自动化挂载时段 ──
// 集中段 [start, start+3) 本地小时 → 净弧 21h；建议窗口 = 净弧中央的 8 小时：
// start = (集中段终点 + 6) % 24（(21/2 向下取整 10) − 4）。纯函数，now 可注入测试。
// 无集中段证据 → null（doctor 走 skip，不凭空捏窗口）。
export function scheduleAdvisory(stats) {
  const c = stats?.concentration;
  if (!c) return null;
  const start = (c.endHour + 6) % 24;
  const end = (start + 8) % 24;
  const p2 = (n) => String(n).padStart(2, "0");
  return {
    startHour: start,
    endHour: end,
    text: `建议自动化窗口：本地 ${p2(start)}:00–${p2(end)}:00（避开实测集中段 ${p2(c.startHour)}:00–${p2(c.endHour)}:00，占 ${Math.max(1, Math.round(c.sharePct / 10))} 成）`,
  };
}
