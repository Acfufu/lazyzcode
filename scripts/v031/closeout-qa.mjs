#!/usr/bin/env node
// 0.3.1 收口 QA 夹具驱动器（goal v031-closeout；调用串在 N3/N5/N8 定稿，N11 在终树复用同一串）
//
// 用法：
//   node scripts/v031/closeout-qa.mjs --case budget --fixture <隔离根> --out <证据根>
//     [--cli <被测 CLI 路径>] [--wall-ms N] [--max-segments N] [--keep]
//
// 契约（docs/plan-v031-closeout.md §QA 操作配方）：
//   - 所有注入只落独立夹具：夹具根=宿主仓或与其互相包含 ⇒ 拒跑（退出非 0）；
//   - 缺凭据/缺真实运行能力（引擎缺席 / headless 凭据缺席 / 水位读数缺席）⇒ 报阻塞、不计通过；
//   - 产物：result.json（passed、逐断言、版本与候选身份）+ 原始 stdout/stderr + 相关账本 sha256。
//
// 红绿同源：红绿差异只来自被驱动代码的现状（预改动树 vs 改后树），或 `--cli` 指向的改前 CLI；
// 本脚本自身不做「期望之外的推断」——只驱动真实 CLI、采集原文、按断言表判读。
//
// 已知边界（如实申报）：
//   1. HOME 不覆写——headless 凭据（~/.zcode/v2/credentials.json）与宿主计费库都在真实 HOME 下，
//      故本脚本的隔离面=夹具根 + 夹具内 .lazyzcode（不是 HOME 隔离）。
//   2. 夹具内批准记录由真实钩子（plugin/hooks/trigger.js）消费合成 stdin 的批准句写入——
//      非真人会话触发，属测试先例（test/contract-gate.contract.test.js:65-70），证据里如实记录。
//   3. 夹具段的真实会话由真引擎 headless 驱动，模型消耗计入宿主计费库（这正是本案例的被测面）。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { findEngine } from "../../core/paths.js";
import { rollingWaterlinePoints, WATERLINE_POINTS } from "../../core/cost.js";
import { detectHeadlessAuth } from "../../core/headless.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

// ── 参数解析（零依赖家法）──────────────────────────────────────────────────
function parseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith("--")) {
      f[key] = next;
      i += 1;
    } else {
      f[key] = true;
    }
  }
  return f;
}

const f = parseArgs(process.argv.slice(2));
const CASE = typeof f.case === "string" ? f.case : null;
const FIXTURE_ARG = typeof f.fixture === "string" ? f.fixture : null;
const OUT_ARG = typeof f.out === "string" ? f.out : null;
const CLI = resolve(typeof f.cli === "string" ? f.cli : join(REPO, "cli", "lzy.js"));
const WALL_MS = f["wall-ms"] != null ? Number.parseInt(f["wall-ms"], 10) : 180_000;
const MAX_SEGMENTS = f["max-segments"] != null ? Number.parseInt(f["max-segments"], 10) : 2;
const KEEP = f.keep === true;

function die(msg, code = 2) {
  console.error(`[closeout-qa] ${msg}`);
  process.exit(code);
}

if (!CASE) die("缺 --case（budget|receipt-binding|delivery-completion）");
if (!FIXTURE_ARG) die("缺 --fixture <隔离根>（夹具根，宿主仓身份不符即拒跑）");
if (!OUT_ARG) die("缺 --out <证据根>");
if (!existsSync(CLI)) die(`被测 CLI 不存在：${CLI}`);

// ── 夹具根身份门（拒跑面）──────────────────────────────────────────────────
const fixtureRoot = resolve(FIXTURE_ARG);
mkdirSync(fixtureRoot, { recursive: true });
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
const hostReal = real(REPO);
const fixReal = real(fixtureRoot);
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
if (inside(fixReal, hostReal) || inside(hostReal, fixReal)) {
  die(`夹具根与宿主仓互相包含，拒跑：fixture=${fixReal} host=${hostReal}`);
}

const outDir = resolve(OUT_ARG);
mkdirSync(outDir, { recursive: true });

// ── 工具 ───────────────────────────────────────────────────────────────────
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const sha256text = (s) => createHash("sha256").update(s).digest("hex");
const nowIso = () => new Date().toISOString();
const readJsonMaybe = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

function run(cmd, args, { cwd, env = {}, timeoutMs = 600_000, input = null } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: timeoutMs,
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: r.status,
    signal: r.signal ?? null,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    error: r.error ? String(r.error.message) : null,
  };
}

const cli = (args, opts = {}) => run(process.execPath, [CLI, ...args], opts);

function cliVersion() {
  const r = cli(["--version"], { cwd: REPO });
  return (r.stdout + r.stderr).trim().split("\n").pop() ?? "";
}

function hostIdentity() {
  const r = run("git", ["rev-parse", "HEAD"], { cwd: REPO });
  const t = run("git", ["show", "-s", "--format=%T", "HEAD"], { cwd: REPO });
  const st = run("git", ["status", "--porcelain"], { cwd: REPO });
  return {
    cliPath: CLI,
    cliVersion: cliVersion(),
    headCommit: (r.stdout ?? "").trim(),
    headTree: (t.stdout ?? "").trim(),
    dirty: ((st.stdout ?? "").trim() !== ""),
  };
}

function gitInitFixture(dir, files) {
  mkdirSync(dir, { recursive: true });
  const g = (args) => {
    const r = run("git", args, { cwd: dir });
    if (r.code !== 0) throw new Error(`git ${args.join(" ")} 失败：${r.stderr || r.stdout}`);
    return r;
  };
  g(["init", "-q", "."]);
  g(["config", "user.email", "qa@local"]);
  g(["config", "user.name", "qa"]);
  g(["config", "commit.gpgsign", "false"]);
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  g(["add", "-A"]);
  g(["commit", "-qm", "qa fixture floor"]);
}

// 夹具内批准：真实钩子消费合成 stdin 批准句（先例 test/contract-gate.contract.test.js:65-70）
function hookApprove(fixtureDir, phrase, sessionId = "qa-probe") {
  const hook = join(REPO, "plugin", "hooks", "trigger.js");
  const stdin = JSON.stringify({ prompt: phrase, cwd: fixtureDir, session_id: sessionId });
  return run(process.execPath, [hook], { cwd: fixtureDir, input: stdin, timeoutMs: 60_000 });
}

// ── 阻塞面判定（缺能力 ⇒ 报阻塞、不计通过）────────────────────────────────
function capabilityCheck() {
  const engine = findEngine();
  const auth = detectHeadlessAuth();
  const wl = rollingWaterlinePoints();
  const problems = [];
  if (!engine) problems.push("引擎缺席（findEngine 未命中；装 ZCode 桌面端或设 LZY_ZCODE_ENGINE）");
  if (!auth.ok) problems.push("headless 凭据缺席（~/.zcode/v2/credentials.json 且无 ZCODE_*_PROVIDER_CONFIG_FILE）");
  return {
    engine: engine ?? null,
    auth,
    waterline: wl,
    waterlineThreshold: Number(process.env.LZY_WATERLINE_POINTS) || WATERLINE_POINTS,
    problems,
  };
}

// ── case: budget（F1 终验面）───────────────────────────────────────────────
// 断言表：
//   P0 前提：水位读数在场且 ≥ capA（校准不等式可成立：本任务自身用量 ≪ capA < 账号水位）
//   A1 至少一段真实会话跑过（sessionId 非「—」）
//   A2 收束因不含账号水位族词（滚动水位/账号）——被别的会话消耗误伤即红
//   A3 tierA（cap=高、本任务未越线）不得因积分收束；合法收束因 ∈ {done, 段数尽, 无推进, 墙钟, 交付/门拒}
//   B1 tierB（cap=1）至少一段跑过
//   B2 tierB 收束因须来自本任务归因口径（含「本任务」或「超顶」）且不含账号水位族词
const ACCOUNT_WATERLINE_RE = /滚动水位|账号/;

function parseDriveOut(stdout) {
  const segments = [];
  let countdown = null;
  let riskNote = null;
  let done = false;
  for (const line of stdout.split(/\r?\n/)) {
    const seg = line.match(/^\[drive\] 段 (\d+)\/(\d+) sessionId=(\S+) 耗时=(\S+)ms 退出=(\S+)$/);
    if (seg) {
      segments.push({ seg: Number(seg[1]), max: Number(seg[2]), sessionId: seg[3], durationMs: seg[4], exitCode: seg[5] });
      continue;
    }
    const wd = line.match(/^\[drive\] 收束：(.*?)(——.*)?$/);
    if (wd) {
      countdown = wd[1];
      continue;
    }
    const rn = line.match(/^\[drive\] 原因：(.*)$/);
    if (rn) {
      riskNote = rn[1];
      continue;
    }
    if (/^\[drive\] ✔ goal done/.test(line)) done = true;
  }
  return { segments, countdown, riskNote, done };
}

function budgetCase() {
  const cap = capabilityCheck();
  if (cap.problems.length > 0) {
    return { blocked: cap.problems.join("；"), cap };
  }
  const wl = cap.waterline;
  // 校准不等式（夹具前提断言）：本任务自身用量 ≪ capA < 账号水位
  const capA = Math.max(50, Math.floor(wl * 0.6));
  const capB = 1;
  const premise = {
    waterlinePoints: wl,
    waterlineThreshold: cap.waterlineThreshold,
    capA,
    capB,
    inequality: `capB(${capB}) < capA(${capA}) ≤ 账号水位(${wl})`,
    ok: wl != null && wl >= capA && capA >= 50,
  };

  const runRoot = join(fixtureRoot, `budget-${Date.now()}`);
  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(runRoot, { recursive: true });
  const slug = "qa-budget";
  const planRel = `.lazyzcode/plans/${slug}.md`;
  const planBody = [
    "# qa-budget 夹具计划",
    "",
    `- [N1] 在夹具内创建 qa-out-1.txt（一行任意内容）并 git add+commit，然后 node ${CLI} step done N1 --note "qa 夹具 N1 落盘"`,
    `- [N2] 在夹具内创建 qa-out-2.txt（一行任意内容）并 git add+commit，然后 node ${CLI} step done N2 --note "qa 夹具 N2 落盘"`,
    `- [N3] 在夹具内创建 qa-out-3.txt（一行任意内容）并 git add+commit，然后 node ${CLI} step done N3 --note "qa 夹具 N3 落盘"`,
    `- [F1] 核 qa-out-1.txt/qa-out-2.txt/qa-out-3.txt 均在场且非空，然后 node ${CLI} step done F1 --evidence "qa-out-*.txt 在场且非空"`,
    "",
  ].join("\n");

  gitInitFixture(runRoot, {
    "lzy.project.json": '{"schemaVersion":1,"capabilities":{"check":[{"id":"smoke","argv":["node","-e","process.exit(0)"],"timeoutMs":30000}]}}\n',
    [planRel]: planBody,
  });

  const steps = [];
  const reg = cli(["loop", "register", slug, "--title", "预算归因夹具（closeout-qa）"], { cwd: runRoot });
  steps.push({ step: "register", ...reg });
  // 计划采纳：首跑拒（人权门）→ 真实钩子批准 → 重跑
  const adopt1 = cli(["loop", "plan", planRel], { cwd: runRoot });
  steps.push({ step: "plan#1", ...adopt1 });
  const short = (adopt1.stdout + adopt1.stderr).match(/批准 ([0-9a-f]{8})/)?.[1] ?? null;
  if (!short) return { blocked: "计划人头权门未给出批准短码——夹具流水异常", cap, premise, steps };
  const hook = hookApprove(runRoot, `批准 ${short}`);
  steps.push({ step: "hook-approve", ...hook });
  const adopt2 = cli(["loop", "plan", planRel], { cwd: runRoot });
  steps.push({ step: "plan#2", ...adopt2 });
  if (adopt2.code !== 0) return { blocked: `夹具计划采纳失败：${adopt2.stdout}${adopt2.stderr}`, cap, premise, steps };
  const start = cli(["loop", "start"], { cwd: runRoot });
  steps.push({ step: "start", ...start });

  const runs = [];
  for (const [tier, tierCap, segs, wall] of [
    ["A", capA, MAX_SEGMENTS, WALL_MS],
    ["B", capB, MAX_SEGMENTS, WALL_MS],
  ]) {
    const r = cli(["loop", "drive", "--wall-ms", String(wall), "--max-segments", String(segs)], {
      cwd: runRoot,
      env: { LZY_DRIVE_POINTS_BUDGET: String(tierCap) },
      timeoutMs: wall + 120_000,
    });
    const parsed = parseDriveOut(r.stdout);
    const outName = `budget-tier${tier}.stdout.txt`;
    writeFileSync(join(outDir, outName), r.stdout);
    if (r.stderr) writeFileSync(join(outDir, `budget-tier${tier}.stderr.txt`), r.stderr);
    const runtime = readJsonMaybe(join(runRoot, ".lazyzcode", "loop", "runtime.json"));
    const goal = readJsonMaybe(join(runRoot, ".lazyzcode", "loop", "goal.json"));
    runs.push({
      tier,
      cap: tierCap,
      exit: r.code,
      error: r.error,
      outFile: outName,
      outSha256: sha256text(r.stdout),
      ...parsed,
      runtimeBudget: runtime?.budget ?? null,
      goalStatus: goal?.status ?? null,
    });
  }

  const [A, B] = runs;
  const assertions = [
    {
      id: "P0",
      ok: premise.ok,
      expected: "水位读数在场且 capA ≤ 水位（校准不等式可成立）",
      observed: premise.inequality,
      evidence: "core/cost.js rollingWaterlinePoints()",
    },
    {
      id: "A1",
      ok: A.segments.length >= 1 && A.segments.every((s) => s.sessionId !== "—"),
      expected: "tierA 至少一段真实会话（sessionId 非「—」）",
      observed: `段数=${A.segments.length} sessionIds=${A.segments.map((s) => s.sessionId).join(",")}`,
      evidence: `artifacts/.../${A.outFile}`,
    },
    {
      id: "A2",
      ok: !ACCOUNT_WATERLINE_RE.test(String(A.countdown ?? "")),
      expected: "tierA 收束因不含账号水位族词（滚动水位/账号）",
      observed: `收束因=${A.countdown ?? "（无）"}`,
      evidence: `artifacts/.../${A.outFile}`,
    },
    {
      id: "A3",
      ok: A.done || !/积分|预算/.test(String(A.countdown ?? "")),
      expected: "tierA（cap 高于本任务用量）不因积分收束：done 或非积分因",
      observed: `done=${A.done} 收束因=${A.countdown ?? "（无）"}`,
      evidence: `artifacts/.../${A.outFile}`,
    },
    {
      id: "B1",
      ok: B.segments.length >= 1 && B.segments.every((s) => s.sessionId !== "—"),
      expected: "tierB 至少一段真实会话（sessionId 非「—」）",
      observed: `段数=${B.segments.length} sessionIds=${B.segments.map((s) => s.sessionId).join(",")}`,
      evidence: `artifacts/.../${B.outFile}`,
    },
    {
      id: "B2",
      ok: !ACCOUNT_WATERLINE_RE.test(String(B.countdown ?? "")) && /本任务|超顶/.test(String(B.countdown ?? "")),
      expected: "tierB（cap=1）收束因来自本任务归因口径（含「本任务」或「超顶」）且不含账号水位族词",
      observed: `收束因=${B.countdown ?? "（无）"}`,
      evidence: `artifacts/.../${B.outFile}`,
    },
  ];
  return { blocked: null, cap, premise, steps, runs, assertions };
}

// ── case 分派 ──────────────────────────────────────────────────────────────
const started = nowIso();
let result;
if (CASE === "budget") {
  result = budgetCase();
} else if (CASE === "receipt-binding" || CASE === "delivery-completion") {
  result = { blocked: `case ${CASE} 尚未接线（N5/N8 落地后启用）——按契约报阻塞、不计通过`, cap: null };
} else {
  die(`未知 --case：${CASE}（budget|receipt-binding|delivery-completion）`);
}

const ledgerHashes = {};
for (const rel of [
  ".lazyzcode/budget/ledger.json",
  ".lazyzcode/queue/queue.json",
  ".lazyzcode/queue/dispatch.json",
  ".lazyzcode/loop/runtime.json",
]) {
  const p = join(fixtureRoot, rel);
  if (existsSync(p)) ledgerHashes[rel] = sha256(p);
}

const assertions = result.assertions ?? [];
const passed = result.blocked == null && assertions.length > 0 && assertions.every((a) => a.ok);
const resultJson = {
  schemaVersion: 1,
  case: CASE,
  passed,
  blocked: result.blocked ?? null,
  generatedAt: started,
  host: hostIdentity(),
  fixtureRoot,
  cli: CLI,
  waterline: result.cap
    ? { points: result.cap.waterline, threshold: result.cap.waterlineThreshold, engine: result.cap.engine }
    : null,
  premise: result.premise ?? null,
  steps: (result.steps ?? []).map((s) => ({ step: s.step, code: s.code, stdout: s.stdout, stderr: s.stderr })),
  runs: result.runs ?? [],
  assertions,
  ledgerHashes,
};
writeFileSync(join(outDir, "result.json"), `${JSON.stringify(resultJson, null, 2)}\n`);

console.log(`[closeout-qa] case=${CASE} passed=${passed}${result.blocked ? ` BLOCKED: ${result.blocked}` : ""}`);
for (const a of assertions) console.log(`  ${a.ok ? "✔" : "✖"} ${a.id} ${a.expected}｜observed: ${a.observed}`);
console.log(`  result.json → ${join(outDir, "result.json")}`);
if (result.blocked != null) process.exit(3);
process.exit(passed ? 0 : 1);
