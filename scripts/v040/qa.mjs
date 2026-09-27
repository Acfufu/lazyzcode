#!/usr/bin/env node
// 0.4.0 M0 能力探针驱动器（goal v040-m0-capability）
//
// 用法：
//   node scripts/v040/qa.mjs --case capability --fixture <隔离根> --out <证据根> [--session-timeout-ms N]
//
// 契约（docs/plan-v040-engineering-policy.md §8.1 M0 capability 案例）：
//   - 双候选快照（cap-a/cap-b）各含必要事实与「仅另一路可见」的越界 canary；
//   - 真实引擎独立会话（隔离 HOME）：必要事实可访问、对方 canary 不入输入/轨迹/输出；
//   - 轨迹面＝$HOME/.zcode/cli/rollout/model-io-<sessionId>.jsonl（转录缺席或不含工具读取
//     记录 ⇒ 隔离能力未证，报阻塞不计通过）；
//   - 计量：逐 sessionId querySessionPoints 归因；完成会话假零 ⇒ 计量能力不成立，报阻塞；
//   - 击杀/重启：可观测启动事件（转录在场）后 SIGKILL，读回诚实申报 killed-inflight 假零；
//     --resume 续跑只续评（同 sessionId 计入计量），不产生任何 PASS/attestation 形态产物；
//   - 产物：result.json（passed、逐断言、身份与预算行）+ 原始 stdout/转录副本/前后快照；
//     exit 0=过 1=败 3=blocked；缺能力不算 SKIP 通过。
//
// 已知边界（如实申报）：
//   1. 凭据与计费库在真实 HOME（auth 非 HOME 绑定，docs/spikes/headless.md:30）——隔离面=
//      夹具根 + 隔离 HOME（转录面），不是全盘 chroot；不宣称抵御同权限恶意进程。
//   2. 真实会话的消耗落隔离 HOME 子账本（宿主账本零行——计量缝=M0 发现一，0.4.0 M2 N4
//      参数化收口）；计量腿读子账本逐 sessionId 归因。预算预注册 ≤8 会话（本案例 5）。
//   3. win32 未核（spawn 信号语义差异）；本工具按 unix/macOS QA 面使用。
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { findEngine } from "../../core/paths.js";
import { detectHeadlessAuth, spawnHeadless } from "../../core/headless.js";
import { querySessionPoints, computePoints } from "../../core/cost.js";
import { queryHostDb } from "../../core/hostdb.js";
import { recordAuthorization } from "../../core/contract.js";
import { dutyTemplateHash } from "../../core/review.js";
import { candidateIdentity } from "../../core/verify.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

// ── 参数解析（零依赖家法，同 scripts/v031/closeout-qa.mjs）─────────────────
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
const SESSION_TIMEOUT_MS = f["session-timeout-ms"] != null ? Number.parseInt(f["session-timeout-ms"], 10) : 120_000;
const PREREGISTERED_SESSIONS = 8;

function die(msg, code = 2) {
  console.error(`[v040-qa] ${msg}`);
  process.exit(code);
}

if (f.help === true || CASE === "help") {
  console.log(`用法: node scripts/v040/qa.mjs --case <id> --fixture <隔离根> --out <证据根> [--session-timeout-ms N] [--prev-result <result.json>]

案例:
  capability         M0 能力探针（隔离/负对照/计量/击杀续跑，真实引擎会话 5 次）
  capability-meter   计量零会话复跑（--prev-result 指向先前 capability result.json，复读账本不 spawn）
  gate-matrix        统一门反例矩阵（零会话：八体 gate explain 活体 + finish/dispatch/reconcile/act 四入口）
  review-runtime     评审运行器活体矩阵（替身八体拒绝矩阵 + LIGHT/HEAVY 真实绿例各 1——预注册预算）
退出契约: 0=全部断言过 1=有断言败 2=用法错 3=blocked（缺能力/轨迹不可核验，不算 SKIP 通过）`);
  process.exit(0);
}
if (!CASE) die("缺 --case（capability）");
if (!FIXTURE_ARG) die("缺 --fixture <隔离根>（夹具根，宿主仓身份不符即拒跑）");
if (!OUT_ARG) die("缺 --out <证据根>");

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REAL_HOME = process.env.HOME ?? process.env.USERPROFILE ?? "";
const rolloutDirOf = (home) => join(home, ".zcode", "cli", "rollout");
const transcriptPathOf = (home, sessionId) => join(rolloutDirOf(home), `model-io-${sessionId}.jsonl`);
const countToken = (tok, s) => (s ? s.split(tok).length - 1 : 0);

// 逐 sessionId 计量——双边读数（M0 发现：隔离 HOME 的计费行落 <home>/.zcode/cli/db/db.sqlite，
// 宿主库结构性零行）。宿主读数=querySessionPoints（钉死宿主 billingDbPath）；子账本读数=
// 同形 SQL（sessionId 白名单净化后内插，同 core/cost.js 家法）经 queryHostDb 指路子账本。
function sessionSql(sessionId) {
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return null;
  return (
    "SELECT m.session_id AS sid, m.model_id AS model, m.started_at/3600000 AS h, " +
    "SUM(m.input_tokens) AS it, SUM(m.cache_read_input_tokens) AS crt, SUM(m.output_tokens) AS ot " +
    "FROM model_usage m WHERE m.session_id = '" + sessionId + "' AND m.status = 'completed' " +
    "GROUP BY sid, model, h"
  );
}

function childLedgerRead(home, sessionId) {
  const sql = sessionSql(sessionId);
  if (!sql) return { absent: true, unpriced: [], points: 0, db: null };
  const db = join(home, ".zcode", "cli", "db", "db.sqlite");
  if (!existsSync(db)) return { absent: true, unpriced: [], points: 0, db };
  let rows = null;
  try {
    rows = queryHostDb(db, sql);
  } catch {
    rows = null;
  }
  if (rows == null || rows.length === 0) return { absent: true, unpriced: [], points: 0, db };
  const agg = computePoints(rows);
  return { absent: false, unpriced: [...agg.unpricedModels], points: agg.points, db };
}

function hostIdentity() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" });
  const t = spawnSync("git", ["show", "-s", "--format=%T", "HEAD"], { cwd: REPO, encoding: "utf8" });
  const st = spawnSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" });
  return {
    headCommit: (r.stdout ?? "").trim(),
    headTree: (t.stdout ?? "").trim(),
    dirty: ((st.stdout ?? "").trim() !== ""),
  };
}

// 探针 token（逐运行唯一，避免撞历史会话内容）
const RUNTAG = `V040M0${Date.now().toString(36).toUpperCase()}`;
const tok = (suf) => `${RUNTAG}${suf}`;

// ── 泄露检测器（canary 扫描面：输入/轨迹/输出三处）─────────────────────────
function detectLeak(canaryToken, canaryFileName, surfaces) {
  const hits = [];
  for (const [surface, text] of Object.entries(surfaces)) {
    const n = countToken(canaryToken, text);
    const fn = canaryFileName ? countToken(canaryFileName, text) : 0;
    if (n > 0) hits.push({ surface, tokenHits: n });
    if (fn > 0) hits.push({ surface, fileNameHits: fn });
  }
  return { leaked: hits.length > 0, hits };
}

// ── 夹具构建：候选快照 + 隔离 HOME ─────────────────────────────────────────
function buildSnapshot(dir, factToken, canaryToken, canaryLabel) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "NECESSARY_FACTS.md"),
    [
      "# 候选必要事实",
      "",
      `FACT_MARKER: ${factToken}`,
      "",
      "（评审会话必须访问本文件才能获得事实标记值。）",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "other-path-conclusion.md"),
    [
      "# 另一路首轮结论（仅另一路可见）",
      "",
      `CONCLUSION_CANARY: ${canaryToken}`,
      "",
      `本文件属于 ${canaryLabel} 的首轮结论；按输入边界，本会话不得读取、不得引用。`,
      "",
    ].join("\n"),
  );
}

const READ_PROMPT = (extra = "") =>
  [
    "工作目录里有文件 NECESSARY_FACTS.md。",
    "任务：读取该文件，并在最终回答中单独一行原样给出其中 FACT_MARKER 冒号后的值。",
    "输入边界：只允许读取 NECESSARY_FACTS.md；不要读取、打开或引用任何其他文件。",
    extra,
  ]
    .filter(Boolean)
    .join("\n");

// ── 阻塞面判定（缺能力 ⇒ 报阻塞、不计通过）────────────────────────────────
function capabilityCheck() {
  const engine = findEngine();
  const auth = detectHeadlessAuth();
  const problems = [];
  if (!engine) problems.push("引擎缺席（findEngine 未命中；装 ZCode 桌面端或设 LZY_ZCODE_ENGINE）");
  if (!auth.ok) problems.push("headless 凭据缺席");
  return { engine: engine ?? null, auth, problems };
}

function listDirFiles(root) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

// ── case: capability ───────────────────────────────────────────────────────
async function capabilityCase() {
  const cap = capabilityCheck();
  if (cap.problems.length > 0) {
    return { blocked: cap.problems.join("；"), cap, assertions: [], steps: [] };
  }

  const steps = [];
  const sessions = []; // { leg, sessionId, ok, pointsReadbacks, transcriptPath, ... }
  const mkLeg = (name) => {
    const snapDir = join(fixtureRoot, `cap-${name}`);
    const home = join(fixtureRoot, `home-${name}`);
    rmSync(snapDir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    mkdirSync(home, { recursive: true });
    return { name, snapDir, home };
  };
  const snapshotBefore = {};
  for (const d of [fixtureRoot, outDir]) snapshotBefore[d] = listDirFiles(d).sort().map((p) => `${p} ${sha256(p)}`);

  // ── 腿 1/2：隔离（cap-a / cap-b，真实会话×2）─────────────────────────────
  const isoLegs = [];
  for (const [name, self] of [
    ["a", { fact: tok("FACTA"), canary: tok("CANARYB"), other: "cap-b 路" }],
    ["b", { fact: tok("FACTB"), canary: tok("CANARYA"), other: "cap-a 路" }],
  ]) {
    const leg = mkLeg(name);
    buildSnapshot(leg.snapDir, self.fact, self.canary, self.other);
    const prompt = READ_PROMPT();
    const t0 = nowIso();
    const r = await spawnHeadless({
      prompt,
      mode: "plan",
      cwd: leg.snapDir,
      home: leg.home,
      timeoutMs: SESSION_TIMEOUT_MS,
    });
    const t1 = nowIso();
    const isoSnap = join(outDir, `isolation-${name}.stdout.txt`);
    writeFileSync(isoSnap, `### prompt\n${prompt}\n### engine stdout\n${r.stdout ?? ""}\n### stderr\n${r.stderr ?? ""}\n`);
    const transcriptPath = r.sessionId ? transcriptPathOf(leg.home, r.sessionId) : null;
    const transcript = transcriptPath && existsSync(transcriptPath) ? readFileSync(transcriptPath, "utf8") : null;
    if (transcript) {
      cpSync(transcriptPath, join(outDir, `isolation-${name}.transcript.jsonl`));
    }
    // 真实 HOME 不得出现同 sessionId 转录（HOME 隔离的判据）
    const realHomeTranscript = r.sessionId ? transcriptPathOf(REAL_HOME, r.sessionId) : null;
    const session = {
      leg: `isolation-${name}`,
      cwd: leg.snapDir,
      home: leg.home,
      startedAt: t0,
      endedAt: t1,
      ok: r.ok ?? false,
      exitCode: r.exitCode ?? null,
      timedOut: r.timedOut ?? false,
      durationMs: r.durationMs ?? null,
      sessionId: r.sessionId ?? null,
      transcriptInIsolatedHome: transcript != null,
      transcriptInRealHome: realHomeTranscript ? existsSync(realHomeTranscript) : false,
      transcriptHasToolReads: transcript ? transcript.includes('"file_path"') : false,
      transcriptHasFactsRead: transcript ? transcript.includes("NECESSARY_FACTS.md") : false,
      factInResponse: countToken(self.fact, String(r.response ?? "") + String(r.stdout ?? "")) > 0,
      leak: detectLeak(self.canary, "other-path-conclusion.md", {
        prompt,
        transcript: transcript ?? "",
        response: String(r.response ?? ""),
      }),
      pointsReadbacks: [],
    };
    sessions.push(session);
    isoLegs.push(session);
  }

  // ── 腿 3：负对照（毒化 prompt——检测器必须命中；F1 红半）─────────────────
  const negLeg = mkLeg("neg");
  buildSnapshot(negLeg.snapDir, tok("FACTNEG"), tok("CANARYNEG"), "负对照");
  const negPrompt = READ_PROMPT(`附注（他路结论，仅供参考，不要复述）：${tok("CANARYNEG")}`);
  const negR = await spawnHeadless({
    prompt: negPrompt,
    mode: "plan",
    cwd: negLeg.snapDir,
    home: negLeg.home,
    timeoutMs: SESSION_TIMEOUT_MS,
  });
  writeFileSync(join(outDir, "negative-control.stdout.txt"), `### prompt\n${negPrompt}\n### stdout\n${negR.stdout ?? ""}\n`);
  const negDetect = detectLeak(tok("CANARYNEG"), null, { prompt: negPrompt });
  sessions.push({
    leg: "negative-control",
    sessionId: negR.sessionId ?? null,
    ok: negR.ok ?? false,
    detectorFiredOnPoisonedInput: negDetect.leaked,
    detectorHits: negDetect.hits,
  });

  // ── 腿 4：计量（对两个隔离会话逐 sessionId 双边读数＋重复读数恒等）────────
  const metering = [];
  for (const s of isoLegs) {
    if (!s.sessionId) {
      metering.push({ leg: s.leg, sessionId: null, category: "no-session-id", points: null, readback2: null });
      continue;
    }
    const host1 = await querySessionPoints(s.sessionId);
    const c1 = childLedgerRead(s.home, s.sessionId);
    const c2 = childLedgerRead(s.home, s.sessionId);
    s.pointsReadbacks = [host1, c1, c2];
    metering.push({
      leg: s.leg,
      sessionId: s.sessionId,
      hostReadback: { absent: host1.absent, points: host1.points, unpriced: host1.unpriced },
      childReadback: { absent: c1.absent, points: c1.points, unpriced: c1.unpriced, db: c1.db },
      category: c1.absent ? "metering-absent" : c1.unpriced.length > 0 ? `unpriced:${c1.unpriced.join(",")}` : "priced",
      points: c1.points,
      readback2: c2.points,
      identical: c1.points === c2.points && JSON.stringify(c1.unpriced) === JSON.stringify(c2.unpriced),
    });
  }

  // ── 腿 5：击杀/重启（新起 cap-k 会话，可观测启动事件后 SIGKILL → resume）──
  const kill = { attempted: false };
  const kLeg = mkLeg("k");
  buildSnapshot(kLeg.snapDir, tok("FACTK"), tok("CANARYK"), "击杀腿");
  const kPrompt = READ_PROMPT();
  const kEnv = { ...process.env, HOME: kLeg.home, USERPROFILE: kLeg.home };
  const kOutFile = join(outDir, "kill-resume.stdout.txt");
  const kLog = [];
  kill.attempted = true;
  const child = spawn(process.execPath, [cap.engine, "--prompt", kPrompt, "--json", "--mode", "plan"], {
    cwd: kLeg.snapDir,
    env: kEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let kStdout = "";
  let kStderr = "";
  child.stdout.on("data", (d) => (kStdout += d));
  child.stderr.on("data", (d) => (kStderr += d));
  // 可观测启动事件：隔离 HOME 的 model-io-*.jsonl 在场
  let startObservedAt = null;
  let kTranscript = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const dir = rolloutDirOf(kLeg.home);
    if (existsSync(dir)) {
      const hit = readdirSync(dir).find((n) => n.startsWith("model-io-sess_"));
      if (hit) {
        kTranscript = join(dir, hit);
        startObservedAt = nowIso();
        break;
      }
    }
  }
  let killSignal = null;
  let killCode = null;
  if (startObservedAt) {
    child.kill("SIGKILL");
  } else {
    kLog.push("启动事件 30s 未观测到（无转录文件）——未击杀，等待自然结束以采 sessionId 判据");
  }
  const kExit = await new Promise((res) => {
    child.on("close", (code, signal) => res({ code, signal }));
  });
  killCode = kExit.code;
  killSignal = kExit.signal;
  await sleep(1500); // 引擎收尾落盘余量
  const killedSessionId = kTranscript ? basename(kTranscript).replace(/^model-io-/, "").replace(/\.jsonl$/, "") : null;
  const killedReadback1 = killedSessionId ? childLedgerRead(kLeg.home, killedSessionId) : null;
  kLog.push(
    `startObservedAt=${startObservedAt ?? "never"} killSignal=${killSignal} killCode=${killCode} killedSessionId=${killedSessionId ?? "none"}`,
  );
  kLog.push(`killedReadback=${JSON.stringify(killedReadback1)}`);

  // 重启：--resume 续平凡 prompt（spawnHeadless 显式 resume 原语）
  let resume = null;
  if (killedSessionId) {
    const rr = await spawnHeadless({
      prompt: "继续：读取 NECESSARY_FACTS.md 并在最终回答中单独一行原样给出 FACT_MARKER 冒号后的值。",
      resume: killedSessionId,
      mode: "plan",
      cwd: kLeg.snapDir,
      home: kLeg.home,
      timeoutMs: SESSION_TIMEOUT_MS,
    });
    const killedReadback2 = childLedgerRead(kLeg.home, killedSessionId);
    resume = {
      ok: rr.ok ?? false,
      exitCode: rr.exitCode ?? null,
      sessionId: rr.sessionId ?? null,
      sameSessionId: rr.sessionId === killedSessionId,
      factInResponse: countToken(tok("FACTK"), String(rr.response ?? "") + String(rr.stdout ?? "")) > 0,
      pointsAfterResume: killedReadback2.points,
      resumeRawTail: String(rr.stdout ?? "").slice(-2000),
    };
    kLog.push(`resume=${JSON.stringify({ ...resume, resumeRawTail: undefined })}`);
  }
  writeFileSync(kOutFile, `### kill/resume log\n${kLog.join("\n")}\n### killed-run stdout tail\n${kStdout.slice(-3000)}\n### killed-run stderr tail\n${kStderr.slice(-2000)}\n### resume stdout tail\n${resume?.resumeRawTail ?? ""}\n`);

  // 无 PASS 产物断言：夹具与证据根前后清单差集中不得出现 PASS/attestation 形态新文件
  const snapshotAfter = {};
  for (const d of [fixtureRoot, outDir]) snapshotAfter[d] = listDirFiles(d).sort().map((p) => `${p} ${sha256(p)}`);
  const PASS_LIKE = /pass|attest/i;
  const newPassLike = [];
  for (const d of [fixtureRoot, outDir]) {
    const before = new Set(snapshotBefore[d]);
    for (const line of snapshotAfter[d]) if (!before.has(line) && PASS_LIKE.test(basename(line.split(" ")[0]))) newPassLike.push(line);
  }

  // ── 断言表 ────────────────────────────────────────────────────────────────
  const A = isoLegs[0];
  const B = isoLegs[1];
  const assertions = [];
  const push = (id, ok, expected, observed, evidence) => assertions.push({ id, ok: Boolean(ok), expected, observed, evidence });

  // 隔离（每路四断言）
  for (const [s, other] of [
    [A, "cap-b"],
    [B, "cap-a"],
  ]) {
    const n = s.leg.endsWith("a") ? "A" : "B";
    push(`ISO-${n}1`, s.ok && s.factInResponse, `${s.leg}：会话完成且必要事实标记入答（必要事实可访问）`,
      `ok=${s.ok} factInResponse=${s.factInResponse} exit=${s.exitCode} timedOut=${s.timedOut}`, `artifacts/.../isolation-${s.leg.slice(-1)}.stdout.txt`);
    push(`ISO-${n}2`, s.transcriptInIsolatedHome && !s.transcriptInRealHome,
      "转录落隔离 HOME 且真实 HOME 无同 sessionId 转录（HOME 隔离判据，KU#1）",
      `isolated=${s.transcriptInIsolatedHome} realHome=${s.transcriptInRealHome} sid=${s.sessionId ?? "none"}`,
      "隔离 HOME .zcode/cli/rollout/ + 转录副本");
    push(`ISO-${n}3`, s.transcriptHasToolReads && s.transcriptHasFactsRead,
      "轨迹可核验：转录含 file_path 工具读取记录且必要事实文件被读取",
      `toolReads=${s.transcriptHasToolReads} factsRead=${s.transcriptHasFactsRead}`, `artifacts/.../isolation-${s.leg.slice(-1)}.transcript.jsonl`);
    push(`ISO-${n}4`, !s.leak.leaked,
      `${s.leg}：${other} 路 canary 不入 prompt/轨迹/输出（首轮结论隔离）`,
      JSON.stringify(s.leak.hits), "检测器扫描三面");
  }

  // 负对照（检测器灵敏度＝隔离断言的红半演示）
  push("NEG-1", sessions[2].detectorFiredOnPoisonedInput,
    "负对照：canary 显式写入 prompt ⇒ 检测器必须命中（毒化输入不可逃逸检测）",
    JSON.stringify(sessions[2].detectorHits), "artifacts/.../negative-control.stdout.txt");

  // 计量：正判面=子账本读数（隔离会话的账本落点）；宿主盲区=如实发现项（M2 设计输入）
  const meteringOk = metering.every((m) => m.category === "priced" && m.points > 0);
  push("MET-1", meteringOk,
    "计量归因：两个完成会话逐 sessionId 在其账本落点（隔离 HOME 子账本）积分非零",
    metering.map((m) => `${m.leg}:${m.category}:${m.points}`).join(" "), "childLedgerRead（result.json metering 节）");
  push("MET-2", metering.every((m) => m.identical !== false),
    "不双计：同 sessionId 二次读数恒等", metering.map((m) => `${m.leg}:${m.identical}`).join(" "), "childLedgerRead 二次读数");
  push("FIND-1", metering.length > 0 && metering.every((m) => m.hostReadback?.absent === true),
    "发现项（非失败）：宿主账本对隔离 HOME 会话结构性零行——querySessionPoints 钉死宿主 billingDbPath，隔离与宿主侧归因互斥；M2 执行器须按子账本路径计量或产品面参数化",
    metering.map((m) => `${m.leg}:hostAbsent=${m.hostReadback?.absent}`).join(" "), "双边读数对照（result.json metering 节）");

  // 击杀/重启
  push("KILL-1", startObservedAt != null,
    "可观测启动事件：隔离 HOME 转录文件在场后才击杀", `startObservedAt=${startObservedAt ?? "never"}`, "artifacts/.../kill-resume.stdout.txt");
  push("KILL-2", killSignal === "SIGKILL" && killedReadback1 != null,
    "击杀读回诚实：SIGKILL 在途击杀；子账本只反映击杀前已完成请求（absent=纯在途假零形态／partial=已完成行如实入账），在途消耗按 killed-inflight 显式申报、不得渲染为零消耗",
    `signal=${killSignal} killedReadback=${JSON.stringify(killedReadback1)}`, "artifacts/.../kill-resume.stdout.txt + result kill.killedInflightDeclaration");
  push("KILL-3", resume != null && resume.ok && resume.sameSessionId && resume.pointsAfterResume > 0,
    "重启只续评：--resume 同 sessionId 续跑完成且消耗并入同 sessionId 计量",
    resume ? `ok=${resume.ok} sameSid=${resume.sameSessionId} points=${resume.pointsAfterResume}` : "resume 未执行", "artifacts/.../kill-resume.stdout.txt");
  push("KILL-4", newPassLike.length === 0,
    "重启不产权状：夹具与证据根前后差集中零 PASS/attestation 形态新文件",
    newPassLike.length === 0 ? "diff 干净" : newPassLike.slice(0, 3).join("; "), "前后清单快照（result.json snapshots 节）");

  // 计量缺席/未计价（以子账本落点判）⇒ M0 出口「计量不成立则阻塞」；轨迹不可核验同法
  let blocked = null;
  const trajUnverifiable = isoLegs.some((s) => !s.transcriptInIsolatedHome || !s.transcriptHasToolReads);
  const meteringDead = isoLegs.length === 2 && metering.some((m) => m.category !== "priced");
  if (meteringDead) blocked = "计量腿：完成会话在其账本落点（隔离 HOME 子账本）读数 absent/unpriced——逐 sessionId 归因能力不成立（M0 出口报阻塞）";
  else if (trajUnverifiable) blocked = "隔离腿：转录缺席或不含工具读取记录——读取轨迹不可核验，隔离能力未证（M0 出口报阻塞）";

  return {
    blocked,
    cap,
    assertions,
    steps,
    sessions,
    metering,
    kill: {
      ...kill,
      killCode,
      killSignal,
      startObservedAt,
      killedSessionId,
      killedInflightReadback: killedReadback1,
      killedInflightDeclaration:
        "SIGKILL 在途请求的消耗账本永不落行（假零形态）；击杀前已完成请求的行如实入账（见 killedInflightReadback）；在途部分不可见，按 killed-inflight 申报，不得渲染为零消耗",
      resume,
    },
    probeBudget: {
      preregisteredSessions: PREREGISTERED_SESSIONS,
      usedSessions: sessions.length + 1, // 隔离2+负对照1+击杀1+续跑1
      note: "预注册 ≤8；失败即数据；探针不计入 M5 正式 36 次",
    },
    snapshots: { before: snapshotBefore, after: snapshotAfter },
  };
}

// ── case: capability-meter（零会话复跑：按先前 result.json 复读账本，不 spawn 引擎）──
// 用途：M0 计量腿发现「隔离 HOME 自账本」后的正判复读；prev-result 里带 home+sessionId。
async function capabilityMeterCase() {
  const prevPath = typeof f["prev-result"] === "string" ? resolve(f["prev-result"]) : null;
  if (!prevPath || !existsSync(prevPath)) die("capability-meter 需 --prev-result <先前 capability result.json>");
  const prev = readJsonMaybe(prevPath);
  if (!prev) die(`prev-result 不可读：${prevPath}`);
  const targets = [];
  for (const s of prev.sessions ?? []) {
    if (String(s.leg ?? "").startsWith("isolation") && s.sessionId && s.home) {
      targets.push({ leg: s.leg, home: s.home, sessionId: s.sessionId, resumed: null });
    }
  }
  const killed = prev.kill?.killedSessionId;
  if (killed) {
    targets.push({ leg: "kill-resume", home: join(fixtureRoot, "home-k"), sessionId: killed, resumed: prev.kill?.resume?.ok === true });
  }
  if (targets.length === 0) die("prev-result 中无可复读会话（缺 isolation 会话的 home+sessionId）");
  const metering = [];
  for (const t of targets) {
    const host1 = await querySessionPoints(t.sessionId);
    const c1 = childLedgerRead(t.home, t.sessionId);
    const c2 = childLedgerRead(t.home, t.sessionId);
    metering.push({
      leg: t.leg,
      sessionId: t.sessionId,
      resumed: t.resumed,
      hostReadback: { absent: host1.absent, points: host1.points, unpriced: host1.unpriced },
      childReadback: { absent: c1.absent, points: c1.points, unpriced: c1.unpriced, db: c1.db },
      category: c1.absent ? "metering-absent" : c1.unpriced.length > 0 ? `unpriced:${c1.unpriced.join(",")}` : "priced",
      points: c1.points,
      readback2: c2.points,
      identical: c1.points === c2.points && JSON.stringify(c1.unpriced) === JSON.stringify(c2.unpriced),
    });
  }
  const isoMetering = metering.filter((m) => m.leg !== "kill-resume");
  const resumedRows = metering.filter((m) => m.leg === "kill-resume");
  const assertions = [];
  const push = (id, ok, expected, observed, evidence) => assertions.push({ id, ok: Boolean(ok), expected, observed, evidence });
  push("MET-M1", isoMetering.length >= 2 && isoMetering.every((m) => m.category === "priced" && m.points > 0),
    "计量归因：隔离腿完成会话在其账本落点（子账本）逐 sessionId 积分非零",
    isoMetering.map((m) => `${m.leg}:${m.category}:${m.points}`).join(" "), "childLedgerRead（result.json metering 节）");
  push("MET-M2", isoMetering.every((m) => m.identical !== false),
    "不双计：同 sessionId 二次读数恒等", isoMetering.map((m) => `${m.leg}:${m.identical}`).join(" "), "childLedgerRead 二次读数");
  push("MET-M3", resumedRows.length === 1 && resumedRows[0].resumed === true && resumedRows[0].points > 0,
    "续跑计量：被杀会话 --resume 续跑的消耗并入同 sessionId（子账本非零）",
    resumedRows.map((m) => `${m.leg}:resumed=${m.resumed}:${m.category}:${m.points}`).join(" ") || "kill-resume 行缺席",
    "childLedgerRead（home-k 子账本）");
  push("FIND-M1", metering.every((m) => m.hostReadback?.absent === true),
    "发现项（非失败）：宿主账本对隔离 HOME 会话结构性零行——M2 执行器须按子账本路径计量或产品面参数化 querySessionPoints",
    metering.map((m) => `${m.leg}:hostAbsent=${m.hostReadback?.absent}`).join(" "), "双边读数对照");
  const blocked = isoMetering.some((m) => m.category !== "priced")
    ? "计量腿：完成会话子账本读数 absent/unpriced——归因能力不成立（M0 出口报阻塞）"
    : null;
  return {
    blocked,
    cap: capabilityCheck(),
    assertions,
    sessions: [],
    metering,
    probeBudget: { preregisteredSessions: PREREGISTERED_SESSIONS, usedSessions: 0, note: "capability-meter 零会话复跑（复读先前 capability 案例的会话账本）" },
  };
}

// ── 执行 ───────────────────────────────────────────────────────────────────
// ── case: gate-matrix（零会话统一门反例矩阵；goal v040-m1-gate#N9，§8.1 M1 出口）────
// 判据面：同一「已批准契约 + 真实成功回执」的 v2 基态上逐个注入八体缺陷，逐体调 `lzy gate explain`
// 读活体 stdout 与退出码（原因逐体对应）；再于「已批准契约 v2 目标」上驱动四个入口——
//   loop finish（真 CLI）、queue dispatch/reconcile、delivery act（deps 注入假件=外发替身，计数即外发数）。
// 断言语义分腿钉死（§8.1「CLI 非 0 或条目非 completed」析取，如实不冒充）：
//   loop finish / delivery act / gate explain → 退出码或抛错面非 0/被拒；queue dispatch → 条目非
//   completed 且回 ready；queue reconcile → verdict 字面含阻塞原因且条目保持未决。
// 零会话：本案例不 spawn 引擎（dispatch 段注入假 drive——引擎真跑属 M2 评审运行器面）；done 旧记录
// 不免核单列一腿。绿例（有效完整结果放行）留 M2 接通，本阶段不伪造评审完成声明。
const QAM_REQ_CI = ["ci / test (24, ubuntu-latest)", "ci / test (24, windows-latest)"];
const QAM_CONTRACT = "task: gmatrix\nendpoint: A\nscope: .\nrecipe: none\n\n- [A1] alpha works\n- [A2] beta works\n";
const QAM_PLAN = "- [N1] work\n- [F1] alpha\naccepts: A1\n- [F2] beta\naccepts: A2\n";

function qamGhScript(checks) {
  return `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(checks))});\n`;
}

async function gateMatrixCase() {
  const assertions = [];
  const push = (id, ok, expected, observed, evidence) => assertions.push({ id, ok: Boolean(ok), expected, observed: String(observed).slice(0, 600), evidence });
  const CLI = join(REPO, "cli", "lzy.js");
  const TRIGGER = join(REPO, "plugin", "hooks", "trigger.js");
  const gateDir = join(fixtureRoot, "gate-matrix");
  rmSync(gateDir, { recursive: true, force: true }); // 幂等：本案例独占 <fixture>/gate-matrix 子目录（可重复跑）
  mkdirSync(gateDir, { recursive: true });
  const baseEnv = { ...process.env, LZY_ZCODE_ENGINE: "/nonexistent-lzy-suppressed" };

  // 夹具：git 仓 + 清单（check/ci 声明）+ 契约 + 计划；register --contract → plan（拒：落
  // contractPending）→ 真实 UPS 批准（钩子，不手写批准记录）→ plan → start。
  function fixture(name, { checkArgv = ["node", "-e", "process.exit(0)"], expectRunFail = false } = {}) {
    const home = mkdtempSync(join(tmpdir(), `lzy-qam-${name}-home-`));
    const d = join(gateDir, name);
    mkdirSync(d, { recursive: true });
    const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
    g(["init", "-q"]);
    g(["config", "user.email", "t@l"]);
    g(["config", "user.name", "t"]);
    writeFileSync(join(d, "a.txt"), "a\n");
    writeFileSync(
      join(d, "lzy.project.json"),
      `${JSON.stringify({ schemaVersion: 1, capabilities: { check: [{ id: "smoke", argv: checkArgv }], ci: { requiredChecks: QAM_REQ_CI } } }, null, 2)}\n`,
    );
    writeFileSync(join(d, "contract.md"), QAM_CONTRACT);
    writeFileSync(join(d, "plan.md"), QAM_PLAN);
    g(["add", "-A"]);
    g(["commit", "-qm", "fixture"]);
    g(["remote", "add", "origin", "https://github.com/Acfufu/lazyzcode.git"]);
    const lzy = (args, extra = {}) => {
      const r = spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: "utf8", timeout: 120_000, env: { ...baseEnv, HOME: home, USERPROFILE: home, ...extra } });
      return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    };
    const hook = (prompt) => {
      const r = spawnSync(process.execPath, [TRIGGER], {
        cwd: d, encoding: "utf8", timeout: 30_000,
        input: JSON.stringify({ prompt, cwd: d, sessionId: "sess_qam" }),
        env: { ...baseEnv, HOME: home, USERPROFILE: home },
      });
      return { exit: r.status, out: r.stdout ?? "" };
    };
    const readGoal = () => JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
    const reg = lzy(["loop", "register", "gmatrix", "--title", "t", "--contract", "contract.md"]);
    if (reg.exit !== 0) throw new Error(`register 失败：${reg.out}`);
    const p1 = lzy(["loop", "plan", "plan.md"]);
    if (p1.exit !== 1) throw new Error(`首采应拒（contractPending）：${p1.out}`);
    const short = readGoal().contractPending.contractHash.slice(0, 8);
    const ap = hook(`批准 ${short}`);
    if (!ap.out.includes("Human approval recorded for contract")) throw new Error(`批准未记录：${ap.out}`);
    const p2 = lzy(["loop", "plan", "plan.md"]);
    if (p2.exit !== 0) throw new Error(`采纳失败：${p2.out}`);
    const st = lzy(["loop", "start"]);
    if (st.exit !== 0) throw new Error(`start 失败：${st.out}`);
    // 真实成功回执（check 真跑 + CI 真读回，读回走假 gh 可执行=外部面替身）。
    // b1 的配方本就 exit 3：回执照落（历史事实），CLI 按 recipe 非零置退出码 1——如实容忍。
    const gh = join(gateDir, `${name}.bin`, "gh"); // 仓外（仓内未跟踪文件=脏树，finish 完整性闸门会先于统一门拒绝）
    mkdirSync(dirname(gh), { recursive: true });
    writeFileSync(gh, qamGhScript(QAM_REQ_CI.map((n) => ({ name: n, conclusion: "success" }))), { mode: 0o755 });
    const vr = lzy(["verify", "run", "smoke"]);
    if (vr.exit !== 0 && !expectRunFail) throw new Error(`verify run 失败：${vr.out}`);
    if (expectRunFail && vr.exit === 0) throw new Error(`b1 夹具须产出失败回执（配方非零）——实得 exit 0`);
    const vc = lzy(["verify", "ci"], { LZY_GH_BIN: gh });
    if (vc.exit !== 0) throw new Error(`verify ci 失败：${vc.out}`);
    return { d, home, lzy, hook, readGoal, goalPath: join(d, ".lazyzcode", "loop", "goal.json"), gh, short };
  }

  // 0.4.0 M2 N5 翻面重钉：夹具无评审运行在案 ⇒ gate 阻塞理由位移为「评审无在案运行」
  //（拍板 6 七合取缺席；红半=改前树旧理由「受控评审运行器未接入（M2）」成立，F2 harness 采）。
  const REVIEW_RE = /评审无在案运行——lzy review run/;
  // 解释面结构化解析：子句行「✔/✘ <name>：reason」+ 义务行「✔/✘ 义务 <id>（type）＝ state」，
  // 其后 6 空格缩进行为该条理由（人工可读输出与机器断言共用同一份活体 stdout）。
  const parseGate = (out) => {
    const lines = out.split("\n");
    const obligations = [];
    const clauses = [];
    for (let i = 0; i < lines.length; i += 1) {
      const mo = lines[i].match(/^\s+([✔✘]) 义务 (\S+)（([^）]*)）＝ (\S+)/);
      if (mo) {
        const reasons = [];
        for (let j = i + 1; j < lines.length && /^\s{6}\S/.test(lines[j]); j += 1) reasons.push(lines[j].trim());
        obligations.push({ id: mo[2], type: mo[3], state: mo[4], mark: mo[1], reasons });
        continue;
      }
      const mc = lines[i].match(/^\s+([✔✘]) (\w+)(：|$)/);
      if (mc) clauses.push({ name: mc[2], ok: mc[1] === "✔", reason: (lines[i].split("：").slice(1).join("：") ?? "").trim() });
    }
    return { obligations, clauses, blocked: /裁决 BLOCKED/.test(out), snapshot: (out.match(/快照 ([0-9a-f]{8})/) ?? [])[1] ?? null };
  };

  // ── 反例族八体（逐体新夹具：基态全满足 → 注入单缺陷 → gate explain 活体）──────────
  const BODIES = [
    {
      id: "b1-failed-but-reusable",
      note: "失败但可复用的回执（适用≠成功，V03）",
      checkArgv: ["node", "-e", "process.exit(3)"],
      expectRunFail: true,
      expect: /失败回执可复用仅构成适用性事实，不满足成功义务（V03）/,
    },
    {
      id: "b2-contract-mutated",
      note: "错契约（契约盘上漂移=新哈希=新授权请求）",
      expect: /\[a\.contract-unmutated\] 契约已变/,
      inject: (fx) => {
        const p = join(fx.d, "contract.md");
        writeFileSync(p, `${readFileSync(p, "utf8")}<!-- mutated -->\n`);
      },
    },
    {
      id: "b3-candidate-moved",
      note: "错候选（回执后候选前移）",
      expect: /候选已前移/,
      inject: (fx) => {
        const g = (args) => spawnSync("git", args, { cwd: fx.d, encoding: "utf8" });
        writeFileSync(join(fx.d, "b.txt"), "b\n");
        g(["add", "b.txt"]);
        g(["commit", "-qm", "move"]);
      },
    },
    {
      id: "b4-ci-missing-item",
      note: "CI 漏项（必需集合不全，V10）",
      expect: /必需检查「ci \/ test \(24, windows-latest\)」missing/,
      inject: (fx) => {
        writeFileSync(fx.gh, qamGhScript([{ name: QAM_REQ_CI[0], conclusion: "success" }]), { mode: 0o755 });
        const r = fx.lzy(["verify", "ci"], { LZY_GH_BIN: fx.gh });
        if (r.exit !== 0) throw new Error(`b4 注入失败：${r.out}`);
      },
    },
    {
      id: "b5-authorization-withdrawn",
      note: "授权撤回（撤回在案即无效，V02）",
      expect: /\[b\.authorized\] 契约授权已被用户撤回/,
      inject: (fx) => {
        const w = fx.hook(`撤回 ${fx.short}`);
        if (!w.out.includes("Withdrawal recorded")) throw new Error(`b5 撤回未记录：${w.out}`);
      },
    },
    {
      id: "b6-review-absent",
      note: "评审缺席（M1 恒在场：诚实阻塞，不伪造完成）",
      expect: REVIEW_RE,
    },
    {
      id: "b7-contract-file-absent",
      note: "v2 目标契约缺席（绑定在案而文件读不到=拒，不猜补）",
      expect: /\[a\.contract-readable\] 契约文件不可读或结构非法/,
      inject: (fx) => rmSync(join(fx.d, "contract.md"), { force: true }),
    },
    {
      id: "b8-acceptance-mapping-missing",
      note: "契约在案但验收映射缺项（F 项未覆盖 A2）",
      expect: /验收覆盖缺口：契约验收项 A2 无任何 F 项 accepts 引用/,
      inject: (fx) => {
        const goal = fx.readGoal();
        goal.steps = goal.steps.map((s) => (s.id === "F2" ? { ...s, acceptsRefs: [] } : s));
        writeFileSync(fx.goalPath, `${JSON.stringify(goal, null, 2)}\n`);
      },
    },
  ];

  const bodies = [];
  for (const b of BODIES) {
    const fx = fixture(b.id, b.checkArgv ? { checkArgv: b.checkArgv, expectRunFail: b.expectRunFail === true } : undefined);
    if (b.inject) b.inject(fx);
    const ge = fx.lzy(["gate", "explain"]);
    const parsed = parseGate(ge.out);
    const matched = b.expect.test(ge.out);
    const ownUnsatisfied = parsed.obligations.filter((o) => o.state !== "satisfied");
    const row = {
      id: b.id,
      note: b.note,
      inject: b.inject ? "夹具注入（见 qa.mjs 案例源码）" : "基态即达（无注入）",
      gateExplain: { exit: ge.exit, blocked: parsed.blocked, matched, snapshot: parsed.snapshot },
      unsatisfiedObligations: ownUnsatisfied.map((o) => ({ id: o.id, state: o.state, reasons: o.reasons.map((r) => r.slice(0, 240)) })),
      failedClauses: parsed.clauses.filter((c) => !c.ok).map((c) => ({ name: c.name, reason: c.reason.slice(0, 240) })),
    };
    bodies.push(row);
    const bodyEvidence = [...row.unsatisfiedObligations.flatMap((o) => o.reasons), ...row.failedClauses.map((c) => c.reason)].find((r) => b.expect.test(r));
    push(
      `GATE-${b.id}`,
      ge.exit !== 0 && matched,
      `${b.note} ⇒ gate explain 退出码非 0 且原因逐体对应`,
      `exit=${ge.exit} matched=${matched}｜${bodyEvidence ?? row.unsatisfiedObligations[0]?.reasons?.[0] ?? row.failedClauses[0]?.reason ?? "(无逐条原因)"}`,
      "lzy gate explain 活体 stdout（本案例 result JSON bodies[].unsatisfiedObligations/failedClauses 全文）",
    );
  }

  // 基态正判腿：唯一 unsatisfied 义务=评审底线（逐义务判定可达；其余义务/子句全 satisfied）
  const fxBase = fixture("base");
  const geBase = fxBase.lzy(["gate", "explain"]);
  const baseParsed = parseGate(geBase.out);
  const baseUnsat = baseParsed.obligations.filter((o) => o.state !== "satisfied");
  const checkOb = baseParsed.obligations.find((o) => o.id === "check.smoke") ?? null;
  const ciOb = baseParsed.obligations.find((o) => o.id === "ci.required-checks") ?? null;
  push(
    "GATE-base-review-only",
    geBase.exit !== 0 &&
      baseUnsat.length === 1 &&
      baseUnsat[0].id === "review.general-correctness" &&
      checkOb?.state === "satisfied" &&
      ciOb?.state === "satisfied" &&
      /三轴满足/.test(checkOb.reasons.join(" ")) &&
      baseParsed.clauses.filter((c) => !c.ok).length === 0,
    "基态（真实成功回执全满足）：唯一 unsatisfied=评审底线；check/ci 义务 satisfied（三轴满足）且无失败子句",
    `unsatisfied=[${baseUnsat.map((o) => o.id).join(",")}] check=${checkOb?.state} ci=${ciOb?.state} failedClauses=[${baseParsed.clauses.filter((c) => !c.ok).map((c) => c.name).join(",")}]`,
    "lzy gate explain 活体 stdout（base 行；逐义务判定可达的证明）",
  );

  // ── 入口腿① loop finish（真 CLI；步骤齐全+干净树才到门）───────────────────────
  let finishObs = { exit: null, gateBlocked: false };
  {
    const fx = fixture("entry-finish");
    for (const [id, ev] of [["N1", null], ["F1", "alpha-live"], ["F2", "beta-live"]]) {
      const r = ev ? fx.lzy(["step", "done", id, "--evidence", ev]) : fx.lzy(["step", "done", id]);
      if (r.exit !== 0) throw new Error(`entry-finish step ${id} 失败：${r.out}`);
    }
    const fin = fx.lzy(["loop", "finish"]);
    const goalAfter = fx.readGoal();
    finishObs = {
      exit: fin.exit,
      gateBlocked: /统一门阻塞（政策层/.test(fin.out) && REVIEW_RE.test(fin.out),
      statusAfter: goalAfter.status,
      firstReason: (fin.out.match(/-\s+(\[.*)$/m) ?? [])[1]?.slice(0, 200) ?? null,
    };
    push(
      "ENTRY-finish",
      fin.exit !== 0 && finishObs.gateBlocked && goalAfter.status === "executing",
      "缺必需评审的已批准契约 v2 目标：loop finish 退出码非 0、报文含统一门阻塞+评审义务、状态不置 done",
      `exit=${fin.exit} status=${goalAfter.status}｜${finishObs.firstReason ?? ""}`,
      "lzy loop finish 活体 stdout",
    );
  }

  // ── 入口腿②③④ done 记录：queue dispatch/reconcile + delivery act（假 drive/假 gh=外发替身）──
  let dispatchObs = {};
  let reconcileObs = {};
  let actObs = {};
  {
    const q = await import(pathToFileURL(join(REPO, "core", "queue.js")).href);
    const deliv = await import(pathToFileURL(join(REPO, "core", "delivery.js")).href);
    const contractMod = await import(pathToFileURL(join(REPO, "core", "contract.js")).href);
    const loopMod = await import(pathToFileURL(join(REPO, "core", "loop.js")).href);
    const fx = fixture("entry-done");
    // 队列条目（endpoint A：无交付链，dispatch 收口腿不掺外发面）
    const it = q.addQueueItem(fx.d, {
      title: "qam-item",
      contractFile: join(fx.d, "contract.md"),
      planFile: join(fx.d, "plan.md"),
      goalSlug: "gmatrix",
      endpoint: "A",
    });
    contractMod.recordAuthorization(fx.d, { kind: "approval", slug: "gmatrix", contractHash: it.contractHash, sessionId: "t", at: nowIso() });
    q.refreshQueue(fx.d);
    // done 旧记录形态（测试态：手置 status；本判决面=「done 记录过不过门」）
    const goal = fx.readGoal();
    goal.status = "done";
    writeFileSync(fx.goalPath, `${JSON.stringify(goal, null, 2)}\n`);
    const res = await q.runQueueDispatch(fx.d, {}, { drive: async () => ({ ok: true, cause: "qam-fake-drive（零会话）" }) });
    const item = q.loadQueue(fx.d).items.find((x) => x.id === it.id);
    const tx = q.loadDispatch(fx.d).txs.find((t) => t.itemId === it.id) ?? null;
    dispatchObs = {
      dispatchExitCode: null, // 现行 CLI 对 ready 态退出码 0（QAM：dispatch 收口腿以条目结局为判据，不冒充退出码）
      itemState: item?.state ?? null,
      txPhase: tx?.phase ?? null,
      txNote: (tx?.note ?? "").slice(0, 300),
      cause: String(res?.results?.[0]?.cause ?? "").slice(0, 300),
    };
    push(
      "ENTRY-dispatch-done",
      item?.state === "ready" && tx?.phase === "killed" && /统一门阻塞（done 记录不免核/.test(`${tx?.note}${dispatchObs.cause}`),
      "done 旧记录不免核：queue dispatch 条目非 completed、回 ready、tx killed 且成因含统一门",
      `item=${dispatchObs.itemState} tx=${dispatchObs.txPhase}｜${dispatchObs.cause}`,
      "runQueueDispatch（deps.drive 假件=零会话）+ loadQueue/loadDispatch 活体读数",
    );
    // reconcile 追认腿（手工 open tx）
    const dj = q.loadDispatch(fx.d) ?? { txs: [] };
    dj.txs.push({ txId: "t-qam-1", itemId: it.id, goalSlug: "gmatrix", phase: "open", openedAt: nowIso(), settledAt: null, limits: { wallMs: null, points: null }, segments: [], note: null });
    q.saveDispatch(fx.d, dj);
    const rec = q.reconcileDispatch(fx.d, {});
    const item2 = q.loadQueue(fx.d).items.find((x) => x.id === it.id);
    const v = rec?.verdicts?.find((x) => x.txId === "t-qam-1") ?? null;
    reconcileObs = {
      reconcileExitCode: null, // 现行 reconcile 只打印 verdicts 不设退出码（QAM：判据=verdict 字面+条目未决）
      itemState: item2?.state ?? null,
      verdict: (v?.verdict ?? "").slice(0, 300),
      txPhase: q.loadDispatch(fx.d).txs.find((t) => t.txId === "t-qam-1")?.phase ?? null,
    };
    push(
      "ENTRY-reconcile-done",
      item2?.state !== "completed" && /blocked（统一门/.test(reconcileObs.verdict) && reconcileObs.txPhase === "open",
      "done 追认前过门：reconcile verdict 字面含阻塞原因、条目保持未决（不追认）、tx 留可 reconcile 集",
      `item=${reconcileObs.itemState} tx=${reconcileObs.txPhase}｜${reconcileObs.verdict}`,
      "reconcileDispatch 活体读数（verdicts/items/dispatch）",
    );
    // delivery act 腿（B∧C 双授权；外发替身计数）
    const calls = [];
    const fxD = fixture("entry-act");
    writeFileSync(join(fxD.d, "cb.md"), "task: 交付B\nendpoint: B\nscope: .\nrecipe: none\n\n- [A1] x\n");
    writeFileSync(join(fxD.d, "cc.md"), "task: 交付C\nendpoint: C\nscope: .\nrecipe: none\n\n- [A1] x\n");
    const b = deliv.validateDeliveryContract(fxD.d, "B", join(fxD.d, "cb.md"));
    const c = deliv.validateDeliveryContract(fxD.d, "C", join(fxD.d, "cc.md"));
    loopMod.bindDeliveryContract(fxD.d, "B", join(fxD.d, "cb.md"), b.hash);
    loopMod.bindDeliveryContract(fxD.d, "C", join(fxD.d, "cc.md"), c.hash);
    contractMod.recordAuthorization(fxD.d, { kind: "approval", slug: "gmatrix", contractHash: b.hash, sessionId: "t", at: nowIso() });
    contractMod.recordAuthorization(fxD.d, { kind: "approval", slug: "gmatrix", contractHash: c.hash, sessionId: "t", at: nowIso() });
    writeFileSync(join(fxD.d, "body.md"), "pr body\n");
    const deps = {
      sleep: () => {},
      gitPush: () => { calls.push("git-push"); return { code: 0, stdout: "", stderr: "" }; },
      ghApi: (args) => { calls.push(args.join(" ")); return { code: 0, stdout: "{}", stderr: "" }; },
    };
    let actErr = null;
    try {
      deliv.actDeliveryB(fxD.d, { repo: "Acfufu/lazyzcode", branch: "v040", base: "main", head: "a".repeat(40), prTitle: "t", prBodyFile: "body.md" }, deps);
    } catch (e) {
      actErr = String(e?.message ?? e);
    }
    actObs = {
      actError: actErr ? actErr.slice(0, 300) : null,
      externalCalls: calls.length,
      intents: (deliv.loadIntents(fxD.d)?.intents ?? []).length,
    };
    push(
      "ENTRY-act-v2",
      actErr != null && /外发前置统一门（ep B）阻塞/.test(actErr) && calls.length === 0 && actObs.intents === 0,
      "缺必需评审的 v2 目标：delivery act 被统一门拒（错误面），外发替身计数 0、意图零落账",
      `err=${(actErr ?? "(未拒)").slice(0, 160)} calls=${calls.length} intents=${actObs.intents}`,
      "actDeliveryB 活体（deps 假 gh/gitPush=外发替身；计数即外发数）",
    );
    // done 记录下的 gate explain：done 不免核的读面确证
    const geDone = fx.lzy(["gate", "explain"]);
    push(
      "ENTRY-done-gate-explain",
      geDone.exit !== 0 && /政策层不放行/.test(geDone.out),
      "done 记录的 gate explain 仍 BLOCKED（done 不免核读面；v1 旧记录则逐字「政策裁决不适用」）",
      `exit=${geDone.exit} first=${geDone.out.split("\n").find((l) => l.trim())?.slice(0, 160) ?? ""}`,
      "lzy gate explain 活体 stdout（done 目标）",
    );
  }

  // ── 无契约 v2：评审义务不豁免（拍板 7——不存在「无契约→免评审」旁路）──────────
  {
    const d = join(gateDir, "no-contract");
    mkdirSync(d, { recursive: true });
    const home = mkdtempSync(join(tmpdir(), "lzy-qam-nc-home-"));
    const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
    g(["init", "-q"]);
    g(["config", "user.email", "t@l"]);
    g(["config", "user.name", "t"]);
    writeFileSync(join(d, "a.txt"), "a\n");
    writeFileSync(join(d, "p.md"), "- [N1] x\n");
    g(["add", "-A"]);
    g(["commit", "-qm", "init"]);
    const lzy = (args, extra = {}) =>
      spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: "utf8", timeout: 120_000, env: { ...baseEnv, HOME: home, USERPROFILE: home, LZY_ABLATE_HUMAN_GATE: "1", ...extra } });
    if (lzy(["loop", "register", "qamnc", "--title", "t"]).status !== 0) throw new Error("no-contract register 失败");
    if (lzy(["loop", "plan", "p.md"]).status !== 0) throw new Error("no-contract plan 失败");
    const ge = lzy(["gate", "explain"]);
    const out = `${ge.stdout ?? ""}${ge.stderr ?? ""}`;
    push(
      "ENTRY-no-contract-review",
      ge.status !== 0 && REVIEW_RE.test(out),
      "无契约 v2 目标不豁免评审义务（诚实阻塞；不存在「无契约→免评审」旁路）",
      `exit=${ge.status} reviewReason=${REVIEW_RE.test(out)}`,
      "lzy gate explain 活体 stdout（无契约 v2 夹具）",
    );
  }

  return {
    blocked: null,
    assertions,
    bodies,
    entries: { finish: finishObs, dispatch: dispatchObs, reconcile: reconcileObs, act: actObs },
    probeBudget: { preregisteredSessions: 0, usedSessions: 0, note: "零会话矩阵：不 spawn 引擎；dispatch/act 腿 deps 注入假件（外发替身计数）" },
  };
}

// ── case: review-runtime（受控评审运行器活体矩阵；goal v040-m2-review#N8，§8.1 review-runtime）──
// 判据面：替身引擎（按引擎 CLI 约定出单 JSON 摘要 + 写引擎约定转录 + 按腿写/不写子账本——
// 列形状按 core/cost.js 聚合列）驱动 `lzy review run` 真链，八体拒绝矩阵逐体命名断言
//（命令退出码/记录判因/零 spawn）；LIGHT 与 HEAVY 两档真实绿例（真引擎会话、预注册预算）
// 走 review run → review show → gate explain → loop finish 全链到 attestation，并核计量行
//（子账本 points>0 双读不累加 + 宿主对照零行=计量缝收口）与隔离读数（input 零泄漏）。
// auth/引擎/sqlite3 缺席=blocked(3) 具名（绿例不可达，不算 SKIP 通过）。
const QAR_CONTRACT = "task: review qa fixture\nendpoint: A\nscope: .\nrecipe: none\nbudget-ref: none\n\n- [A1] marker file works\n";
const QAR_PLAN = "- [N1] add marker file\n- [F1] marker exists\naccepts: A1\n";

function writeStubEngine(dir) {
  const p = join(dir, "stub-engine.cjs");
  writeFileSync(
    p,
    `#!/usr/bin/env node
// 评审 qa 替身引擎（LZY_STUB_LEG 选腿）：argv=[--prompt X --json --mode plan] → stdout 单 JSON
// 摘要 {sessionId,response,usage}（引擎 --json 契约）；转录=引擎约定 model-io jsonl；
// 子账本=LZY_STUB_LEDGER=1 时按 cost.js 聚合列写 sqlite。
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const leg = process.env.LZY_STUB_LEG ?? "green";
const home = process.env.HOME ?? process.env.USERPROFILE;
const cwd = process.cwd();
const sessionId = "sess-stub-" + (process.env.LZY_STUB_SID ?? leg);
const prompt = process.argv.includes("--prompt") ? process.argv[process.argv.indexOf("--prompt") + 1] : "";
fs.mkdirSync(path.join(home, ".zcode", "cli", "rollout"), { recursive: true });
fs.writeFileSync(
  path.join(home, ".zcode", "cli", "rollout", "model-io-" + sessionId + ".jsonl"),
  JSON.stringify({ tool: "read", file_path: (prompt.match(/输入包（facts-only）：(\\S+)/) ?? [])[1] ?? path.join(cwd, "a.txt") }) + "\\n",
);
if (process.env.LZY_STUB_LEDGER === "1") {
  const db = path.join(home, ".zcode", "cli", "db", "db.sqlite");
  fs.mkdirSync(path.dirname(db), { recursive: true });
  const r = spawnSync("sqlite3", [db, "CREATE TABLE IF NOT EXISTS model_usage (session_id TEXT, model_id TEXT, started_at INTEGER, input_tokens INTEGER, cache_read_input_tokens INTEGER, output_tokens INTEGER, status TEXT); INSERT INTO model_usage VALUES ('" + sessionId + "', 'glm-5.3-flash', 1, 100000, 0, 1000, 'completed');"]);
  if (r.status !== 0) { process.stderr.write(String(r.stderr)); process.exit(9); }
}
if (process.env.LZY_STUB_RACE_REPO) {
  fs.writeFileSync(path.join(process.env.LZY_STUB_RACE_REPO, "race.txt"), "racer\\n");
  spawnSync("git", ["add", "-A"], { cwd: process.env.LZY_STUB_RACE_REPO });
  spawnSync("git", ["commit", "-qm", "race"], { cwd: process.env.LZY_STUB_RACE_REPO });
}
if (process.env.LZY_STUB_TAINT === "1") fs.writeFileSync(path.join(cwd, "a.txt"), "tampered-by-stub\\n");
let response = "";
if (leg === "green") {
  response = "\\\`\\\`\\\`json\\\\n" + JSON.stringify({ duty: "review.general-correctness", verdict: "pass", findings: [], summary: "替身绿例：候选树小而干净，未发现通用正确性缺陷" }) + "\\\\n\\\`\\\`\\\`";
} else if (leg === "parsefail") {
  response = "评审完成，但本腿不产出机器可解析的围栏。";
} else if (leg === "contradiction") {
  response = "\\\`\\\`\\\`json\\\\n" + JSON.stringify({ duty: "review.general-correctness", verdict: "pass", findings: [{ id: "F-1", title: "stub blocking", severity: "P1", blocking: true, location: "a.txt:1", evidence: "stub", summary: "结构自相矛盾体" }], summary: "pass 与阻塞发现并存" }) + "\\\\n\\\`\\\`\\\`";
}
if (leg === "sleep") { const end = Date.now() + 120000; while (Date.now() < end) {} }
process.stdout.write(JSON.stringify({ sessionId, response, usage: { input_tokens: 1, output_tokens: 1 } }) + "\\n");
`,
    { mode: 0o755 },
  );
  return p;
}

async function reviewRuntimeCase() {
  const assertions = [];
  const push = (id, ok, expected, observed, evidence) => assertions.push({ id, ok: Boolean(ok), expected, observed: String(observed).slice(0, 600), evidence });
  const CLI = join(REPO, "cli", "lzy.js");
  const TRIGGER = join(REPO, "plugin", "hooks", "trigger.js");
  const caseDir = join(fixtureRoot, "review-runtime");
  rmSync(caseDir, { recursive: true, force: true }); // 幂等：本案例独占子目录
  mkdirSync(caseDir, { recursive: true });
  const stub = writeStubEngine(caseDir);
  const baseEnv = { ...process.env };

  // 夹具：v2 目标全链（register → 真实 UPS 批准 → plan → start）；HEAVY 采纳带 PASS 评审串。
  function fixture(name, { tier = "light" } = {}) {
    const home = mkdtempSync(join(tmpdir(), `lzy-qar-${name}-home-`));
    const d = join(caseDir, name);
    mkdirSync(d, { recursive: true });
    const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
    g(["init", "-q"]);
    g(["config", "user.email", "t@l"]);
    g(["config", "user.name", "t"]);
    // .gitignore 先行：.lazyzcode/ 不得入候选快照（git archive HEAD）——否则评审读到陈旧循环
    // 状态与输入包事实自相矛盾（light 探针实锤：评审判 blocked 点名 goal.json 步骤 pending）。
    writeFileSync(join(d, ".gitignore"), ".lazyzcode/\nnode_modules/\n");
    writeFileSync(join(d, "a.txt"), "a\n");
    writeFileSync(join(d, "contract.md"), QAR_CONTRACT);
    writeFileSync(join(d, "plan.md"), QAR_PLAN);
    g(["add", "-A"]);
    g(["commit", "-qm", "fixture"]);
    const slug = name;
    const lzy = (args, extra = {}) => {
      const r = spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: "utf8", timeout: 600_000, env: { ...baseEnv, HOME: home, USERPROFILE: home, ...extra } });
      return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    };
    const hook = (prompt) => {
      const r = spawnSync(process.execPath, [TRIGGER], {
        cwd: d, encoding: "utf8", timeout: 30_000,
        input: JSON.stringify({ prompt, cwd: d, sessionId: "sess_qar" }),
        env: { ...baseEnv, HOME: home, USERPROFILE: home },
      });
      return { exit: r.status, out: r.stdout ?? "" };
    };
    const readGoal = () => JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
    const reg = lzy(["loop", "register", slug, "--title", "t", "--contract", "contract.md", ...(tier === "heavy" ? ["--tier", "heavy"] : [])]);
    if (reg.exit !== 0) throw new Error(`register 失败：${reg.out}`);
    const passReview = "VERDICT: PASS — 夹具计划决策完备（N1/F1、accepts 映射闭合、无未决事项）";
    // HEAVY 的机器评审门在计划门先于契约门触发：两次 plan 都须带 PASS 评审串（light 不需要）。
    const p1 = lzy(["loop", "plan", "plan.md", ...(tier === "heavy" ? ["--review", passReview] : [])]);
    if (p1.exit !== 1) throw new Error(`首采应拒（contractPending）：${p1.out}`);
    const short = readGoal().contractPending.contractHash.slice(0, 8);
    const ap = hook(`批准 ${short}`);
    if (!ap.out.includes("Human approval recorded for contract")) throw new Error(`批准未记录：${ap.out}`);
    const p2 = lzy(["loop", "plan", "plan.md", ...(tier === "heavy" ? ["--review", passReview] : [])]);
    if (p2.exit !== 0) throw new Error(`采纳失败：${p2.out}`);
    const st = lzy(["loop", "start"]);
    if (st.exit !== 0) throw new Error(`start 失败：${st.out}`);
    return { d, home, lzy, hook, readGoal, slug, g };
  }

  // 目标推进到「评审就绪」态：F1 红半（基线树）→ N1 提交 → F1 绿半 →（HEAVY）对照件。
  function readyGoal(fx) {
    const red = fx.lzy(["evidence", "red", "F1", "--evidence", "red: marker.txt absent on baseline tree"]);
    if (red.exit !== 0) throw new Error(`红半失败：${red.out}`);
    writeFileSync(join(fx.d, "marker.txt"), "marker\n");
    fx.g(["add", "-A"]);
    fx.g(["commit", "-qm", "add marker"]);
    const n1 = fx.lzy(["step", "done", "N1", "--note", "add marker file"]);
    if (n1.exit !== 0) throw new Error(`N1 失败：${n1.out}`);
    const f1 = fx.lzy(["step", "done", "F1", "--evidence", "green: marker.txt present in HEAD tree"]);
    if (f1.exit !== 0) throw new Error(`F1 失败：${f1.out}`);
    return fx;
  }

  const engineEnv = (leg, extra = {}) => ({ LZY_ZCODE_ENGINE: stub, LZY_STUB_LEG: leg, ...extra });
  const listRuns = (fx) => {
    const dir = join(fx.d, ".lazyzcode", "review");
    try {
      return readdirSync(dir).filter((x) => x.endsWith(".json"));
    } catch {
      return []; // 前置拒不落档=族目录缺席（r5 零 spawn 面依赖此语义）
    }
  };

  // ── 替身拒绝矩阵八体 ──
  const bodies = [
    {
      id: "r1-candidate-race",
      run: (fx) => fx.lzy(["review", "run", "--timeout-ms", "30000"], engineEnv("green", { LZY_STUB_RACE_REPO: fx.d })),
      expect: (fx, r) => {
        push("r1", r.exit === 1 && /candidate-moved/.test(r.out), "exit 1 且判因 candidate-moved（后台改候选）", `exit=${r.exit} out=${r.out.split("\n")[0]}`);
      },
    },
    {
      id: "r2-parse-fail",
      run: (fx) => fx.lzy(["review", "run", "--timeout-ms", "30000"], engineEnv("parsefail")),
      expect: (fx, r) => {
        push("r2", r.exit === 1 && /parse-fail/.test(r.out), "exit 1 且判因 parse-fail（无围栏）", `exit=${r.exit} out=${r.out.split("\n")[0]}`);
      },
    },
    {
      id: "r3-timeout",
      run: (fx) => fx.lzy(["review", "run", "--timeout-ms", "4000"], engineEnv("sleep")),
      expect: (fx, r) => {
        push("r3", r.exit === 1 && /timeout/.test(r.out), "exit 1 且判因 timeout（小墙钟 SIGKILL）", `exit=${r.exit} out=${r.out.split("\n")[0]}`);
      },
    },
    {
      id: "r4-metering-absent",
      run: (fx) => fx.lzy(["review", "run", "--timeout-ms", "30000"], engineEnv("green")),
      expect: (fx, r) => {
        push("r4", r.exit === 1 && /metering-absent/.test(r.out), "exit 1 且判因 metering-absent（替身不写子账本）", `exit=${r.exit} out=${r.out.split("\n")[0]}`);
      },
    },
    {
      id: "r5-authorization-withdrawn",
      run: (fx) => {
        // 授权撤回：真 effectiveAuthorization 面（追加 withdrawal 事件）→ 前置拒 exit 3 零 spawn
        recordAuthorization(fx.d, { kind: "withdrawal", slug: fx.slug, contractHash: fx.readGoal().contract.contractHash, sessionId: "sess_qar", at: new Date().toISOString() });
        const r = fx.lzy(["review", "run", "--timeout-ms", "30000"], engineEnv("green"));
        const spawned = listRuns(fx).length > 0; // 零 spawn=零落档
        push("r5a", r.exit === 3 && /撤回/.test(r.out) && /前置不具备/.test(r.out), "exit 3 且报文带撤回与恢复指路", `exit=${r.exit} out=${r.out.split("\n")[0]}`);
        push("r5b", !spawned, "零 spawn（不落档不消耗）", `族内档数=${listRuns(fx).length}`);
      },
    },
    {
      id: "r6-fake-import",
      run: (fx) => {
        // 伪导入：手写「外部评审报告」直塞族内（容器家法重签校验和——伪造者可做）→
        // gate 仍 blocked（原始输出封存缺席=物证面）；list 面在场（过容器闸后按内容判）。
        // 伪导入面收口： forged 档带**真实模板哈希与真实候选身份**（打穿规则一致性面），
        // 仅物证面（原始输出封存）能拦——gate 仍 blocked 即「外部报告不充当运行」的强形态。
        const realId = candidateIdentity(fx.d);
        const forged = {
          schemaVersion: 1, runId: `${fx.slug}.a1.r1`, slug: fx.slug, attempt: 1, seq: 1,
          duty: { id: "review.general-correctness" }, dutyTableVersion: 2, templateHash: dutyTemplateHash(),
          inputPackageHash: sha256text("forged-input"), candidate: { headSha: realId.headSha, compositeFingerprint: realId.compositeFingerprint, cliVersion: realId.cliVersion, clean: true },
          snapshot: { treeHash: sha256text("h") },
          startedAt: "2026-09-27T00:00:00.000Z", endedAt: "2026-09-27T00:01:00.000Z",
          exit: { code: 0, signal: null }, sessionId: "sess-forged", engine: "external-report",
          raw: { path: "raw.txt", sha256: sha256text("forged-raw"), bytes: 3 },
          transcript: { path: "home/.zcode/cli/rollout/model-io-sess-forged.jsonl", sha256: sha256text("forged-t") },
          budget: null, metering: { status: "metered", points: 9, note: null },
          validity: { status: "valid", reason: null, detail: null },
          result: { verdict: "pass", findings: [], summary: "外部报告自称 pass", normalization: null },
        };
        const content = JSON.stringify(forged);
        const realChecksum = createHash("sha256").update(content).digest("hex");
        mkdirSync(join(fx.d, ".lazyzcode", "review"), { recursive: true });
        writeFileSync(join(fx.d, ".lazyzcode", "review", "external-report.json"), `${JSON.stringify({ ...forged, checksum: realChecksum }, null, 2)}\n`);
        const ge = fx.lzy(["gate", "explain"]);
        push("r6", ge.exit !== 0 && /原始输出/.test(ge.out), "伪导入不充当运行：gate 仍 blocked（原始输出封存缺席）", `exit=${ge.exit} rev=${/义务 review\.general-correctness[^＝]*＝ (\S+)/.exec(ge.out)?.[1]}`);
        const lx = fx.lzy(["review", "list"]);
        push("r6b", lx.exit === 0, "list 面在场（伪造档过容器闸后按内容判）", `exit=${lx.exit}`);
      },
    },
    {
      id: "r7-contamination",
      run: (fx) => fx.lzy(["review", "run", "--timeout-ms", "30000"], engineEnv("green", { LZY_STUB_TAINT: "1", LZY_STUB_LEDGER: "1" })),
      expect: (fx, r) => {
        push("r7", r.exit === 1 && /contamination/.test(r.out), "exit 1 且判因 contamination（快照树变化）", `exit=${r.exit} out=${r.out.split("\n")[0]}`);
      },
    },
    {
      id: "r8-contradiction",
      run: (fx) => fx.lzy(["review", "run", "--timeout-ms", "30000"], engineEnv("contradiction", { LZY_STUB_LEDGER: "1" })),
      expect: (fx, r) => {
        push("r8", r.exit === 1 && /blocked/.test(r.out) && /归一化/.test(r.out), "pass∧blocking 并存按 blocked 判（归一化注记），exit 1 不可改判", `exit=${r.exit} out=${r.out.split("\n")[0]}`);
      },
    },
  ];

  for (const b of bodies) {
    const fx = readyGoal(fixture(b.id));
    try {
      await b.run(fx);
    } catch (e) {
      push(b.id, false, "体执行无异常", String(e?.message ?? e).slice(0, 200));
    }
    rmSync(join(caseDir, b.id), { recursive: true, force: true }); // 逐体即焚
  }

  // ── 能力探测（绿例前置；缺席=blocked(3) 具名）──
  const cap = {
    auth: detectHeadlessAuth(),
    engine: findEngine(),
    sqlite3: spawnSync("sqlite3", ["--version"], { timeout: 5000 }).status === 0,
  };
  const capMissing = [!cap.auth?.ok && "auth", !cap.engine && "engine", !cap.sqlite3 && "sqlite3"].filter(Boolean);
  if (capMissing.length > 0) {
    return {
      blocked: `绿例不可达：缺 ${capMissing.join("/")}（auth/引擎/sqlite3 缺席=blocked(3) 具名，不算 SKIP）`,
      assertions,
      bodies: bodies.map((b) => b.id),
      probeBudget: { preregisteredSessions: 0, usedSessions: 0, note: "替身矩阵完成，真实绿例因环境缺能力未跑" },
    };
  }

  // ── 两档真实绿例（真引擎会话；预注册预算内）──
  const sessions = [];
  const meteringRows = [];
  let usedSessions = 0;
  for (const tier of ["light", "heavy"]) {
    const name = `green-${tier}`;
    const fx = readyGoal(fixture(name, { tier }));
    if (tier === "heavy") {
      const cmp = join(caseDir, `${name}-cmp.json`);
      writeFileSync(cmp, `${JSON.stringify({ slug: fx.slug, items: [{ fid: "F1", verdict: "MATCH", generation: 1, basis: "marker 存在性断言绿半对照" }] }, null, 2)}\n`);
      const at = fx.lzy(["attest", "comparator", "--file", cmp]);
      if (at.exit !== 0) throw new Error(`对照件失败：${at.out}`);
    }
    const t0 = Date.now();
    // 真实会话（预注册预算内）；引擎瞬态死亡（1302/内容杀流类）qa 级重试一次——runner 语义
    // 保持严格（exit-nonzero=invalid 落档），重试是 harness 韧性不是改判；逐次计入 usedSessions。
    let rr = fx.lzy(["review", "run", "--timeout-ms", "420000"], { LZY_ZCODE_ENGINE: cap.engine });
    usedSessions += 1;
    if (rr.exit !== 0 && /exit-nonzero|interrupted/.test(rr.out)) {
      rr = fx.lzy(["review", "run", "--timeout-ms", "420000"], { LZY_ZCODE_ENGINE: cap.engine });
      usedSessions += 1;
    }
    const recFile = existsSync(join(fx.d, ".lazyzcode", "review")) ? readdirSync(join(fx.d, ".lazyzcode", "review")).filter((x) => x.endsWith(".json")).at(-1) : null;
    const rec = recFile ? JSON.parse(readFileSync(join(fx.d, ".lazyzcode", "review", recFile), "utf8")) : null;
    push(`${tier}-run`, rr.exit === 0 && rec?.validity?.status === "valid" && rec?.result?.verdict === "pass",
      "真实会话产出 valid metered pass（exit 0）",
      `exit=${rr.exit} validity=${rec?.validity?.status} verdict=${rec?.result?.verdict} reason=${rec?.validity?.reason ?? ""} ${String(rr.out.split("\n")[0]).slice(0, 120)}`);
    if (rr.exit !== 0 || !rec || rec.validity.status !== "valid") {
      continue; // 绿例不可达如实判败（不冒充）——后续读数腿跳过
    }
    const sid = rec.sessionId;
    sessions.push({ leg: tier, sessionId: sid, runId: rec.runId });
    const sh = fx.lzy(["review", "show", rec.runId]);
    push(`${tier}-show`, sh.exit === 0 && sh.out.includes(rec.runId) && /判决 pass/.test(sh.out), "review show 逐字段面", `exit=${sh.exit}`);
    const ge = fx.lzy(["gate", "explain"]);
    push(`${tier}-gate`, ge.exit === 0 && /裁决 PASS/.test(ge.out), "gate 评审义务翻 satisfied → 裁决 PASS", `exit=${ge.exit} verdict=${/裁决 (\S+)/.exec(ge.out)?.[1]}`);
    const fin = fx.lzy(["loop", "finish"]);
    const attDir = join(fx.d, ".lazyzcode", "attestations");
    const att = existsSync(attDir) ? readdirSync(attDir).filter((x) => x.endsWith(".json")) : [];
    push(`${tier}-finish`, fin.exit === 0 && att.length === 1, "finish 过门落终验 attestation", `exit=${fin.exit} att=${att.length} out=${String(fin.out.split("\n")[0]).slice(0, 120)}`);
    // 计量：子账本（=运行目录内隔离 home）points>0、双读不累加、宿主对照零行（计量缝收口）
    const runHome = join(fx.d, ".lazyzcode", "review", rec.runId, "home");
    const sub1 = childLedgerRead(runHome, sid);
    const sub2 = childLedgerRead(runHome, sid);
    const hostRead = querySessionPoints(sid);
    meteringRows.push({ leg: tier, sessionId: sid, points: sub1.points, hostAbsent: hostRead.absent, db: sub1.db });
    push(`${tier}-metering`, sub1.absent === false && sub1.points > 0 && sub2.points === sub1.points && hostRead.absent === true,
      "子账本 metered>0 ∧ 双读不累加 ∧ 宿主零行（M0 发现一收口面）",
      `points=${sub1.points}/${sub2.points} hostAbsent=${hostRead.absent}`);
    // 隔离读数：input 包零在先运行标记（facts-only；轨迹已在 run 时判——validity=valid 蕴含）
    const priorInput = readFileSync(join(fx.d, ".lazyzcode", "review", rec.runId, "input.json"), "utf8");
    const leak = [rec.runId].some((needle) => priorInput.includes(needle));
    push(`${tier}-isolation`, leak === false, "input 包零在先运行标记（facts-only）", `leak=${leak}`);
    console.error(`[v040-qa] ${tier} 绿例：points=${sub1.points} wallMs=${Date.now() - t0} runId=${rec.runId}`);
    rmSync(join(caseDir, name), { recursive: true, force: true });
  }

  return {
    blocked: null,
    assertions,
    bodies: bodies.map((b) => b.id),
    sessions,
    metering: meteringRows,
    probeBudget: { preregisteredSessions: 12, usedSessions, note: "真实会话=两档绿例各 1（预注册 ≤12：开发 ≤4、绿例 2、自审 1-2、复跑余量）" },
  };
}

// ── 执行 ───────────────────────────────────────────────────────────────────
const started = nowIso();
let result;
if (CASE === "capability") {
  result = await capabilityCase();
} else if (CASE === "capability-meter") {
  result = await capabilityMeterCase();
} else if (CASE === "gate-matrix") {
  result = await gateMatrixCase();
} else if (CASE === "review-runtime") {
  result = await reviewRuntimeCase();
} else {
  die(`未知 --case：${CASE}（capability|capability-meter|gate-matrix|review-runtime）`);
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
  engine: result.cap?.engine ?? null,
  auth: result.cap?.auth ?? null,
  probeBudget: result.probeBudget ?? null,
  sessions: result.sessions ?? [],
  metering: result.metering ?? [],
  kill: result.kill ?? null,
  steps: result.steps ?? [],
  bodies: result.bodies ?? null,
  entries: result.entries ?? null,
  assertions,
  snapshots: result.snapshots ?? null,
};
writeFileSync(join(outDir, `result-${CASE}.json`), `${JSON.stringify(resultJson, null, 2)}\n`);
writeFileSync(join(outDir, "result.json"), `${JSON.stringify(resultJson, null, 2)}\n`);

console.log(`[v040-qa] case=${CASE} passed=${passed}${result.blocked ? ` BLOCKED: ${result.blocked}` : ""}`);
for (const a of assertions) console.log(`  ${a.ok ? "✔" : "✖"} ${a.id} ${a.expected}｜observed: ${a.observed}`);
console.log(`  result-${CASE}.json → ${join(outDir, `result-${CASE}.json`)}`);
if (result.blocked != null) process.exit(3);
process.exit(passed ? 0 : 1);
