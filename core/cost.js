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
// 源：GLM https://docs.bigmodel.cn/cn/coding-plan/overview——每列=积分/百万 token，
// 顺序 input / cache-read / output（plan-v2 报告 §1 记载口径）。表外 model_id 未计价：
// 计 0 积分并在报表独立提示行如实缺表，绝不猜系数。
export const COEFFICIENTS = {
  "GLM-5.3-Flash": { input: 2.3, cacheRead: 0.56, output: 8 },
  "GLM-5.3": { input: 6.9, cacheRead: 1.7, output: 24 },
};

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
    const coef = COEFFICIENTS[r.model];
    if (!coef) {
      if (typeof r.model === "string") unpricedModels.add(r.model);
      continue; // 未计价模型：0 积分如实缺表
    }
    const ms = Number(r.h) * 3_600_000;
    const mult = overlayMultiplier(r.model, ms) ?? standingMultiplier(ms);
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
// 口径披露（V021-ADJ-55，0.2.1 五轮双审·成立）：本读数**仅 GLM-5.3 族计价**——CASE 表外
// model_id（deepseek/… 6k+ 行实测）按 `ELSE 0` 计 0，故「近 5h 滚动 N 积分」是下界而非账号
// 全量；同查一并返回表外行数（unpricedRows），三处显示面（stop nudge / doctor waterline 行 /
// 本模块注释）据此如实标注，绝不把「未计价」渲染成「没消耗」。
export const WATERLINE_POINTS = 1600;
export const WATERLINE_ROLLING_SQL =
  "SELECT ROUND(SUM(input_tokens/1e6*CASE model_id WHEN 'GLM-5.3-Flash' THEN 2.3 WHEN 'GLM-5.3' THEN 6.9 ELSE 0 END+" +
  "cache_read_input_tokens/1e6*CASE model_id WHEN 'GLM-5.3-Flash' THEN 0.56 WHEN 'GLM-5.3' THEN 1.7 ELSE 0 END+" +
  "output_tokens/1e6*CASE model_id WHEN 'GLM-5.3-Flash' THEN 8 WHEN 'GLM-5.3' THEN 24 ELSE 0 END),1) AS pts, " +
  "SUM(CASE WHEN model_id IN ('GLM-5.3-Flash','GLM-5.3') THEN 0 ELSE 1 END) AS unpriced " +
  "FROM model_usage WHERE status='completed' AND started_at>=(strftime('%s','now')-18000)*1000";

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

// 数值面（drive 执法/CLI 预算读面沿用）：只取 points，null 语义同 rollingWaterline。
export function rollingWaterlinePoints() {
  return rollingWaterline()?.points ?? null;
}

// 口径披露句（单一来源，doctor 行与 stop nudge 副本同文案）：表外有行才出声。
export function waterlineScopeNote(unpricedRows) {
  const n = Number(unpricedRows);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `（口径：仅 GLM-5.3 族计价，表外模型 ${n} 行计 0——读数偏低）`;
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
