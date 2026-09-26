// 积分成本报表（plan-v2 Phase 2-2）：读引擎计费账本（只读，经 core/hostdb.js），按官方
// 常设系数折积分，促销活动走带日期区间的 overlay 层（退役/过期自然回落常设规则）。
// 归因用「简化 OR + 人工复核」（红队 R4 否决过巧公式）：目标时间窗 ∩（会话目录=本仓 ∪
// 认领会话集）。spawn 豁免声明：本模块经 hostdb 查 sqlite3——plan-v2 §4-2 明示豁免，
// loop.js 零 spawn 纪律不受影响。
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { queryHostDb } from "./hostdb.js";
import { billingDbPath } from "./paths.js";
import { utc8HourDay } from "./ratelimit.js";

// ── 系数表（官方常设规则，人工维护，沿 PEAK_WINDOWS 先例：对照官方文档逐条更新并保留源）
//
// **单位明文（0.2.2 棒1#N8，ADR-0023）：元/百万 token（人民币，官方价目页）。**
// 三列顺序 input / cache-read / output。GLM 两行沿用既有数值（本就同量级，不回改）；
// 表内数值一律取官方**高峰价**，非高峰由 standingMultiplier 统一 ×0.5 承担——DeepSeek
// 官方恰好同构（高峰=空闲×2），故两家共用一条时段规则。
//
// 源：GLM https://docs.bigmodel.cn/cn/coding-plan/overview
//     DeepSeek https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
//     （2026-09-21 实取：deepseek-flash／DeepSeek-V4.1-Flash 高峰 输入 2 / 缓存命中 0.04 /
//      输出 8，空闲 = 其半。旧标识 deepseek-v4-flash 由 V4.1-Flash 响应，同价。）
//
// **表外 model_id 未计价：计 0 积分并在报表独立提示行具名如实缺表，绝不猜系数。**
// 覆盖面规则（ADR-0023）=「有官方价目页可引的逐条枚举」：只有拿得到 official 源并逐字
// 核过的 model_id 入表。2026-09-21 实测两处**查而无源**故不入表：MiniMax
// （platform.minimaxi.com/document/{price,guides/pricing} 只列语音套餐，无每百万 token 价）
// 与 MiMo（platform.xiaomimimo.com → mimo.mi.com/docs/pricing 为占位页）。
// 补表=在 ALIASES 加一行 + 在 COEFFICIENTS 补系数并把源写进本注释。
export const COEFFICIENTS = {
  "GLM-5.3-Flash": { input: 2.3, cacheRead: 0.56, output: 8 },
  "GLM-5.3": { input: 6.9, cacheRead: 1.7, output: 24 },
  "DeepSeek-V4.1-Flash": { input: 2, cacheRead: 0.04, output: 8 },
};

// 账本 model_id → 系数表键：**小写化后精确匹配**（键=账本实见形态，一律小写）。
// 刻意不做模糊/前缀/后缀匹配——那样会「猜」到不该计价的 model_id 上，违反绝不猜系数。
// 代价是新 provider 前缀会落到表外（计 0 + 披露具名），这正是**安全的失败方向**：宁可
// 读数偏低并如实标注，不可虚高。加一行即补上。
export const MODEL_ALIASES = {
  "glm-5.3-flash": "GLM-5.3-Flash", // 账本实见两种大小写形态，小写化后归一
  "glm-5.3": "GLM-5.3",
  "deepseek/deepseek-v4.1-flash": "DeepSeek-V4.1-Flash", // provider 前缀形态（本机账本实见）
  "deepseek/deepseek-v4-flash": "DeepSeek-V4.1-Flash", // 官方注明旧标识由 V4.1-Flash 响应，同价
  "deepseek-v4.1-flash": "DeepSeek-V4.1-Flash", // 无前缀形态
};

/** 取某 model_id 的系数（无则 null=未计价）。参数可以是任何账本原样值。 */
export function coefficientFor(modelId) {
  const key = MODEL_ALIASES[String(modelId ?? "").toLowerCase()];
  return key ? COEFFICIENTS[key] : null;
}

/** 计价覆盖面标签（披露句常驻引用；不随窗口消失）。 */
export function pricedScopeLabel() {
  return Object.keys(COEFFICIENTS).join("/");
}

// 常设时段乘数：GLM 高峰（周一至五 14–18 UTC+8）×1.0，其余非高峰五折 ×0.5。
// GLM_PEAK 与 ratelimit.js PEAK_WINDOWS 的 GLM 行同形——双位点人工维护，改一处须同步另一处。
export const GLM_PEAK = { days: [1, 2, 3, 4, 5], start: 14, end: 18 };
export const PEAK_MULTIPLIER = 1.0;
export const OFF_PEAK_MULTIPLIER = 0.5;

// ── 促销 overlay（带日期区间的活动条款；退役/过期自然失效回落常设）。
// 条目 = { label, fromMs, untilMs(不含), hours:[start,end) 可跨午夜(UTC+8), multipliers:{model:×} }
// overlay 生效窗内【取代】常设时段乘数；map 无该模型键 → 回落常设（条款未提的模型不乱折）。
// 首条=「夜间畅用活动」（官方公告：docs.bigmodel.cn/cn/coding-plan/notice/event-glm-5.3-flash，
// 2026-09-13 业主提供原文核对）：2026-09-03 至 09-20 每日 23:00–次日 09:00（北京时间，含周末）——
// ZCode 内 GLM-5.3-Flash 额度消耗 0；Flash 经其他 Agent 全部 ×2（本账本全为 ZCode 会话，不设键；
// 若他源 Flash 行入库再补 provider 维度）；GLM-5.3 按套餐标准规则（=常设，不设键自然回落）。
// 日期读法=夜间归属其开始日：fromMs 取首夜 09-03 23:00、untilMs 取末夜结束 09-21 09:00（不含）。
export const OVERLAYS = [
  {
    label: "GLM 夜间畅用活动 09-03～09-20（ZCode 内 Flash 额度消耗 0）",
    fromMs: Date.parse("2026-09-03T23:00:00+08:00"),
    untilMs: Date.parse("2026-09-21T09:00:00+08:00"),
    hours: [23, 9],
    multipliers: { "GLM-5.3-Flash": 0 },
  },
];

function hourInWindow(h, [start, end]) {
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

// overlay 命中返回该条乘数（model 精确匹配优先于 "*"），未命中返回 null——由调用方回落常设。
export function overlayMultiplier(model, ms) {
  for (const o of OVERLAYS) {
    if (ms < o.fromMs || ms >= o.untilMs) continue;
    if (!hourInWindow(utc8HourDay(new Date(ms)).hour, o.hours)) continue;
    const m = o.multipliers[model] ?? o.multipliers["*"];
    return typeof m === "number" ? m : null;
  }
  return null;
}

export function standingMultiplier(ms) {
  const { hour, day } = utc8HourDay(new Date(ms));
  const peak = GLM_PEAK.days.includes(day) && hourInWindow(hour, [GLM_PEAK.start, GLM_PEAK.end]);
  return peak ? PEAK_MULTIPLIER : OFF_PEAK_MULTIPLIER;
}

// 全表聚合查询（字面量 SQL，无参数拼接——安全形态；小时桶=epoch/3600000 整除，
// 乘数判定只需小时粒度）。cache_creation 未计入（口径假设，known unknowns #1 对账项）。
export const USAGE_SQL =
  "SELECT m.session_id AS sid, s.directory AS dir, m.model_id AS model, " +
  "m.started_at/3600000 AS h, SUM(m.input_tokens) AS it, " +
  "SUM(m.cache_read_input_tokens) AS crt, SUM(m.output_tokens) AS ot " +
  "FROM model_usage m LEFT JOIN session s ON s.id = m.session_id " +
  "WHERE m.status = 'completed' GROUP BY sid, model, h";

export function collectUsageRows() {
  const db = billingDbPath();
  if (!existsSync(db)) return null;
  return queryHostDb(db, USAGE_SQL); // null=sqlite3 缺席/查询失败（降级面），[]=空账本
}

// 纯聚合（canned rows 可测）：points=Σ tokens/1e6×系数×(overlay ?? 常设)乘数。
export function computePoints(rows) {
  const bySession = new Map();
  const unpricedModels = new Set();
  let total = 0;
  for (const r of rows ?? []) {
    const key = MODEL_ALIASES[String(r.model ?? "").toLowerCase()];
    const coef = key ? COEFFICIENTS[key] : null;
    if (!coef) {
      if (typeof r.model === "string") unpricedModels.add(r.model);
      continue; // 未计价模型：0 积分如实缺表（且由 formatCost 具名列出）
    }
    const ms = Number(r.h) * 3_600_000;
    // overlay 与常设乘数一律按**规范键**判定（overlay 表写规范名，账本给原始形态）
    const mult = overlayMultiplier(key, ms) ?? standingMultiplier(ms);
    const pts =
      ((coef.input * (Number(r.it) || 0) +
        coef.cacheRead * (Number(r.crt) || 0) +
        coef.output * (Number(r.ot) || 0)) /
        1e6) *
      mult;
    total += pts;
    bySession.set(r.sid, (bySession.get(r.sid) ?? 0) + pts);
  }
  return { points: total, bySession, unpricedModels };
}

// 认领会话集（本仓 loop/sessions/*.json 带 claimedAt 的 sid）。model_usage.session_id 与
// 会话文件同一标识空间是假设（known unknowns #1 同族）——错位时归因偏小，人工复核行兜底。
export function claimedSessionIds(cwd) {
  const dir = resolve(cwd, ".lazyzcode", "loop", "sessions");
  const claimed = new Set();
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const s = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
        if (s && s.claimedAt) claimed.add(f.replace(/\.json$/, ""));
      } catch {}
    }
  } catch {}
  return claimed;
}

// 简化 OR 归因：小时桶落目标窗内 且（会话目录=本仓 或 会话在认领集）。目录比较两侧
// realpath 归一（macOS /var→/private/var 符号链接实锤，字面相等会漏判——与 doctor
// checkOrphanWake 同款 normPath）。
const normPath = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
export function attributeGoalPoints(rows, goal, cwd, claimed) {
  const from = Date.parse(goal.startedAt);
  const to = goal.finishedAt ? Date.parse(goal.finishedAt) : Date.now();
  if (!Number.isFinite(from)) return { points: 0, sessions: 0 };
  const root = normPath(resolve(cwd));
  const claimedSet = claimed instanceof Set ? claimed : new Set(claimed ?? []);
  const picked = (rows ?? []).filter((r) => {
    const ms = Number(r.h) * 3_600_000;
    if (!(ms + 3_600_000 > from && ms <= to)) return false;
    return normPath(r.dir) === root || claimedSet.has(r.sid);
  });
  const { points, bySession } = computePoints(picked);
  return { points, sessions: bySession.size };
}

const fmt = (n) => (Math.round(n * 100) / 100).toString();

// ── 水位警戒线（canonical 定义；plugin/hooks/stop.js 持自包含同形副本——hook 部署后脱离
// core/，沿 hook-lib incMetrics 双份先例）。定标 2026-09-13：近 14 天滚动 5h 积分 p95≈1576
// （常设系数口径，不折时段/促销，偏保守上界）上取整到 1600；同批 max 1768 / 中位 748。
// env LZY_WATERLINE_POINTS 覆盖（全仓第二个 LZY_ 变量）。
// 口径披露（V021-ADJ-55 立于 0.2.1；**0.2.2 棒1#N8 收口**）：读数恒为**计价子集**上的下界——
// 表外 model_id 按 `ELSE 0` 计 0。0.2.1 时表内只有 GLM-5.3 族，而主力用量恰是表外的
// deepseek（5h 窗实测 282 行 vs GLM 侧近乎为零），等于水位门对本仓真实用量空转；本次把
// DeepSeek-V4.1-Flash 补进表（源见上），读数自此覆盖主力用量。**仍未入表者**（MiniMax/MiMo
// 族，查而无官方每百万 token 价）继续计 0 并在 `lzy loop cost` 具名——绝不把「未计价」
// 渲染成「没消耗」，同查返回表外行数（unpricedRows）供三处显示面标注。
export const WATERLINE_POINTS = 1600;

// 水位查询的 SQL **由系数表生成**（0.2.2 棒1#N8）：旧实现把同一张系数表以字面量手抄进
// SQL，于是「改一处须同步另一处」——ADJ-55 的半修风险正源于此（只改 core 侧就以为改完了）。
// 生成后表即单源：加一行 ALIASES/COEFFICIENTS，SQL 自动跟上，双位点漂移结构性消失。
// 匹配用 `lower(model_id)='<alias>'` 精确等值（与 coefficientFor 同一语义，同样不猜）。
function sqlLiteral(s) {
  // 别名来自本模块自持表，无用户输入；仍显式拒绝引号，防日后手工录入引入注入面。
  if (!/^[a-z0-9./_-]+$/i.test(s)) throw new Error(`系数表别名含非法字符：${s}`);
  return `'${s}'`;
}

function buildCoefficientCase(field) {
  const branches = Object.entries(MODEL_ALIASES)
    .map(([alias, key]) => `WHEN ${sqlLiteral(alias)} THEN ${COEFFICIENTS[key][field]} `)
    .join("");
  return `CASE lower(model_id) ${branches}ELSE 0 END`;
}

function buildWaterlineSql() {
  const pricedList = Object.keys(MODEL_ALIASES).map(sqlLiteral).join(",");
  return (
    `SELECT ROUND(SUM(input_tokens/1e6*${buildCoefficientCase("input")}+` +
    `cache_read_input_tokens/1e6*${buildCoefficientCase("cacheRead")}+` +
    `output_tokens/1e6*${buildCoefficientCase("output")}),1) AS pts, ` +
    `SUM(CASE WHEN lower(model_id) IN (${pricedList}) THEN 0 ELSE 1 END) AS unpriced ` +
    "FROM model_usage WHERE status='completed' AND started_at>=(strftime('%s','now')-18000)*1000"
  );
}

export const WATERLINE_ROLLING_SQL = buildWaterlineSql();

// 近 5h 滚动积分读数；账本缺席/sqlite3 缺席/查询失败返回 null（fail-soft，doctor 显示降级行）。
// 返回 { points, unpricedRows }——unpricedRows=窗内未计价模型行数（≥1 时显示面须带口径披露）。
export function rollingWaterline() {
  const db = billingDbPath();
  if (!existsSync(db)) return null;
  const rows = queryHostDb(db, WATERLINE_ROLLING_SQL);
  const pts = Number(rows?.[0]?.pts);
  if (!Number.isFinite(pts)) return null;
  const unpricedRows = Number(rows?.[0]?.unpriced);
  return { points: pts, unpricedRows: Number.isFinite(unpricedRows) ? unpricedRows : 0 };
}

// 数值面（drive/CLI 预算读面沿用）：只取 points，null 语义同 rollingWaterline。
export function rollingWaterlinePoints() {
  return rollingWaterline()?.points ?? null;
}

// 逐会话计量（#32 逐请求完成检测）：宿主 model_usage WHERE session_id，行→computePoints
// 折积分（ADR-0023 计价表）。零完成行=metering-absent（不算零）；未计价模型=同停类。
// queryHostDb 无参数绑定——sessionId 白名单净化后内插（引擎会话 id 空间 [A-Za-z0-9_-]）。
// **0.3.1 棒2（ADR-0027 修正节）：自 core/queue.js 迁入本模块=计量原语单源**——queue 侧
// （结算/dedup）与 drive 侧（段界归因）共用同一查询面，不另建积分权威；core/queue.js
// 保留 re-export 供既有导入面（test/queue-metering 等）。导出面=测试缝与 drive 注入缝。
export function querySessionPoints(sessionId) {
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return { absent: true, unpriced: [], points: 0 };
  const db = billingDbPath();
  if (!existsSync(db)) return { absent: true, unpriced: [], points: 0 };
  const sql =
    "SELECT m.session_id AS sid, m.model_id AS model, m.started_at/3600000 AS h, " +
    "SUM(m.input_tokens) AS it, SUM(m.cache_read_input_tokens) AS crt, SUM(m.output_tokens) AS ot " +
    "FROM model_usage m WHERE m.session_id = '" + sessionId + "' AND m.status = 'completed' " +
    "GROUP BY sid, model, h";
  let rows = null;
  try {
    rows = queryHostDb(db, sql); // null=sqlite3 缺席/查询失败（降级面）——同 metering-absent 停类
  } catch {
    rows = null;
  }
  if (rows == null) return { absent: true, unpriced: [], points: 0 };
  if (rows.length === 0) return { absent: true, unpriced: [], points: 0 };
  const agg = computePoints(rows);
  return { absent: false, unpriced: [...agg.unpricedModels], points: agg.points };
}

// 口径披露句（单一来源，doctor 行与 stop nudge 副本同文案）。
// **0.2.2 棒1#N8 起改为常驻**：旧实现「表外有行才出声」，于是扩表之后若窗内恰好没有表外
// 模型，整句会消失——而「这只是一个计价子集、读数是下界」是不随窗口变的事实，不该消失。
// 句内计价范围取自系数表（静态）；表外**具名**面在 `lzy loop cost` 的未计价行（全量账本
// 口径，不随 5h 窗滑动），故此处只报行数并指路。
export function waterlineScopeNote(unpricedRows) {
  const n = Number(unpricedRows);
  const tail = Number.isFinite(n) && n > 0 ? `，表外模型 ${n} 行计 0` : "";
  return `（口径：仅 ${pricedScopeLabel()} 计价${tail}——读数偏低；表外模型名见 lzy loop cost 未计价行）`;
}

export function formatCost(cwd, goal, now = new Date()) {
  const lines = [];
  const db = billingDbPath();
  if (!existsSync(db)) {
    lines.push(`积分成本报表：计费账本缺席（${db}），无积分可算`);
    return lines.join("\n");
  }
  const rows = collectUsageRows();
  if (rows === null) {
    lines.push("积分成本报表：sqlite3 缺席或账本不可读，降级跳过（fail-open）");
    return lines.join("\n");
  }
  const day7 = now.getTime() - 7 * 86_400_000;
  const day30 = now.getTime() - 30 * 86_400_000;
  const inRange = (fromMs) => (rows ?? []).filter((r) => Number(r.h) * 3_600_000 >= fromMs);
  const all = computePoints(rows);
  lines.push(
    `积分成本报表（常设系数+促销 overlay，UTC+8 口径）：近 7 天 ${fmt(computePoints(inRange(day7)).points)} · ` +
      `近 30 天 ${fmt(computePoints(inRange(day30)).points)} · 全部 ${fmt(all.points)} 积分`,
  );
  const unpriced = [...all.unpricedModels];
  if (unpriced.length > 0) {
    lines.push(`  未计价模型（0 积分如实缺表，对照官方文档补 COEFFICIENTS）：${unpriced.join("、")}`);
  }
  const active = OVERLAYS.filter((o) => now.getTime() < o.untilMs);
  lines.push(
    active.length > 0
      ? `  促销 overlay 生效中：${active.map((o) => `${o.label}（至 ${new Date(o.untilMs).toISOString().slice(0, 10)}）`).join("；")}`
      : "  促销 overlay：无生效条目（活动条款按日期区间自动回落常设规则）",
  );
  if (goal && (goal.startedAt || goal.finishedAt)) {
    const claimed = claimedSessionIds(cwd);
    const att = attributeGoalPoints(rows, goal, cwd, claimed);
    const doneSteps = (goal.steps ?? []).filter((s) => s.status === "done").length;
    const perStep = doneSteps > 0 ? att.points / doneSteps : att.points;
    lines.push(
      `  目标面 ${goal.slug}（${goal.status}）：归因积分 ${fmt(att.points)}（会话 ${att.sessions} 个，OR 口径）· ` +
        `步 ${doneSteps}/${(goal.steps ?? []).length} · 积分/步 ${fmt(perStep)}`,
    );
  }
  lines.push(
    "  人工复核：归因=时间窗∩(会话目录 OR 认领) 简化口径，session_id 标识空间同一性是假设——异常偏差先核对再下结论",
  );
  return lines.join("\n");
}
