// v030-m0 积分归因探针（goal v030-m0#N3；零产品代码改动——本文件是探针工具）：
// 采样真实引擎 headless 运行，回答主方案 §5.2/V08 的能力三问：
//   a) --json summary 的 usage 字段实际形状（core 现为透传不消费，core/headless.js:157-168）；
//   b) 计费账本 model_usage 行的出现延迟（行可见性决定「停止下一次派发」检测是否可用）；
//   c) 并发运行的消耗可分性（按 session_id / 会话目录）与中断样本的记账形态。
// 语义边界（主方案 §5.2）：本探针只产诊断数据，V08 判定草稿由 goal 会话依据样本写成。
// 安全形态：sqlite3 只读 -readonly -json 字面量 argv + shell:false（core/hostdb.js 同款）；
// 真实 HOME（不传 home——OAuth 凭据与账本都在真 HOME，隔离 HOME 读到空库）。
// 用法：node scripts/probes/v030-m0-usage-probe.mjs --phase single|concurrent|interrupt --out <dir>
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnHeadless, detectHeadlessAuth } from "../../core/headless.js";
import { billingDbPath } from "../../core/paths.js";

const POLL_MS = 3_000;
const SINGLE_TIMEOUT_MS = 120_000;
const INTERRUPT_TIMEOUT_MS = 8_000;
const CHEAP_PROMPT = "Reply with exactly the single word: ok and nothing else.";
const SLOW_PROMPT =
  "Count slowly from 1 to 200, one number per line, with a short sentence after each number.";

function args() {
  const a = process.argv.slice(2);
  const get = (k) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : null;
  };
  const phase = get("--phase");
  const out = get("--out");
  if (!["single", "concurrent", "interrupt"].includes(phase) || !out) {
    console.error("用法：--phase single|concurrent|interrupt --out <样本输出目录>");
    process.exit(2);
  }
  return { phase, out: resolve(out) };
}

// 只读账本查询：原始行（不做 status='completed' 过滤——中断/在途行的形态正是探针对象）。
// 返回 { rows, queryMs }；null = sqlite3 缺席/查询失败（如实降级，不假零）。
function billRows(sinceMs) {
  const db = billingDbPath();
  const sql =
    "SELECT rowid, session_id, model_id, started_at, status, input_tokens, " +
    "cache_read_input_tokens, output_tokens FROM model_usage " +
    `WHERE started_at >= ${Number(sinceMs)} ORDER BY started_at`;
  const t0 = Date.now();
  const r = spawnSync("sqlite3", ["-readonly", "-json", db, sql], {
    shell: false,
    timeout: 10_000,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const queryMs = Date.now() - t0;
  if (r.error || r.status !== 0) return { rows: null, queryMs, error: String(r.stderr || r.error || "sqlite3 失败").slice(-200) };
  const out = String(r.stdout || "").trim();
  return { rows: out ? JSON.parse(out) : [], queryMs };
}

// 运行中轮询器：记录「运行开始后第 t 毫秒，账本出现了几行新数据 + 本次查询本身耗时」。
function startPoller(sinceMs, series) {
  const timer = setInterval(() => {
    const { rows, queryMs } = billRows(sinceMs);
    series.push({ t: Date.now() - sinceMs, count: rows ? rows.length : null, queryMs });
  }, POLL_MS);
  return () => clearInterval(timer);
}

async function oneRun(label, cwd, timeoutMs, prompt) {
  const startedAt = Date.now();
  const series = [];
  const stop = startPoller(startedAt, series);
  const res = await spawnHeadless({ prompt, mode: "plan", timeoutMs, cwd });
  stop();
  const post = billRows(startedAt);
  return {
    label,
    cwd,
    startedAt,
    durationMs: res.durationMs,
    ok: res.ok,
    timedOut: res.timedOut,
    exitCode: res.exitCode,
    signal: res.signal,
    error: res.error ?? null,
    summaryUsage: res.usage ?? null,
    usageFieldNames: res.usage && typeof res.usage === "object" ? Object.keys(res.usage) : null,
    projection: res.projection ?? null,
    sessionId: res.sessionId ?? null,
    pollSeries: series,
    rowsAfter: post.rows,
    postQueryMs: post.queryMs,
  };
}

function authGate() {
  const a = detectHeadlessAuth();
  if (!a.ok) {
    console.error("认证门未过：无 oauth 凭据也无 env 注入（detectHeadlessAuth）——探针无法驱动真实引擎");
    process.exit(2);
  }
  return a;
}

async function main() {
  const { phase, out } = args();
  const auth = authGate();
  mkdirSync(out, { recursive: true });
  const samples = [];
  if (phase === "single") {
    for (const i of [1, 2]) {
      const cwd = join(out, `cwd-single-${i}`);
      mkdirSync(cwd, { recursive: true });
      samples.push(await oneRun(`single-${i}`, cwd, SINGLE_TIMEOUT_MS, CHEAP_PROMPT));
    }
  } else if (phase === "concurrent") {
    const cwdA = join(out, "cwd-conc-a");
    const cwdB = join(out, "cwd-conc-b");
    mkdirSync(cwdA, { recursive: true });
    mkdirSync(cwdB, { recursive: true });
    const [a, b] = await Promise.all([
      oneRun("conc-a", cwdA, SINGLE_TIMEOUT_MS, CHEAP_PROMPT),
      oneRun("conc-b", cwdB, SINGLE_TIMEOUT_MS, CHEAP_PROMPT),
    ]);
    samples.push(a, b);
  } else {
    const cwd = join(out, "cwd-interrupt");
    mkdirSync(cwd, { recursive: true });
    samples.push(await oneRun("interrupt", cwd, INTERRUPT_TIMEOUT_MS, SLOW_PROMPT));
  }
  const file = join(out, `sample-${phase}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify({ phase, auth: { oauth: auth.oauth, envAuth: auth.envAuth }, samples }, null, 2));
  const brief = samples.map((s) => ({
    label: s.label,
    ok: s.ok,
    timedOut: s.timedOut,
    durationMs: s.durationMs,
    usageFields: s.usageFieldNames,
    summaryUsage: s.summaryUsage,
    rowsAfterCount: Array.isArray(s.rowsAfter) ? s.rowsAfter.length : `ERR:${s.rowsAfter}`,
    rowStatuses: Array.isArray(s.rowsAfter) ? [...new Set(s.rowsAfter.map((r) => r.status))] : null,
    firstRowLagMs: Array.isArray(s.rowsAfter) && s.rowsAfter.length
      ? s.rowsAfter.map((r) => r.started_at - s.startedAt).reduce((a, b) => Math.min(a, b), Infinity)
      : null,
    pollPoints: s.pollSeries.length,
  }));
  console.log(JSON.stringify({ file, brief }, null, 2));
}

main().catch((e) => {
  console.error("探针失败：", e?.message ?? e);
  process.exit(1);
});
