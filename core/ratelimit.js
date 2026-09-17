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
// - 内容审核杀流族（2026-09-14 1301 活体事故）三族化：provider 内容审核中途杀流
//   （HTTP 200 正常开流、生成中途被掐），主判据钉死 context.statusMessage 单字段
//   （同传输族 errno 先例；伴生事件行被预过滤排除，error.cause 链藏码形态不计——
//   events 恒=死请求数，retryable=false 无重试放大故不需回合去重），只进 doctor
//   content 行，绝不进并发带/错峰窗数学（测量纯度）。
import { createReadStream, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { WATERLINE_POINTS } from "./cost.js";

const LOG_RE = /^zcode-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const TURN_COVERAGE_MIN = 0.9;
const CONC_SHARE_MIN = 0.6;
const CONC_TURNS_MIN = 10;
const CONC_STARTED_MIN = 100;
// 传输死亡 errno 家族（字面量清单，实测形态见 test/ratelimit.contract.test.js fixture）
const ERRNO_RE =
  /\b(ENETDOWN|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|ECONNABORTED|EPIPE)\b/;
// 内容审核杀流码族（字面量清单，2026-09-14 1301 真实事故为底本；新码现形即扩枚举）：
// BigModel 业务码以 "[码][文案][reqid]" 形态嵌在 statusMessage 头部
const CONTENT_KILL_RE = /\[(1301)\]/;
// RFC 2544 保留段（Clash/mihomo fake-ip 默认段）：命中=本地代理 TUN 隧道疑似的提示依据
const FAKEIP_RE = /\b198\.(?:18|19)\.\d+\.\d+\b/;
const SAMPLE_MAX = 5;
// 扫描体积预算(goal ratelimit-scan-budget):无人值守重试风暴期单日日志可膨胀至数百 MB,
// 全量逐行扫描实测 18–52s,吃掉 loop start/doctor 全部时延;测试 e2e 的 spawnSync 预算也被
// 撞死。两预算给扫描加确定性上界:超限只读文件尾部、超时提前中止,truncation 字段如实标注
// 样本不全(warn-only 经验测量语义允许截断;具名常量人工维护,沿 PEAK_WINDOWS 先例)。
const SCAN_MAX_BYTES_PER_FILE = 64 * 1024 * 1024;
const SCAN_TIME_BUDGET_MS = 10_000;

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

export async function collectRateLimitStats(
  logDir,
  { maxFiles = 2, maxBytesPerFile = SCAN_MAX_BYTES_PER_FILE, timeBudgetMs = SCAN_TIME_BUDGET_MS } = {},
) {
  const files = listRecentLogs(logDir, maxFiles);
  if (files.length === 0) return { available: false };

  const stats = {
    available: true,
    files: files.length,
    truncation: { truncatedFiles: 0, bytesSkipped: 0, timeExceeded: false }, // 体积预算命中记录;全零=全量样本
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
    content: {
      events: 0, // 内容审核杀流事件数（=死请求数：retryable=false 无重试放大，不需回合去重）
      byCode: {}, // provider 业务码 → 事件数（1301…；扩展=枚举加码）
      firstAt: null,
      lastAt: null,
      lastSessionId: null, // 诊断指针：最近一次死掉的会话（doctor 行给排查入口）
      samples: [], // ≤SAMPLE_MAX 条 statusMessage 摘录（doctor 行证据）
    },
  };

  const active = new Map(); // 桶键 → Set(sessionId)（started 事件）
  const dirty = new Set(); // 出现过 429 失败的桶键
  // provider 分桶素材（决策 #21 前置件，2026-09-14）：completed 行带 providerId（活体
  // 实证，started 行没有）——完成面逐 provider 记桶，429 面沿用 ctx.providerId 分组。
  const completedByProvider = new Map(); // providerId → (桶键 → Set(sessionId))
  const dirtyBucketsByProvider = new Map(); // providerId → Set(桶键)
  const dirtyProvidersAdd = (pid, b) => {
    if (!b) return;
    let s = dirtyBucketsByProvider.get(pid);
    if (!s) dirtyBucketsByProvider.set(pid, (s = new Set()));
    s.add(b);
  };
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
    // 只收可解析时间戳：引擎畸形行（如 9999-99-99T99:99:99Z）不得把 NaN 带进
    // spanHours/带数学（对抗审查 R5-A：doctor 行渲染「近 NaNh」实锤形态）
    if (!Number.isFinite(Date.parse(ts))) return;
    if (!minTs || ts < minTs) minTs = ts;
    if (!maxTs || ts > maxTs) maxTs = ts;
  };

  let timeUp = false;
  const scanStart = Date.now();
  for (const file of files) {
    if (timeUp) break;
    // 字节预算:超限只读尾部(最新事件在尾部);截断起点可能落行中,首残行走既有 fail-soft 路径
    let start = 0;
    try {
      const size = statSync(file).size;
      if (size > maxBytesPerFile) {
        start = size - maxBytesPerFile;
        stats.truncation.truncatedFiles += 1;
        stats.truncation.bytesSkipped += start;
      }
    } catch {
      // stat 失败(文件竞态消失):照旧全量读,后续 open 失败由空流自然落空
    }
    const rl = createInterface({
      input: createReadStream(file, { encoding: "utf8", start }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (Date.now() - scanStart > timeBudgetMs) {
        stats.truncation.timeExceeded = true;
        timeUp = true;
        break;
      }
      if (line.includes('"event":"model.request.started"')) {
        const d = tryParse(line);
        const b = d ? bucketOf(d.timestamp) : null;
        if (b && typeof d.sessionId === "string" && d.sessionId) {
          let s = active.get(b);
          if (!s) active.set(b, (s = new Set()));
          s.add(d.sessionId);
        }
        const h = d ? localHourOf(d.timestamp) : null;
        if (h !== null) startedByHour[h] += 1;
        if (d) noteTs(d.timestamp);
        continue;
      }
      // 三族双预过滤+completed 素材行：429 保持原子串谓词（零语义变化，基线 diff 护栏）；
      // 传输族挂 failed 事件；completed 只作 provider 完成面计数。任一命中才 parse。
      const isRateLimited = line.includes('"reason":"rate_limited"');
      const isFailed = line.includes('"event":"model.request.failed"');
      const isCompleted =
        !isRateLimited && !isFailed && line.includes('"event":"model.request.completed"');
      if (!isRateLimited && !isFailed && !isCompleted) continue;
      const d = tryParse(line);
      if (!d) continue; // 坏行/半行：fail-soft，不计入也不报错
      if (isRateLimited) {
        stats.rateLimited += 1;
        const ctx = d.context ?? {};
        // 空 providerId 视同缺字段（对抗审查 R5-A：空串会渲染无名行）
        if (typeof ctx.providerId === "string" && ctx.providerId) {
          stats.providers[ctx.providerId] = (stats.providers[ctx.providerId] ?? 0) + 1;
          dirtyProvidersAdd(ctx.providerId, bucketOf(d.timestamp));
        }
        if (typeof d.sessionId === "string" && d.sessionId) {
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
        if (typeof d.sessionId === "string" && d.sessionId && typeof d.turnId === "string" && d.turnId !== "") {
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
      // ── completed 分桶素材（决策 #21 前置件）：只作 provider 完成面计数，绝不进
      // 账号级带/集中段数学（账号带仍只用 started，测量纯度）；缺 providerId/sessionId
      // 或桶键的样本静默跳过（fail-soft，与坏行同姿态）。
      if (isCompleted) {
        const cctx = d.context ?? {};
        const pid =
          typeof cctx.providerId === "string" && cctx.providerId ? cctx.providerId : null;
        const b =
          typeof d.sessionId === "string" && d.sessionId ? bucketOf(d.timestamp) : null;
        if (pid && b) {
          let m = completedByProvider.get(pid);
          if (!m) completedByProvider.set(pid, (m = new Map()));
          let s = m.get(b);
          if (!s) m.set(b, (s = new Set()));
          s.add(d.sessionId);
        }
        continue;
      }
      // ── 传输死亡族（ADR-0008）：请求未达服务端类故障，errno 主判据 ──
      const tctx = d.context ?? {};
      const sm = typeof tctx.statusMessage === "string" ? tctx.statusMessage : "";
      // ── 内容审核杀流族：provider 内容审核中途杀流（主判据钉死 statusMessage 单字段）──
      // statusMessage 判据先于传输族：errno 与业务码形态互斥，先后无碍；命中即 continue，
      // 绝不入 dirty/band/集中段数学（测量纯度，与限流族同款隔离）。
      const kill = sm.match(CONTENT_KILL_RE);
      if (kill) {
        const c = stats.content;
        c.events += 1;
        c.byCode[kill[1]] = (c.byCode[kill[1]] ?? 0) + 1;
        if (typeof d.timestamp === "string") {
          if (!c.firstAt || d.timestamp < c.firstAt) c.firstAt = d.timestamp;
          if (!c.lastAt || d.timestamp > c.lastAt) c.lastAt = d.timestamp;
        }
        if (typeof d.sessionId === "string") c.lastSessionId = d.sessionId;
        if (c.samples.length < SAMPLE_MAX) c.samples.push(`${kill[1]}: ${sm.slice(0, 120)}`);
        continue; // 内容杀流不是限流也不是传输死亡，绝不串计
      }
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
    if (timeUp) rl.input.destroy(); // 超时中止:底层文件流未读尽,显式销毁
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

// 循环归约取极值：Math.min(...spread) 在十万级桶上抛 RangeError（对抗审查 R5-A 实锤：
// 31MB 日志远在扫描预算内即可造出 124k 脏桶，fail-soft 吞掉整个限流族读数）
const minOf = (arr) => arr.reduce((m, v) => (v < m ? v : m), Infinity);
const maxOf = (arr) => arr.reduce((m, v) => (v > m ? v : m), -Infinity);

  if (dirtyKnown.length > 0) {
    const minDirty = minOf(dirtyKnown.map((b) => active.get(b).size));
    const cleanBuckets = [...active.keys()].filter((b) => !dirty.has(b));
    const maxClean = cleanBuckets.length > 0 ? maxOf(cleanBuckets.map((b) => active.get(b).size)) : 0;
    stats.band =
      dirtyKnown.length >= 3 && cleanBuckets.length >= 3 && minDirty > maxClean
        ? { coherent: true, minDirty, maxClean }
        : { coherent: false, minDirty, maxClean };
  }

  // provider 分桶带（决策 #21 前置件）：完成侧净面 × 429 脏面，逐 provider 重复账号级
  // 带机制（dirtyKnown≥3 ∧ cleanBuckets≥3 ∧ minDirty>maxClean 才连贯）。≥2 provider 才
  // 成表（单 provider=现状字节稳定）；只进 doctor band-by-provider 加行。
  const providerIds = new Set([...completedByProvider.keys(), ...dirtyBucketsByProvider.keys()]);
  stats.providersSeen = providerIds.size;
  if (providerIds.size >= 2) {
    stats.providerBands = [...providerIds].sort().map((pid) => {
      const completed = completedByProvider.get(pid) ?? new Map();
      const dirtyB = dirtyBucketsByProvider.get(pid) ?? new Set();
      const dirtyKnownP = [...dirtyB].filter((b) => completed.has(b));
      const minDirtyP =
        dirtyKnownP.length > 0 ? minOf(dirtyKnownP.map((b) => completed.get(b).size)) : 0;
      const cleanBucketsP = [...completed.keys()].filter((b) => !dirtyB.has(b));
      const maxCleanP =
        cleanBucketsP.length > 0 ? maxOf(cleanBucketsP.map((b) => completed.get(b).size)) : 0;
      return {
        provider: pid,
        minDirty: minDirtyP,
        maxClean: maxCleanP,
        dirtyBuckets: dirtyKnownP.length,
        cleanBuckets: cleanBucketsP.length,
        coherent: dirtyKnownP.length >= 3 && cleanBucketsP.length >= 3 && minDirtyP > maxCleanP,
      };
    });
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

// ── provider 分桶带建议（决策 #21 前置件，2026-09-14）：doctor band-by-provider 行 ──
// 完成侧净面 × 429 脏面的逐 provider 经验带；≥2 provider 才出行（单 provider=现状字节
// 稳定）。只读加行：不翻退出码、不进账号级带/错峰窗数学（测量纯度）。纯函数。
export function providerBandAdvisory(stats) {
  const rows = stats?.providerBands;
  if (!stats?.available || stats.providersSeen < 2 || !Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  // 显示面消毒：providerId 来自本地日志但仍剥控制字符（ANSI 逃逸不进终端，R5-A）
  const short = (p) =>
    (p.startsWith("builtin:") ? p.slice("builtin:".length) : p).replace(
      /[\x00-\x1f\x7f]/g,
      "·",
    );
  // 不连贯分两种如实说（评审 R3-A：真短缺≠归因漂移，混称「样本不足」误导读者）：
  // 无脏面（dirtyBuckets 0）=样本不足；两侧都有数据但不连贯=归因漂移（账号带同款措辞）。
  const shown = rows
    .slice(0, 4)
    .map((r) => {
      // 债6（0.0.10）：连贯带升格带行动建议（复用账号级 bandAdvisory 措辞，按 provider 取行）——
      // GLM 撞线不再连累他 provider 会话的并发判断；仍是纯建议文本，不进任何谓词/数学。
      if (r.coherent)
        return `${short(r.provider)}：带 ≤${r.maxClean} 净/${r.minDirty} 撞（连贯）→ 该 provider 独立会话可 ≤${r.maxClean} 并行`;
      if (r.dirtyBuckets === 0) return `${short(r.provider)}：无脏面样本（净桶 ${r.cleanBuckets}）`;
      return `${short(r.provider)}：带不连贯（归因漂移，净桶 ${r.cleanBuckets}/脏桶 ${r.dirtyBuckets}）`;
    });
  const more = rows.length > 4 ? `（余 ${rows.length - 4} 带略）` : "";
  return {
    level: "ok",
    text: `按 provider 分桶（完成侧净面×429 脏面）：${shown.join(" · ")}${more}`,
  };
}

// 混算口径注句（债6，0.0.10）：账号级建议行全 provider 混算——GLM 撞线时账号级建议行
// 对他 provider 会话过保守（09-17 五并发狗粮实证：纯窗口零限流、账号级行仍报撞线）。
// 只加行不动主行：返回 null 或独立一行文本，429 谓词与账号级主行字节零变化。纯函数。
export function providerMixNote(stats) {
  if (!stats?.available || !(stats.providersSeen >= 2)) return null;
  return `混算口径 · 账号级建议含 ${stats.providersSeen} 家 provider 的 429 数据——一家撞线不代表他 provider 同压；逐 provider 经验带见 band-by-provider 行`;
}

// ── 成本档位建议（成本两件套②「成功即降档」，2026-09-14；差距 F1 抄 ouroboros/PAL 两件）──
// 近窗零 429 且滚动水位低于警戒线一半 → 建议下个常规目标试轻量模型档位（失败即回档）；
// 否则维持档位。纯建议文本：只进 doctor cost 行，绝不进 429 谓词/带/错峰窗数学（测量
// 纯度）。水位读数缺席（null，账本/sqlite3 缺席）→ 维持并如实注明——无成本证据不怂恿降档。
// 纯函数：stats 是 collectRateLimitStats 产物，水位/阈值注入以便无账本环境确定性测试。
export function costAdvisory(stats, waterlinePts, threshold = WATERLINE_POINTS) {
  if (!stats?.available) return null;
  const th = Number(threshold) || WATERLINE_POINTS;
  if (stats.rateLimited === 0) {
    if (Number.isFinite(waterlinePts) && waterlinePts < th / 2) {
      return {
        level: "ok",
        text: `近窗零限流 · 滚动水位 ${waterlinePts}/${th} 低——下个常规目标可试轻量模型档位（成本），失败即回档`,
      };
    }
    const w = Number.isFinite(waterlinePts) ? `滚动水位 ${waterlinePts}/${th}` : "水位读数缺席";
    return { level: "ok", text: `近窗零限流 · ${w}——档位维持` };
  }
  const unit = stats.caliber === "turn" ? "回合" : "次首撞";
  return { level: "ok", text: `近窗 ${stats.turns} ${unit}限流——档位维持（轻量档会放大重试与撞线）` };
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

// ── 内容审核杀流建议：把 content 族统计翻译成 doctor content 行文案 ──────────
// warn-only：诊断自身不翻退出码；不提供任何带数学输入（测量纯度，与限流/传输分家的全部理由）。
// 纯函数：stats 是 collectRateLimitStats 的产物。
export function contentAdvisory(stats) {
  if (!stats?.available) {
    return { level: "skip", text: "无引擎日志可扫（内容审核杀流体检不可用）" };
  }
  const c = stats.content ?? { events: 0, byCode: {}, lastAt: null, lastSessionId: null };
  if (c.events === 0) {
    return { level: "ok", text: `近 ${stats.files} 日窗口 0 起内容审核杀流（provider 内容审核中途杀流族）` };
  }
  const codes = Object.entries(c.byCode)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}×${v}`)
    .join(" ");
  const last = c.lastAt ? `${c.lastAt.slice(0, 16).replace("T", " ")}Z` : "";
  const sid = c.lastSessionId ? `${c.lastSessionId.slice(0, 20)}…` : "";
  let text = `${c.events} 次内容审核杀流（1301 族 ${codes}，最近 ${last}${sid ? `，死会话 ${sid}` : ""}）`;
  text += "——原地重试必复现：换新会话/换问法续做，不是配额压力";
  return { level: "warn", text };
}

// ── 错峰窗口建议（无人值守调度，ADR-0003 + 2026-09-10 计价维度修正案）────────
// 集中段 [start, start+3) 本地小时 → 净弧 21h；建议窗口 = 净弧中央的 8 小时：
// start = (集中段终点 + 6) % 24（(21/2 向下取整 10) − 4）。无集中段证据 → null
//（doctor 走 skip，不凭空捏窗口）。
// 计价维度（静态表，人工维护）：限流窗逐本地小时对照已知平台高峰计价表（UTC+8），
// 输出重叠段与计价安全窗。表是「人工维护的已知事实」，不是测量——表过期只会让
// 建议失准（免责已在文案声明），不会误操作。纯函数；now 注入以便测试。
// UTC+8 换算走纯 UTC 路径（getUTCHours+8），与运行机器本地时区无关。

// 平台高峰计价表（小时为 UTC+8 墙钟；days 为 UTC+8 周几 1=周一…5=周五；半开 [start,end)）
// 维护时对照官方文档逐条更新并保留源：GLM https://docs.bigmodel.cn/cn/coding-plan/overview
//   （高峰周一至五 14–18；另有「夜间畅用活动」2026-09-03 至 09-20 每日 23–09：ZCode 内
//    GLM-5.3-Flash 额度消耗 0、Flash 经其他 Agent ×2、GLM-5.3 按标准规则——源
//    docs.bigmodel.cn/cn/coding-plan/notice/event-glm-5.3-flash，记入 SAFE_WINDOW）
// DeepSeek https://api-docs.deepseek.com/zh-cn/quick_start/pricing/（高峰周一至五 9–12 与 14–18）
const PEAK_WINDOWS = [
  { label: "GLM", days: [1, 2, 3, 4, 5], start: 14, end: 18 },
  { label: "DeepSeek", days: [1, 2, 3, 4, 5], start: 9, end: 12 },
  { label: "DeepSeek", days: [1, 2, 3, 4, 5], start: 14, end: 18 },
];
// 计价安全窗（每日，无周几维度）：GLM 夜间活动时段 ∩ 两家共同非高峰
const SAFE_WINDOW_TEXT =
  "计价安全窗：每日 23:00–09:00（GLM 夜间畅用活动至 09-20：ZCode 内 Flash 额度消耗 0，活动期条款以官方文档为准）";

// 纯 UTC 换算：now 对应的 UTC+8 小时与周几（day: 0=周日…6=周六）。与本地时区无关。
export function utc8HourDay(now) {
  const d = new Date(now.getTime() + 8 * 3_600_000);
  return { hour: d.getUTCHours(), day: d.getUTCDay() };
}

// 候选窗（本地小时，半开）对照高峰表：以「now 起下一个进入窗的整点」为锚，沿窗弧
// 回卷枚举恰好 total 个窗内小时——R6F-1：锚落窗尾时线性连走会溢出窗外，把窗外小时
// 误报「窗内落高峰」且漏检窗内剩余小时；越窗尾即回卷窗头恰好覆盖窗弧全集。每步从
// 同一时刻导出本地小时（直方图时间轴）与 UTC+8 小时/周几（计价表时间轴），周几取
// 真实未来日期——固定 now 即可确定性测试，跨午夜/周几翻转自然覆盖。
function overlapSegments(start, end, now) {
  const inWin = (h) => (start < end ? h >= start && h < end : h >= start || h < end);
  const nextWindowHour = (fromMs) => {
    const hour0 = Math.floor(fromMs / 3_600_000) * 3_600_000;
    for (let i = 0; i < 48; i++) {
      const t = hour0 + i * 3_600_000; // hour0 恒 ≤ fromMs，首个窗内整点必在 24h 内出现
      if (inWin(new Date(t).getHours())) return t;
    }
    return hour0; // 不可达：窗非空，24h 内必有整点入口
  };
  const total = (end - start + 24) % 24 || 24;
  const segs = [];
  let segStart = null;
  let prev = null;
  let prevMs = null;
  let t = nextWindowHour(now.getTime());
  for (let i = 0; i < total; i++) {
    if (prevMs !== null && t !== prevMs + 3_600_000 && segStart !== null) {
      segs.push([segStart, (prev + 1) % 24]); // 窗尾→窗头回卷点强制断段：防两个窗日的高峰段伪合并
      segStart = null;
    }
    const d = new Date(t);
    const localHour = d.getHours();
    const { hour, day } = utc8HourDay(d);
    const hit = PEAK_WINDOWS.some(
      (w) =>
        w.days.includes(day) &&
        (w.start < w.end ? hour >= w.start && hour < w.end : hour >= w.start || hour < w.end),
    );
    if (hit) {
      if (segStart === null) segStart = localHour;
    } else if (segStart !== null) {
      segs.push([segStart, localHour]);
      segStart = null;
    }
    prev = localHour;
    prevMs = t;
    t = inWin(new Date(t + 3_600_000).getHours()) ? t + 3_600_000 : nextWindowHour(t + 3_600_000);
  }
  if (segStart !== null) segs.push([segStart, (prev + 1) % 24]); // 弧尾仍在高峰：终点=窗尾下一小时
  const p2 = (n) => String(n).padStart(2, "0");
  return segs.map(([a, b]) => `${p2(a)}:00–${p2(b)}:00`);
}

export function scheduleAdvisory(stats, now = new Date()) {
  const c = stats?.concentration;
  if (!c) return null;
  const start = (c.endHour + 6) % 24;
  const end = (start + 8) % 24;
  const p2 = (n) => String(n).padStart(2, "0");
  const overlaps = overlapSegments(start, end, now);
  let text =
    `建议自动化窗口：本地 ${p2(start)}:00–${p2(end)}:00（避开实测集中段 ${p2(c.startHour)}:00–${p2(c.endHour)}:00，占 ${Math.max(1, Math.round(c.sharePct / 10))} 成）`;
  if (overlaps.length > 0) {
    text += `；⚠ 窗内 ${overlaps.join("、")} 落平台高峰计价（1×），错开更省`;
  }
  text += `；${SAFE_WINDOW_TEXT}（时段表 UTC+8，人工维护）`;
  return { startHour: start, endHour: end, overlaps, text };
}
