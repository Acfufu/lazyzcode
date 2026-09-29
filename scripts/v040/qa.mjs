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
import { DUTY_TABLE_VERSION } from "../../core/policy.js"; // M3 N5 翻面随动（review.js 不 re-export 该常量）
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
  finding-lifecycle  发现生命周期全链（M3：替身确定性链 A-D + 真会话腿——注缺陷评审 1 +
                     recheck 收口 1，预注册 ≤12；A=阻塞/finish 必拒/两次无效/diagnose/关闭
                     B=证伪分支 C=reset/rename/supersede 存续 D=reassess 取消与拒删）
  scope-qualification 评审范围资格与适用性全链（M4：替身评审腿+机械资格腿，零真会话——
                     十轴资格对表/越界声明遗漏反例拒/修正重领/四拒逐因 fallback（锁文件·
                     check 脚本·未知新文件·env）/字节不变/关闭依据失效拦与 reopen 重关）
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

// ── case: scope-qualification（评审范围资格与适用性全链；goal v040-m4-scope-qualification#N8，§8.1 M4）──
// 判据面（替身评审腿+机械资格腿混合）：专项职责替身绿运行作 base → 真随包套件 qualify 十轴对表
// → reuse 无关变化 applicable → 越界声明（依赖制品划 unrelated）被遗漏反例点名拒 → 修正声明重领
// → 锁文件/check 脚本/未知新文件/env 四拒逐因 fallback（独立夹具单路径改变）→ base 与资格档字节
// 哈希不变 → 注阻塞发现→resolve→recheck→close→修复区再变化→gate 关闭依据失效拦→reopen→复核重关。
// 全替身零真会话（机械资格腿不 spawn——拍板 10），CI 可跑。
// 夹具卫生：声明档落夹具仓外（仓内自带文件会进候选 diff 判未知路径，污染逐轴读数）；四拒腿各自
// 「提交式单路径改变 + git reset --hard 归位」，保证每腿 diff 只有该轴一条路径。
const SQS_CONTRACT = "task: scope qa fixture\nendpoint: A\nscope: .\nrecipe: none\nbudget-ref: none\n\n- [A1] marker file works\n";
const SQS_PLAN = "- [N1] add marker file\n- [F1] marker exists\naccepts: A1\n";
const SQS_DUTY = "review.verification-deps";

async function scopeQualificationCase() {
  const assertions = [];
  const push = (id, ok, expected, observed, evidence) => assertions.push({ id, ok: Boolean(ok), expected, observed: String(observed).slice(0, 600), evidence });
  const CLI = join(REPO, "cli", "lzy.js");
  const TRIGGER = join(REPO, "plugin", "hooks", "trigger.js");
  const baseEnv = { ...process.env, LZY_ZCODE_ENGINE: "/nonexistent-lzy-suppressed" };
  const caseDir = join(fixtureRoot, "scope-qualification");
  rmSync(caseDir, { recursive: true, force: true }); // 幂等：本案例独占子目录
  mkdirSync(caseDir, { recursive: true });
  const stub = writeStubEngine(caseDir);
  const sha256Of = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

  function fixture(name) {
    const home = mkdtempSync(join(tmpdir(), `lzy-qas-${name}-home-`));
    const d = join(caseDir, name);
    mkdirSync(d, { recursive: true });
    const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
    g(["init", "-q"]);
    g(["config", "user.email", "t@l"]);
    g(["config", "user.name", "t"]);
    writeFileSync(join(d, ".gitignore"), ".lazyzcode/\nnode_modules/\n");
    for (const sub of ["src", "docs", "shared", "scripts"]) mkdirSync(join(d, sub), { recursive: true });
    writeFileSync(join(d, "src", "util.js"), "export const a=1;\n");
    writeFileSync(join(d, "docs", "readme.md"), "# doc\n");
    writeFileSync(join(d, "shared", "dep-config.json"), "{}\n");
    writeFileSync(join(d, "package-lock.json"), "{}\n");
    writeFileSync(join(d, "scripts", "check.sh"), "echo ok\n");
    writeFileSync(join(d, "contract.md"), SQS_CONTRACT);
    writeFileSync(join(d, "plan.md"), SQS_PLAN);
    g(["add", "-A"]);
    g(["commit", "-qm", "fixture"]);
    const lzy = (args, extra = {}) => {
      const r = spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: "utf8", timeout: 600_000, env: { ...baseEnv, HOME: home, USERPROFILE: home, ...extra } });
      return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    };
    const hook = (prompt) => {
      const r = spawnSync(process.execPath, [TRIGGER], {
        cwd: d, encoding: "utf8", timeout: 30_000,
        input: JSON.stringify({ prompt, cwd: d, sessionId: "sess_qas" }),
        env: { ...baseEnv, HOME: home, USERPROFILE: home },
      });
      return { exit: r.status, out: r.stdout ?? "" };
    };
    const readGoal = () => JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
    const reg = lzy(["loop", "register", name, "--title", "t", "--contract", "contract.md"]);
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
    // 推进到评审就绪（红半→提交→N1/F1）
    if (lzy(["evidence", "red", "F1", "--evidence", "red: marker.txt absent on baseline tree"]).exit !== 0) throw new Error("红半失败");
    writeFileSync(join(d, "marker.txt"), "marker\n");
    g(["add", "-A"]);
    g(["commit", "-qm", "add marker"]);
    if (lzy(["step", "done", "N1", "--note", "add marker file"]).exit !== 0) throw new Error("N1 失败");
    if (lzy(["step", "done", "F1", "--evidence", "green: marker.txt present in HEAD tree"]).exit !== 0) throw new Error("F1 失败");
    return { d, lzy, g, slug: name };
  }

  const engineEnv = (leg, extra = {}) => ({ LZY_ZCODE_ENGINE: stub, LZY_STUB_LEG: leg, ...extra });
  const runFile = (fx, stem) => join(fx.d, ".lazyzcode", "review", `${stem}.json`);
  const lastStem = (fx) => readdirSync(join(fx.d, ".lazyzcode", "review")).filter((x) => x.endsWith(".json")).map((x) => x.slice(0, -".json".length)).sort((a, b) => Number(a.split(".r")[1]) - Number(b.split(".r")[1])).at(-1);
  // 声明档落夹具仓外（仓内=候选树污染）；--scope 收绝对路径。
  const writeDecl = (name, decl) => {
    const p = join(caseDir, `${name}.decl.json`);
    writeFileSync(p, JSON.stringify(decl));
    return p;
  };
  // 资格档/适用档按 seq 数值序取末（文件名 p10 字典序在 p2 前，不能用字符串序）。
  const lastScopeRec = (fx, kind) => {
    const dir = join(fx.d, ".lazyzcode", "review-scope");
    if (!existsSync(dir)) return null;
    const re = new RegExp(`\\.${kind}(\\d+)\\.json$`);
    const files = readdirSync(dir).filter((x) => re.test(x));
    const last = files.sort((a, b) => Number(re.exec(a)[1]) - Number(re.exec(b)[1])).at(-1);
    return last ? { file: join(dir, last), rec: JSON.parse(readFileSync(join(dir, last), "utf8")) } : null;
  };
  // 善声明：src=声明内 / docs=可保持 / scripts=声明内（check 脚本=本职责表面）/ 锁文件=共享输入。
  // 刻意不声明 shared/**（缺声明判 unknown⇒invalidate，不构成遗漏反例——反例只在「划错类」时成立）。
  const GOOD_DECL = {
    dutyId: SQS_DUTY,
    rules: [
      { pattern: "src/**", class: "in-scope" },
      { pattern: "docs/**", class: "unrelated" },
      { pattern: "scripts/**", class: "in-scope" },
    ],
    sharedInputs: ["package-lock.json"],
  };

  // ① base 运行：专项职责替身绿
  const fx = fixture("scope-main");
  const run1 = fx.lzy(["review", "run", "--duty", SQS_DUTY, "--timeout-ms", "30000"], engineEnv("green", { LZY_STUB_DUTY: SQS_DUTY, LZY_STUB_LEDGER: "1" }));
  const baseStem = `${fx.slug}.a1.r1`;
  const rec1 = JSON.parse(readFileSync(runFile(fx, baseStem), "utf8"));
  push("s1-base-run", run1.exit === 0 && rec1.validity.status === "valid" && rec1.duty.id === SQS_DUTY && rec1.metering.status === "metered",
    "专项职责替身绿运行 valid metered pass", `exit=${run1.exit} duty=${rec1.duty?.id} ${rec1.validity?.status}/${rec1.result?.verdict}`);
  const baseSha0 = sha256Of(runFile(fx, baseStem));

  // ② 资格挑战：真随包套件（十轴；含 in-scope / canary-keep / missed-dependency 三类改变对表）
  const q1 = fx.lzy(["review", "qualify", baseStem, "--scope", writeDecl("good", GOOD_DECL)]);
  const q1rec = lastScopeRec(fx, "q");
  const SQS_AXES = ["in-scope", "canary-keep", "missed-dependency", "unknown-new", "rename-delete", "lockfile", "check-script", "env", "contract", "duty"];
  const axisOk = (rec, a) => (rec?.challenges ?? []).some((c) => c.axis === a && c.ok);
  const qualSha0 = q1rec ? sha256Of(q1rec.file) : null;
  push("s2-qualify-granted", q1.exit === 0 && q1rec?.rec.granted === true && SQS_AXES.every((a) => axisOk(q1rec.rec, a)),
    "真随包套件十轴逐轴对表全过（含 in-scope/canary-keep/missed-dependency 三类改变）",
    `exit=${q1.exit} granted=${q1rec?.rec.granted} 全过=${(q1rec?.rec.challenges ?? []).filter((c) => c.ok).length}/${(q1rec?.rec.challenges ?? []).length}`);

  // ③ 复用：无关变化（docs 声明 unrelated）applicable；base 与资格档字节不变（只追加）
  writeFileSync(join(fx.d, "docs", "readme.md"), "# doc\n# unrelated\n");
  fx.g(["add", "-A"]);
  fx.g(["commit", "-qm", "docs unrelated"]);
  const u1 = fx.lzy(["review", "reuse", baseStem]);
  const u1rec = lastScopeRec(fx, "p");
  const u1paths = (u1rec?.rec.diff?.entries ?? []).map((e) => e.path);
  push("s3-reuse-applicable", u1.exit === 0 && u1rec?.rec.verdict === "applicable" && u1paths.length === 1 && u1paths[0] === "docs/readme.md",
    "无关变化复用 applicable（diff 恰为 docs/readme.md）", `exit=${u1.exit} verdict=${u1rec?.rec.verdict} entries=[${u1paths.join(",")}]`);
  push("s3-byte-stable", baseSha0 === sha256Of(runFile(fx, baseStem)) && qualSha0 === sha256Of(q1rec.file),
    "base 运行档与资格档字节哈希复用前后不变（只追加）", `base=${baseSha0.slice(0, 8)} qual=${qualSha0.slice(0, 8)}`);

  // ④ 越界声明拒面：shared/**（依赖制品）划 unrelated ⇒ missed-dependency 取该命中为遗漏反例点名拒
  const q2 = fx.lzy(["review", "qualify", baseStem, "--scope", writeDecl("overbroad", { ...GOOD_DECL, rules: [...GOOD_DECL.rules, { pattern: "shared/**", class: "unrelated" }] })]);
  const q2rec = lastScopeRec(fx, "q");
  const q2fail = (q2rec?.rec.challenges ?? []).filter((c) => !c.ok);
  push("s4-qualify-overbroad-rejected", q2.exit === 1 && q2rec?.rec.granted === false && /REJECTED/.test(q2.out) &&
    q2fail.some((c) => c.axis === "missed-dependency" && /shared\/dep-config\.json/.test(c.observed)),
    "越界声明（依赖制品划 unrelated）⇒ 遗漏反例点名 shared/dep-config.json 拒（拒绝也落档）",
    `exit=${q2.exit} granted=${q2rec?.rec.granted} 失败=[${q2fail.map((c) => `${c.axis}:${c.observed}`).join("; ")}]`);

  // ⑤ 修正声明重领：拒绝非终态（同轴同夹具反向——shared/** 收回声明内即过）
  const q3 = fx.lzy(["review", "qualify", baseStem, "--scope", writeDecl("corrected", { ...GOOD_DECL, rules: [...GOOD_DECL.rules, { pattern: "shared/**", class: "in-scope" }] })]);
  const q3rec = lastScopeRec(fx, "q");
  push("s5-qualify-corrected-granted", q3.exit === 0 && q3rec?.rec.granted === true,
    "修正声明（shared/** 收回声明内）⇒ 重领 granted（拒绝非终态，拒绝档仍在案）",
    `exit=${q3.exit} granted=${q3rec?.rec.granted} 档数=${readdirSync(join(fx.d, ".lazyzcode", "review-scope")).filter((x) => /\.q\d+\.json$/.test(x)).length}`);

  // ⑥ 四拒（独立夹具）：逐腿=提交式单路径改变→reuse 逐因 fallback 点名该轴→reset 归位
  const fxr = fixture("scope-reject");
  const runR = fxr.lzy(["review", "run", "--duty", SQS_DUTY, "--timeout-ms", "30000"], engineEnv("green", { LZY_STUB_DUTY: SQS_DUTY, LZY_STUB_LEDGER: "1" }));
  const baseR = `${fxr.slug}.a1.r1`;
  const qR = fxr.lzy(["review", "qualify", baseR, "--scope", writeDecl("reject-good", GOOD_DECL)]);
  const baseShaR = fxr.g(["rev-parse", "HEAD"]).stdout.trim();
  push("s6-reject-fixture-ready", runR.exit === 0 && qR.exit === 0, "拒面夹具 base 运行 + 资格 granted", `run=${runR.exit} qualify=${qR.exit} head=${baseShaR.slice(0, 8)}`);
  const rejectLegs = [
    { id: "s6-reject-env", label: "环境轴漂移（TZ 变体，结构轴短路）", env: { TZ: "Asia/Tokyo" }, reason: /资格身份漂移：env/, path: null },
    { id: "s6-reject-lockfile", label: "锁文件变化（声明共享输入）", mutate: ["package-lock.json", "{}\n{}\n"], reason: /声明内\/共享输入变化：package-lock\.json/, path: "package-lock.json" },
    { id: "s6-reject-checkscript", label: "check 脚本变化（声明内）", mutate: ["scripts/check.sh", "echo changed\n"], reason: /声明内\/共享输入变化：scripts\/check\.sh/, path: "scripts/check.sh" },
    { id: "s6-reject-unknown", label: "未知新文件（未匹配声明）", mutate: ["stranger.txt", "??\n"], reason: /未知路径：stranger\.txt/, path: "stranger.txt" },
  ];
  for (const leg of rejectLegs) {
    if (leg.mutate) {
      writeFileSync(join(fxr.d, ...leg.mutate[0].split("/")), leg.mutate[1]);
      fxr.g(["add", "-A"]);
      fxr.g(["commit", "-qm", `leg ${leg.id}`]);
    }
    const r = fxr.lzy(["review", "reuse", baseR], leg.env);
    const pR = lastScopeRec(fxr, "p");
    const paths = (pR?.rec.diff?.entries ?? []).map((e) => e.path);
    const single = leg.path === null ? paths.length === 0 : paths.length === 1 && paths[0] === leg.path;
    const named = (pR?.rec.reasons ?? []).some((x) => leg.reason.test(x));
    push(leg.id, r.exit === 1 && pR?.rec.verdict === "fallback" && single && named,
      `${leg.label} ⇒ fallback 逐因点名该轴（diff 单路径）`,
      `exit=${r.exit} verdict=${pR?.rec.verdict} entries=[${paths.join(",")}] 逐因=${named} reasons=${(pR?.rec.reasons ?? []).length}`);
    if (leg.mutate) fxr.g(["reset", "--hard", baseShaR]);
  }

  // ⑦ 关闭依据适用性全链：注阻塞发现→resolve→替身 recheck→close→修复区再变化→gate 拦→reopen→复核重关
  const fx2 = fixture("scope-stale");
  const runB = fx2.lzy(["review", "run", "--timeout-ms", "30000"], engineEnv("blocked", { LZY_STUB_LEDGER: "1", LZY_STUB_LOC: "marker.txt:1" }));
  const recB = JSON.parse(readFileSync(runFile(fx2, `${fx2.slug}.a1.r1`), "utf8"));
  push("s7-blocked-ledger", runB.exit === 1 && (recB.findingsLedger?.upserted ?? 0) === 1,
    "替身阻塞运行落账 1 条发现", `exit=${runB.exit} upserted=${recB.findingsLedger?.upserted}`);
  writeFileSync(join(fx2.d, "marker.txt"), "marker\nfixed\n");
  fx2.g(["add", "-A"]);
  fx2.g(["commit", "-qm", "fix"]);
  if (fx2.lzy(["step", "done", "F1", "--evidence", "green rebind: marker.txt present in HEAD tree（fix 后未变面重录）"]).exit !== 0) throw new Error("F1 rebind 失败");
  const fp8 = findingFingerprint8(fx2);
  if (fx2.lzy(["finding", "resolve-request", fp8, "--note", "修复已提交"]).exit !== 0) throw new Error("resolve 失败");
  const rc = fx2.lzy(["review", "recheck", "--timeout-ms", "30000"], engineEnv("green", { LZY_STUB_LEDGER: "1" }));
  const rcStem = lastStem(fx2);
  const closeR = fx2.lzy(["finding", "close", fp8, "--outcome", "fixed", "--basis", "复核不再报", "--recheck", rcStem]);
  push("s7-close-after-recheck", closeR.exit === 0,
    "复核不再报后关闭", `close=${closeR.exit} out=${closeR.out.split("\n")[0]}`);
  // 修复区再变化 ⇒ gate findings 子句 closure-basis-stale 拦
  writeFileSync(join(fx2.d, "marker.txt"), "marker\nfixed\ndrifted\n");
  fx2.g(["add", "-A"]);
  fx2.g(["commit", "-qm", "fix-area drift"]);
  const gate1 = fx2.lzy(["gate", "explain"]);
  push("s7-stale-gate-blocked", gate1.exit !== 0 && /关闭依据/.test(gate1.out),
    "关闭依据候选漂移命中修复区 ⇒ gate 拦", `exit=${gate1.exit} hasStale=${/关闭依据/.test(gate1.out)}`);
  // reopen → 重走复核 → 重关 → gate 翻过
  const ro = fx2.lzy(["finding", "reopen", fp8, "--note", "closure-basis-stale"]);
  const rc2 = fx2.lzy(["review", "recheck", "--timeout-ms", "30000"], engineEnv("green", { LZY_STUB_LEDGER: "1" }));
  const rc2Stem = lastStem(fx2);
  const close2 = fx2.lzy(["finding", "close", fp8, "--outcome", "fixed", "--basis", "重开复核不再报", "--recheck", rc2Stem]);
  const gate2 = fx2.lzy(["gate", "explain"]);
  push("s7-reopen-reclose-ok", ro.exit === 0 && close2.exit === 0 && gate2.exit === 0,
    "reopen→复核重关→gate findings 翻过（曾关闭事实保留）", `ro=${ro.exit} close=${close2.exit} gate=${gate2.exit}`);

  return {
    blocked: null,
    assertions,
    probeBudget: { preregisteredSessions: 0, usedSessions: 0, note: "全替身+机械资格腿（qualify/reuse 不 spawn——拍板 10），零真会话" },
  };
}

// 指纹前 8 位取面（活跃 goal 未关闭集首条——qa 夹具单发现场景）
function findingFingerprint8(fx) {
  const r = fx.lzy(["finding", "list"]);
  const m = /\n\s+([0-9a-f]{8}) \[/.exec("\n" + r.out);
  if (!m) throw new Error(`finding list 无指纹：${r.out}`);
  return m[1];
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

  // 基态正判腿：unsatisfied 全为 review 型义务（底线恒在；M4 N4 职责翻面后夹具声明 check+ci
  // ⇒ 推导 review.verification-deps 同列——M4 收口树 d4c5806 复现同败取证，N7 断言对齐职责表
  // v4 基态义务集）；非 review 型义务与子句全 satisfied。
  const fxBase = fixture("base");
  const geBase = fxBase.lzy(["gate", "explain"]);
  const baseParsed = parseGate(geBase.out);
  const baseUnsat = baseParsed.obligations.filter((o) => o.state !== "satisfied");
  const checkOb = baseParsed.obligations.find((o) => o.id === "check.smoke") ?? null;
  const ciOb = baseParsed.obligations.find((o) => o.id === "ci.required-checks") ?? null;
  push(
    "GATE-base-review-only",
    geBase.exit !== 0 &&
      baseUnsat.length >= 1 &&
      baseUnsat.every((o) => o.type.startsWith("review")) && // 渲染面 baseline 带「·底线」后缀
      baseUnsat.some((o) => o.id === "review.general-correctness") &&
      checkOb?.state === "satisfied" &&
      ciOb?.state === "satisfied" &&
      /三轴满足/.test(checkOb.reasons.join(" ")) &&
      baseParsed.clauses.filter((c) => !c.ok).length === 0,
    "基态（真实成功回执全满足）：unsatisfied 全为 review 型义务（底线+推导专项）；check/ci 义务 satisfied（三轴满足）且无失败子句",
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


// ── 0.4.0 M5 N5：migration-recovery（§8.1 用例一）────────────────────────────
// 用冻结 0.3.1 树（tag v0.3.1 git archive→npm pack）建在途态（goal executing+queue 项+
// budget+done 交付意图），0.4.0 工作树 CLI 三分支（续旧 v1 延续/新注册 v2 策略身份+残缺 v2
// fail-closed/显式 migrate apply）+backup/stage/switch 三相位 SIGKILL 注入重跑恢复+done
// 意图副作用计数不重放。真 CLI 子进程全链；0.3.1 臂离线（假 gh=LZY_GH_BIN、bare 远端）。
function migrationFakeGh() {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const p = process.env.FAKE_GH_STATE;
const args = process.argv.slice(2);
const st = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : { calls: 0, merged: false };
st.calls += 1;
fs.writeFileSync(p, JSON.stringify(st));
const head = process.env.FAKE_GH_HEAD || "";
if (args[0] === "pr" && args[1] === "list") { console.log("[]"); process.exit(0); }
if (args[0] === "pr" && args[1] === "create") { console.log("https://fake/pr/1"); process.exit(0); }
if (args[0] === "pr" && args[1] === "merge") { st.merged = true; fs.writeFileSync(p, JSON.stringify(st)); process.exit(0); }
if (args[0] === "pr" && args[1] === "view") {
  console.log(JSON.stringify({ state: st.merged ? "MERGED" : "OPEN", headRefOid: head, baseRefName: "main", number: 1, url: "https://fake/pr/1", mergeCommit: st.merged ? { oid: "b".repeat(40) } : null }));
  process.exit(0);
}
if (args[0] === "api" && String(args[1] ?? "").includes("check-runs")) { console.log(JSON.stringify([{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }])); process.exit(0); }
console.error("fake-gh 未匹配: " + args.join(" "));
process.exit(1);
`;
}

async function migrationRecoveryCase() {
  const assertions = [];
  const push = (id, ok, expected, observed, evidence) => assertions.push({ id, ok: Boolean(ok), expected, observed: String(observed).slice(0, 600), evidence });
  const CLI040 = join(REPO, "cli", "lzy.js");
  const TRIGGER040 = join(REPO, "plugin", "hooks", "trigger.js");
  const baseEnv = { ...process.env, LZY_ABLATE_HUMAN_GATE: "1" };
  const caseDir = join(fixtureRoot, "migration-recovery");
  rmSync(caseDir, { recursive: true, force: true });
  mkdirSync(caseDir, { recursive: true });
  const sha256Of = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

  // ── 0.3.1 冻结树物化 + npm pack（离线）──
  const rel030 = join(caseDir, "rel030");
  mkdirSync(rel030, { recursive: true });
  const arch = spawnSync("bash", ["-c", `git archive v0.3.1 | tar -x -C '${rel030}'`], { cwd: REPO, encoding: "utf8" });
  if (arch.status !== 0) return { blocked: `v0.3.1 树物化失败：${arch.stderr ?? arch.stdout}`, assertions };
  const CLI030 = join(rel030, "cli", "lzy.js");
  const TRIGGER030 = join(rel030, "plugin", "hooks", "trigger.js");
  const ver030 = JSON.parse(readFileSync(join(rel030, "package.json"), "utf8")).version;
  spawnSync("npm", ["pack", rel030, "--pack-destination", caseDir], { encoding: "utf8", shell: process.platform === "win32", timeout: 120_000 });
  const tarball = readdirSync(caseDir).find((x) => /^lazyzcode-0\.3\.1.*\.tgz$/.test(x)) ?? null;
  const packSha = tarball ? sha256Of(join(caseDir, tarball)) : null;
  push("MR1-frozen031-pack", ver030 === "0.3.1" && packSha != null,
    "冻结 0.3.1 树物化+离线 npm pack（tarball sha256 入账）",
    `version=${ver030} tarball=${tarball ?? "缺席"} sha=${(packSha ?? "").slice(0, 16)}…`,
    "git archive v0.3.1（tag 94a46df）→ npm pack；rel030/package.json 读数");

  // ── 0.3.1 建在途态（真 CLI 全链）──
  const home0 = mkdtempSync(join(tmpdir(), "lzy-qmr-home-"));
  const fx0 = join(caseDir, "migrate-base");
  mkdirSync(fx0, { recursive: true });
  const g0 = (args) => spawnSync("git", args, { cwd: fx0, encoding: "utf8" });
  g0(["init", "-q"]);
  g0(["config", "user.email", "t@l"]);
  g0(["config", "user.name", "t"]);
  writeFileSync(join(fx0, ".gitignore"), ".lazyzcode/\nnode_modules/\n");
  writeFileSync(join(fx0, "a.txt"), "a\n");
  writeFileSync(join(fx0, "contract.md"), "task: mrg legacy\nendpoint: A\nscope: .\nrecipe: none\n\n- [A1] marker works\n");
  writeFileSync(join(fx0, "plan.md"), "- [N1] add marker\n- [F1] marker exists\naccepts: A1\n");
  writeFileSync(join(fx0, "cb.md"), "task: 交付B legacy\nendpoint: B\nscope: .\nrecipe: none\nrepo: Acfufu/mrg-fx\nbase: main\nbranch: legacy-delivery\npr-title: legacy merge\npr-body: body.md\n\n- [A1] merged\n");
  writeFileSync(join(fx0, "body.md"), "pr body\n");
  g0(["add", "-A"]);
  g0(["commit", "-qm", "fixture"]);
  g0(["remote", "add", "origin", join(caseDir, "origin.git")]);
  spawnSync("git", ["init", "-q", "--bare", join(caseDir, "origin.git")]);
  g0(["checkout", "-q", "-b", "legacy-delivery"]);
  writeFileSync(join(fx0, "delivery-marker.txt"), "delivery\n");
  g0(["add", "-A"]);
  g0(["commit", "-qm", "delivery head"]);
  g0(["checkout", "-q", "main"]);
  const lzy030 = (args, extra = {}) => {
    const r = spawnSync(process.execPath, [CLI030, ...args], { cwd: fx0, encoding: "utf8", timeout: 180_000, env: { ...baseEnv, HOME: home0, USERPROFILE: home0, ...extra } });
    return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };
  const hook030 = (prompt) => {
    const r = spawnSync(process.execPath, [TRIGGER030], { cwd: fx0, encoding: "utf8", timeout: 60_000, input: JSON.stringify({ prompt, cwd: fx0, sessionId: "sess_qmr" }), env: { ...baseEnv, HOME: home0, USERPROFILE: home0 } });
    return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };
  const goalPath0 = join(fx0, ".lazyzcode", "loop", "goal.json");
  const readGoal0 = () => JSON.parse(readFileSync(goalPath0, "utf8"));
  let prepFail = null;
  // 相位 bulk（MR10 用）：备份族大文件拖慢 backup/validate、巨型 snapshot 拖慢 stage——
  // 小夹具上 apply 毫秒级跑完，1ms 轮询物理错过（r1 实测 killedAt=done）。
  const bulkDir = join(fx0, ".lazyzcode", "evidence", "bulk");
  mkdirSync(bulkDir, { recursive: true });
  for (let i = 0; i < 1200; i += 1) writeFileSync(join(bulkDir, `bulk-${String(i).padStart(4, "0")}.bin`), Buffer.alloc(16 * 1024, (i % 251)));
  const snapDir = join(fx0, ".lazyzcode", "loop", "snapshots");
  mkdirSync(snapDir, { recursive: true });
  writeFileSync(join(snapDir, "bulk.md"), "# bulk\n" + "- [Fb] line\n".repeat(120_000));
  try {
    if (lzy030(["loop", "register", "mrg", "--title", "legacy in-flight", "--contract", "contract.md"]).exit !== 0) throw new Error("030 register");
    const p1 = lzy030(["loop", "plan", "plan.md"]);
    if (readGoal0().contractPending) {
      const short = readGoal0().contractPending.contractHash.slice(0, 8);
      if (!hook030(`批准 ${short}`).out.includes("Human approval recorded")) throw new Error("030 批准");
      if (lzy030(["loop", "plan", "plan.md"]).exit !== 0) throw new Error("030 采纳");
    } else if (p1.exit !== 0) throw new Error("030 首采");
    if (lzy030(["loop", "start"]).exit !== 0) throw new Error("030 start");
    writeFileSync(join(fx0, "marker.txt"), "marker\n");
    g0(["add", "-A"]);
    g0(["commit", "-qm", "marker"]);
    if (lzy030(["step", "done", "N1", "--note", "legacy step"]).exit !== 0) throw new Error("030 N1");
    if (lzy030(["queue", "add", "legacy item", "--contract", "contract.md", "--plan", "plan.md"]).exit !== 0) throw new Error("030 queue add");
    if (lzy030(["queue", "budget", "--points", "500", "--note", "fixture"]).exit !== 0) throw new Error("030 budget");
    const req = lzy030(["delivery", "request", "B", "--contract", "cb.md"]);
    if (req.exit !== 0) throw new Error(`030 delivery request：${req.out.split("\n")[0]}`);
    const ghState = join(caseDir, "fake-gh-state.json");
    const ghBin = join(caseDir, "fake-gh.cjs");
    writeFileSync(ghBin, migrationFakeGh(), { mode: 0o755 });
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: fx0, encoding: "utf8" }).stdout.trim();
    const ghEnv = { LZY_GH_BIN: ghBin, FAKE_GH_STATE: ghState, FAKE_GH_HEAD: head };
    const act = lzy030(["delivery", "act", "B", "--repo", "Acfufu/mrg-fx", "--branch", "legacy-delivery", "--base", "main", "--head", head, "--pr-title", "legacy merge", "--pr-body-file", "body.md"], ghEnv);
    if (act.exit !== 0) {
      const pend = readFileSync(join(fx0, ".lazyzcode", "delivery", "contracts.json"), "utf8");
      void pend;
      throw new Error(`030 delivery act：${act.out.split("\n")[0]}`);
    }
  } catch (e) {
    prepFail = String(e?.message ?? e).slice(0, 300);
  }
  const goal0 = prepFail ? null : readGoal0();
  const intentsPath = join(fx0, ".lazyzcode", "delivery", "intents.json");
  const intents0 = existsSync(intentsPath) ? JSON.parse(readFileSync(intentsPath, "utf8")) : null;
  const ghRead = existsSync(join(caseDir, "fake-gh-state.json")) ? JSON.parse(readFileSync(join(caseDir, "fake-gh-state.json"), "utf8")) : { calls: 0 };
  push("MR2-legacy-inflight", prepFail == null && goal0?.status === "executing" && goal0?.version === 1,
    "0.3.1 真 CLI 建在途 goal（v1·executing·N1 done）", prepFail ?? `status=${goal0?.status} version=${goal0?.version}`, "goal.json 活体读数");
  const queuePath = join(fx0, ".lazyzcode", "queue", "queue.json");
  const queue0 = existsSync(queuePath) ? JSON.parse(readFileSync(queuePath, "utf8")) : null;
  const budgetPath = join(fx0, ".lazyzcode", "budget", "ledger.json");
  const budgetInQueue = queue0?.budget != null && Number(queue0.budget.pointsLimit ?? queue0.budget.points ?? 0) > 0;
  push("MR3-legacy-queue-budget", queue0?.items?.length === 1 && (existsSync(budgetPath) || budgetInQueue),
    "0.3.1 建队列项+预算入账（loop 外家族：queue budget 段或 budget/ledger.json）",
    `items=${queue0?.items?.length ?? 0} budgetSection=${JSON.stringify(queue0?.budget ?? null)?.slice(0, 120)} ledger=${existsSync(budgetPath)}`, "queue.json/budget 读数");
  const intentDone = (intents0?.intents ?? []).find((it) => it.endpoint === "B");
  push("MR4-legacy-done-intent", intentDone?.status === "done" && ghRead.calls > 0,
    "0.3.1 delivery act B 真链成功：意图 done+假 gh 计数>0（外部动作已发生）",
    `status=${intentDone?.status ?? "缺席"} ghCalls=${ghRead.calls}`, "intents.json+fake-gh-state.json 读数");

  // ── 腿 A：续旧任务（0.4.0 CLI 读/裁旧 v1 goal——政策裁决不适用且字节零触碰）──
  const fxA = join(caseDir, "legA-continue");
  cpSync(fx0, fxA, { recursive: true, verbatimSymlinks: true });
  const goalA0 = sha256Of(join(fxA, ".lazyzcode", "loop", "goal.json"));
  const lzyA = (args) => {
    const r = spawnSync(process.execPath, [CLI040, ...args], { cwd: fxA, encoding: "utf8", timeout: 180_000, env: { ...baseEnv, HOME: home0, USERPROFILE: home0 } });
    return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };
  const stA = lzyA(["loop", "status"]);
  const gateA = lzyA(["gate", "explain"]);
  const goalA1 = sha256Of(join(fxA, ".lazyzcode", "loop", "goal.json"));
  push("MR5-continue-legacy-v1", stA.exit === 0 && gateA.exit === 0 && /政策裁决不适用（v1 旧规则延续）/.test(gateA.out) && goalA1 === goalA0,
    "0.4.0 续旧任务：status 可读+gate v1 延续裁决行+goal.json 字节不变（V13 旧规则带版本标记延续）",
    `status=${stA.exit} gate=${gateA.exit} v1line=${/政策裁决不适用/.test(gateA.out)} bytesUnchanged=${goalA1 === goalA0}`,
    "lzy loop status/gate explain 活体 stdout+goal.json sha 前后对表");

  // ── 腿 B：新注册 v2+残缺 v2 fail-closed ──
  const homeB = mkdtempSync(join(tmpdir(), "lzy-qmr-homeB-"));
  const fxB = join(caseDir, "legB-newreg");
  mkdirSync(fxB, { recursive: true });
  const gB = (args) => spawnSync("git", args, { cwd: fxB, encoding: "utf8" });
  gB(["init", "-q"]);
  gB(["config", "user.email", "t@l"]);
  gB(["config", "user.name", "t"]);
  writeFileSync(join(fxB, ".gitignore"), ".lazyzcode/\n");
  writeFileSync(join(fxB, "contract.md"), "task: mrg new\nendpoint: A\nscope: .\nrecipe: none\n\n- [A1] x\n");
  writeFileSync(join(fxB, "plan.md"), "- [N1] x\n- [F1] y\naccepts: A1\n");
  gB(["add", "-A"]);
  gB(["commit", "-qm", "fixture"]);
  const lzyB = (args) => {
    const r = spawnSync(process.execPath, [CLI040, ...args], { cwd: fxB, encoding: "utf8", timeout: 180_000, env: { ...baseEnv, HOME: homeB, USERPROFILE: homeB } });
    return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };
  const hookB = (prompt) => {
    const r = spawnSync(process.execPath, [TRIGGER040], { cwd: fxB, encoding: "utf8", timeout: 60_000, input: JSON.stringify({ prompt, cwd: fxB, sessionId: "sess_qmrB" }), env: { ...baseEnv, HOME: homeB, USERPROFILE: homeB } });
    return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };
  let newRegOk = false;
  let newRegRead = "";
  try {
    if (lzyB(["loop", "register", "mrgn", "--title", "new v2", "--contract", "contract.md"]).exit !== 0) throw new Error("register");
    if (lzyB(["loop", "plan", "plan.md"]).exit !== 0) {
      const gp = join(fxB, ".lazyzcode", "loop", "goal.json");
      const short = JSON.parse(readFileSync(gp, "utf8")).contractPending?.contractHash?.slice(0, 8);
      if (!short || !hookB(`批准 ${short}`).out.includes("Human approval recorded")) throw new Error("批准");
      if (lzyB(["loop", "plan", "plan.md"]).exit !== 0) throw new Error("采纳");
    }
    if (lzyB(["loop", "start"]).exit !== 0) throw new Error("start");
    newRegOk = true;
  } catch (e) {
    newRegRead = String(e?.message ?? e).slice(0, 200);
  }
  const goalB = newRegOk ? JSON.parse(readFileSync(join(fxB, ".lazyzcode", "loop", "goal.json"), "utf8")) : null;
  const polFiles = newRegOk ? (existsSync(join(fxB, ".lazyzcode", "policy")) ? readdirSync(join(fxB, ".lazyzcode", "policy")).filter((f) => f.endsWith(".json")) : []) : [];
  push("MR6-new-reg-v2-identity", newRegOk && goalB?.version === 2 && goalB?.policy?.schemaVersion === 1 && polFiles.length > 0,
    "0.4.0 新注册=v2 格式带策略身份+策略记录在场", newRegRead || `version=${goalB?.version} policy=${JSON.stringify(goalB?.policy ?? null)} polFiles=${polFiles.length}`,
    "goal.json+policy/ 家族读数");
  const fxB2 = join(caseDir, "legB2-broken-v2");
  cpSync(fxB, fxB2, { recursive: true, verbatimSymlinks: true });
  const goalB2Path = join(fxB2, ".lazyzcode", "loop", "goal.json");
  const broken = JSON.parse(readFileSync(goalB2Path, "utf8"));
  delete broken.policy;
  writeFileSync(goalB2Path, `${JSON.stringify(broken, null, 2)}\n`);
  const gateB2 = lzyB(["gate", "explain"]);
  push("MR7-broken-v2-failclosed", gateB2.exit !== 0 && /策略记录缺席|策略身份/.test(gateB2.out) && !/政策裁决不适用/.test(gateB2.out),
    "残缺 v2（缺策略身份）fail-closed：拒绝走 v2 拒面而非回落 v1 延续（V13 新任务缺策略不能走 legacy）",
    `exit=${gateB2.exit} v2rej=${/策略记录缺席|策略身份/.test(gateB2.out)} legacyFallback=${/政策裁决不适用/.test(gateB2.out)}`,
    "gate explain 活体 stdout（残缺 v2 goal）");

  // ── 腿 C：显式迁移全径（副本上 apply；字节保留+manifest 双读）──
  const fxC = join(caseDir, "legC-migrate");
  cpSync(fx0, fxC, { recursive: true, verbatimSymlinks: true });
  // 字节保留面=基线在场者（0.3.1 预算存 queue 段时 ledger 缺席——如实按在场面断言）
  const byteFaces = ["delivery/intents.json", "budget/ledger.json", "queue/queue.json"]
    .filter((rel) => existsSync(join(fxC, ".lazyzcode", rel)))
    .map((rel) => ({ rel, pre: sha256Of(join(fxC, ".lazyzcode", rel)) }));
  const lzyC = (args) => {
    const r = spawnSync(process.execPath, [CLI040, ...args], { cwd: fxC, encoding: "utf8", timeout: 300_000, env: { ...baseEnv, HOME: home0, USERPROFILE: home0 } });
    return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };
  const mig = lzyC(["migrate", "apply", fxC]);
  const stateC = existsSync(join(fxC, ".lazyzcode", "state.json")) ? JSON.parse(readFileSync(join(fxC, ".lazyzcode", "state.json"), "utf8")) : null;
  const draftC = join(fxC, ".lazyzcode", "drafts", "mrg.draft-contract.md");
  const bytesKept = byteFaces.map((x) => ({ rel: x.rel, kept: sha256Of(join(fxC, ".lazyzcode", x.rel)) === x.pre }));
  let manifestOk = false;
  if (stateC?.lastRunId) {
    const manifest = JSON.parse(readFileSync(join(fxC, ".lazyzcode", "migration", "backup", stateC.lastRunId, "manifest.json"), "utf8"));
    manifestOk = manifest.files.length > 0 && manifest.files.every((m) => sha256Of(join(fxC, ".lazyzcode", "migration", "backup", stateC.lastRunId, m.rel)) === m.sha256);
  }
  push("MR8-migrate-apply-full", mig.exit === 0 && stateC?.stateVersion === "0.4.0" && existsSync(draftC) && /authorization: NONE/.test(readFileSync(draftC, "utf8")),
    "显式迁移全径：state 写入（stateVersion=0.4.0）+草案 authorization NONE", `exit=${mig.exit} stateVersion=${stateC?.stateVersion ?? "缺席"} draft=${existsSync(draftC)}`,
    "lzy migrate apply 活体 stdout+state.json/drafts 读数");
  push("MR9-migrate-bytes-preserved", bytesKept.length >= 2 && bytesKept.every((x) => x.kept) && manifestOk,
    "迁移保字节：intents/预算/队列三族 sha256 前后不变+备份 manifest 逐文件双读一致",
    JSON.stringify(bytesKept), "manifest.json+逐族 sha256 对表");

  // ── 腿 D：backup/stage/switch 三相位 SIGKILL 注入 → 重跑恢复 ──
  const jdirOf = (root) => join(root, ".lazyzcode", "migration", "journal");
  const newestJournal = (root) => {
    const jd = jdirOf(root);
    if (!existsSync(jd)) return null;
    const jf = readdirSync(jd).filter((f) => f.endsWith(".jsonl")).sort().at(-1);
    return jf ? join(jd, jf) : null;
  };
  const killApplyAtPhase = (root, home, phase, timeoutMs = 90_000) =>
    new Promise((res) => {
      const child = spawn(process.execPath, [CLI040, "migrate", "apply", root], { cwd: root, env: { ...baseEnv, HOME: home, USERPROFILE: home }, stdio: "ignore" });
      const started = Date.now();
      const timer = setInterval(() => {
        let lastPhase = null;
        const jp = newestJournal(root);
        try {
          if (jp) {
            const lines = readFileSync(jp, "utf8").trim().split("\n").filter(Boolean);
            lastPhase = lines.length ? JSON.parse(lines.at(-1)).phase : null;
          }
        } catch {}
        const stateIn = existsSync(join(root, ".lazyzcode", "state.json"));
        // switch=提交点（state 最后写）：窗口亚毫秒，物理上常赛完——触发面=相位命中 ∨（switch 点∧state 在场∧done 未记）
        const hit = lastPhase === phase || (phase === "switch" && stateIn && lastPhase !== "done");
        if (hit) {
          clearInterval(timer);
          try { child.kill("SIGKILL"); } catch {}
          res({ killed: true, lastPhase });
          return;
        }
        if (child.exitCode !== null || child.signalCode != null || Date.now() - started > timeoutMs) {
          clearInterval(timer);
          res({ killed: false, lastPhase, exited: child.exitCode !== null || child.signalCode != null });
        }
      }, 1);
    });
  const phaseResults = [];
  for (const phase of ["backup", "stage", "switch"]) {
    const rootP = join(caseDir, `legD-${phase}`);
    cpSync(fx0, rootP, { recursive: true, verbatimSymlinks: true });
    const kill = await killApplyAtPhase(rootP, home0, phase);
    const statePreRerunSha = existsSync(join(rootP, ".lazyzcode", "state.json")) ? sha256Of(join(rootP, ".lazyzcode", "state.json")) : null;
    const rerun = lzyC2(rootP);
    const jp = newestJournal(rootP);
    const lastPhase = jp ? JSON.parse(readFileSync(jp, "utf8").trim().split("\n").filter(Boolean).at(-1)).phase : null;
    const stateOk = existsSync(join(rootP, ".lazyzcode", "state.json")) && JSON.parse(readFileSync(join(rootP, ".lazyzcode", "state.json"), "utf8")).stateVersion === "0.4.0";
    phaseResults.push({ phase, killed: kill.killed, killedAt: kill.lastPhase, rerunExit: rerun.exit, rerunOut: rerun.out.slice(0, 200), lastPhase, stateOk, statePreRerunSha, stateAfterSha: existsSync(join(rootP, ".lazyzcode", "state.json")) ? sha256Of(join(rootP, ".lazyzcode", "state.json")) : null });
  }
  function lzyC2(root) {
    const r = spawnSync(process.execPath, [CLI040, "migrate", "apply", root], { cwd: root, encoding: "utf8", timeout: 300_000, env: { ...baseEnv, HOME: home0, USERPROFILE: home0 } });
    return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }
  for (const x of phaseResults) {
    if (x.phase === "switch" && !x.killed && x.rerunExit === 0) {
      // 赛完形态（提交点窗口亚毫秒，1ms 轮询物理难命中）：重跑=幂等 no-op 且 state 字节
      // 重跑前后不变——「提交点后不重放」的活体等价面（N7 修正：比对基准=重跑前，非首次 run 前）
      x.racedNoop = x.rerunOut.includes("幂等 no-op") || x.rerunOut.includes("已按任务身份");
      x.stateBytesUnchanged = x.statePreRerunSha != null && x.statePreRerunSha === x.stateAfterSha;
    }
  }
  const dOk = phaseResults.every((x) =>
    x.rerunExit === 0 && x.stateOk && (x.killed ? x.lastPhase === "done" : x.phase === "switch" && x.racedNoop && x.stateBytesUnchanged));
  push("MR10-phase-kill-recovery", dOk,
    "backup/stage 活体 SIGKILL+重跑恢复（journal 收尾 done）；switch=击杀 ∨ 赛完-重跑幂等且 state 重跑前后字节不变（提交点后不重放等价面）",
    JSON.stringify(phaseResults), "逐点 killedAt/journal 末相位/state 读数+重跑 stdout");

  // ── 腿 E：done 意图副作用不重放 ──
  const fxE = join(caseDir, "legE-noreplay");
  cpSync(fx0, fxE, { recursive: true, verbatimSymlinks: true });
  const ghStateBefore = JSON.parse(readFileSync(join(caseDir, "fake-gh-state.json"), "utf8")).calls;
  const intentsE0 = sha256Of(join(fxE, ".lazyzcode", "delivery", "intents.json"));
  const rE = spawnSync(process.execPath, [CLI040, "delivery", "act", "B", "--repo", "Acfufu/mrg-fx", "--branch", "legacy-delivery", "--base", "main", "--head", spawnSync("git", ["rev-parse", "HEAD"], { cwd: fxE, encoding: "utf8" }).stdout.trim(), "--pr-title", "again", "--pr-body-file", "body.md"], {
    cwd: fxE, encoding: "utf8", timeout: 180_000, env: { ...baseEnv, HOME: home0, USERPROFILE: home0, LZY_GH_BIN: join(caseDir, "fake-gh.cjs"), FAKE_GH_STATE: join(caseDir, "fake-gh-state.json"), FAKE_GH_HEAD: spawnSync("git", ["rev-parse", "HEAD"], { cwd: fxE, encoding: "utf8" }).stdout.trim() },
  });
  const ghStateAfter = JSON.parse(readFileSync(join(caseDir, "fake-gh-state.json"), "utf8")).calls;
  const intentsE1 = sha256Of(join(fxE, ".lazyzcode", "delivery", "intents.json"));
  push("MR11-done-intent-no-replay", rE.status !== 0 && ghStateAfter === ghStateBefore && intentsE1 === intentsE0,
    "done 意图再 act=拒且假 gh 计数零增、意图账本字节不变（已发生动作不重放）",
    `exit=${rE.status} ghCalls ${ghStateBefore}→${ghStateAfter} intentsUnchanged=${intentsE1 === intentsE0}`,
    "lzy delivery act 活体+fake-gh-state/intents sha 对表");

  return {
    blocked: null,
    assertions,
    probeBudget: { preregisteredSessions: 0, usedSessions: 0, note: "全真 CLI 子进程+假 gh 外发替身+本地 bare 远端，零模型会话（0.3.1 臂无评审机器）" },
  };
}

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
const BT = String.fromCharCode(96);
const fence = (obj) => BT + BT + BT + "json\\n" + JSON.stringify(obj) + "\\n" + BT + BT + BT;
let response = "";
const STUB_DUTY = process.env.LZY_STUB_DUTY ?? "review.general-correctness";
if (leg === "green") {
  response = fence({ duty: STUB_DUTY, verdict: "pass", findings: [], summary: "替身绿例：候选树小而干净，未发现通用正确性缺陷" });
} else if (leg === "blocked") {
  // M3 finding-lifecycle 替身阻塞腿：确定性阻塞发现（title/location 可经 env 注入变体）
  const finding = { id: "F-1", title: process.env.LZY_STUB_TITLE ?? "授权撤回缺陷：已撤销令牌仍可放行", severity: "P1", blocking: true, location: process.env.LZY_STUB_LOC ?? "auth.js:12", evidence: "auth.js 的放行分支未查询撤回账（替身复现体）", summary: "替身阻塞例：授权撤回检查缺席" };
  response = fence({ duty: STUB_DUTY, verdict: "blocked", findings: [finding], summary: "替身阻塞例：授权撤回检查缺席" });
} else if (leg === "parsefail") {
  response = "评审完成，但本腿不产出机器可解析的围栏。";
} else if (leg === "contradiction") {
  response = fence({ duty: "review.general-correctness", verdict: "pass", findings: [{ id: "F-1", title: "stub blocking", severity: "P1", blocking: true, location: "a.txt:1", evidence: "stub", summary: "结构自相矛盾体" }], summary: "pass 与阻塞发现并存" });
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
          duty: { id: "review.general-correctness" }, dutyTableVersion: DUTY_TABLE_VERSION, templateHash: dutyTemplateHash(), // M3 N5 翻面随动（硬编码 2 会让 r6 的判因漂移为规则版本而非封存缺席）
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
      const r = await b.run(fx);
      // M4 N6 修（M3 输入 #5）：expect 此前在循环里丢失——八体断言未被评估、result 仍
      // passed=true 的哑弹面。run 产出 r 后必须过判据。
      if (typeof b.expect === "function") b.expect(fx, r); // 部分体（r5-撤回/r6-伪导入）判据内联在 run/后续体
    } catch (e) {
      push(b.id, false, "体执行+判据无异常", String(e?.message ?? e).slice(0, 200));
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

// ── M3 finding-lifecycle：发现生命周期全链（替身确定性链 + 真会话 recheck 收口腿）──
const FL_CONTRACT_B = "task: finding lifecycle fixture\nendpoint: B\nscope: .\nrecipe: none\nbudget-ref: none\n\n- [A1] marker file works\n";
const FL_DEFECT = "function authorize(token) {\n  // 契约要求：已撤销令牌必须拒绝（见 contract.md A1）。\n  // 缺陷体：本实现直接放行任意令牌——撤回账查询缺席。\n  return { ok: true, token };\n}\n";

async function findingLifecycleCase() {
  const assertions = [];
  const push = (id, ok, expected, observed, evidence) => assertions.push({ id, ok: Boolean(ok), expected, observed: String(observed).slice(0, 600), evidence });
  const CLI = join(REPO, "cli", "lzy.js");
  const TRIGGER = join(REPO, "plugin", "hooks", "trigger.js");
  const caseDir = join(fixtureRoot, "finding-lifecycle");
  rmSync(caseDir, { recursive: true, force: true });
  mkdirSync(caseDir, { recursive: true });
  const stub = writeStubEngine(caseDir);
  const baseEnv = { ...process.env };

  function fixture(name, { contractText = QAR_CONTRACT } = {}) {
    const home = mkdtempSync(join(tmpdir(), `lzy-qafl-${name}-home-`));
    const d = join(caseDir, name);
    mkdirSync(d, { recursive: true });
    const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
    g(["init", "-q"]);
    g(["config", "user.email", "t@l"]);
    g(["config", "user.name", "t"]);
    writeFileSync(join(d, ".gitignore"), ".lazyzcode/\nnode_modules/\n");
    writeFileSync(join(d, "a.txt"), "a\n");
    writeFileSync(join(d, "contract.md"), contractText);
    writeFileSync(join(d, "plan.md"), QAR_PLAN);
    writeFileSync(join(d, "auth.js"), FL_DEFECT);
    g(["add", "-A"]);
    g(["commit", "-qm", "fixture"]);
    const slug = `fl-${name}`;
    const lzy = (args, extra = {}) => {
      const r = spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: "utf8", timeout: 600_000, env: { ...baseEnv, HOME: home, USERPROFILE: home, ...extra } });
      return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    };
    const hook = (prompt) => {
      const r = spawnSync(process.execPath, [TRIGGER], {
        cwd: d, encoding: "utf8", timeout: 30_000,
        input: JSON.stringify({ prompt, cwd: d, sessionId: "sess_qafl" }),
        env: { ...baseEnv, HOME: home, USERPROFILE: home },
      });
      return { exit: r.status, out: r.stdout ?? "" };
    };
    const readGoal = () => JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
    const reg = lzy(["loop", "register", slug, "--title", "t", "--contract", "contract.md"]);
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
    return { d, home, lzy, hook, readGoal, g, slug };
  }

  function readyGoal(fx) {
    const red = fx.lzy(["evidence", "red", "F1", "--evidence", "red: marker.txt absent on baseline tree"]);
    if (red.exit !== 0) throw new Error(`红半失败：${red.out}`);
    writeFileSync(join(fx.d, "marker.txt"), "marker\n");
    fx.g(["add", "-A"]);
    fx.g(["commit", "-qm", "add marker"]);
    if (fx.lzy(["step", "done", "N1", "--note", "add marker file"]).exit !== 0) throw new Error("N1 失败");
    if (fx.lzy(["step", "done", "F1", "--evidence", "green: marker.txt present in HEAD tree"]).exit !== 0) throw new Error("F1 失败");
    return fx;
  }
  const runStub = (fx, leg, extra = {}) => fx.lzy(["review", "run", "--timeout-ms", "30000"], { LZY_ZCODE_ENGINE: stub, LZY_STUB_LEDGER: "1", LZY_STUB_LEG: leg, ...extra });
  const lastRec = (fx) => {
    const dir = join(fx.d, ".lazyzcode", "review");
    const f = readdirSync(dir).filter((x) => x.endsWith(".json")).sort().at(-1);
    return JSON.parse(readFileSync(join(dir, f), "utf8"));
  };
  const fp8Of = (fx) => {
    const p = join(fx.d, ".lazyzcode", "findings", `${fx.slug}.json`);
    return Object.keys(JSON.parse(readFileSync(p, "utf8")).findings)[0].slice(0, 8);
  };
  const readLedger = (fx) => JSON.parse(readFileSync(join(fx.d, ".lazyzcode", "findings", `${fx.slug}.json`), "utf8")).findings;

  // ── 替身确定性链 A：阻塞→finish 必拒（findings 唯一残因）→两次无效→diagnosis-required
  //    →diagnose 重入→recheck 绿→close→gate PASS→finish 过门 ──
  const A = readyGoal(fixture("chain-a"));
  const r1 = runStub(A, "blocked");
  push("a1-blocked-run", r1.exit === 1 && lastRec(A).validity.status === "valid" && lastRec(A).result.verdict === "blocked" && lastRec(A).findingsLedger.upserted === 1,
    "替身阻塞运行 valid 落档且阻塞发现入账（exit 1）", `exit=${r1.exit} validity=${lastRec(A).validity.status} upserted=${lastRec(A).findingsLedger.upserted}`);
  const fpA = fp8Of(A);
  runStub(A, "green"); // 常规绿运行翻满足 review 义务——findings 子句成唯一残因
  const gateOnlyFindings = A.lzy(["gate", "explain"]);
  const finDenied = A.lzy(["loop", "finish"]);
  push("a2-finish-denied", finDenied.exit !== 0 && /findings|阻塞发现/.test(finDenied.out) && /findings/.test(gateOnlyFindings.out),
    "review 义务已满足而未关闭阻塞发现 ⇒ finish 必拒（报文点名 findings）",
    `finExit=${finDenied.exit} gateHasFindings=${/findings/.test(gateOnlyFindings.out)} out=${String(finDenied.out.split("\n").filter((l) => /findings|阻塞/.test(l)).join("|").slice(0, 140))}`);
  push("a3-resolve", A.lzy(["finding", "resolve-request", fpA, "--note", "修复撤回检查"]).exit === 0, "resolve-request 0", "exit=0");
  runStub(A, "blocked");
  let fl = readLedger(A);
  const fpFullA = Object.keys(fl)[0];
  push("a4-invalid-fix-1", fl[fpFullA].invalidFixCount === 1 && fl[fpFullA].status === "open",
    "recheck 仍报=无效修复 1（回 open）", `invalidFixCount=${fl[fpFullA].invalidFixCount} status=${fl[fpFullA].status}`);
  A.lzy(["finding", "resolve-request", fpA]);
  runStub(A, "blocked");
  fl = readLedger(A);
  push("a5-diagnosis-required", fl[fpFullA].status === "diagnosis-required" && fl[fpFullA].invalidFixCount === 2,
    "两次无效修复 ⇒ diagnosis-required", `status=${fl[fpFullA].status} count=${fl[fpFullA].invalidFixCount}`);
  const denied = A.lzy(["finding", "resolve-request", fpA]);
  push("a6-resolve-denied", denied.exit === 1 && /diagnosis-required/.test(denied.out), "diagnosis-required 态 resolve 拒（exit 1）", `exit=${denied.exit} out=${denied.out.slice(0, 100)}`);
  const dg = A.lzy(["finding", "diagnose", fpA, "--root-cause", "公共放行函数未接撤回账（连续两轮同一缺陷）"]);
  push("a7-diagnose-reset", dg.exit === 0, "diagnose 记根因重置（exit 0）", `exit=${dg.exit}`);
  writeFileSync(join(A.d, "auth.js"), "const revokedSet = new Set([\"tok-revoked-001\"]);// 契约 A1：已撤销令牌实钉在案——拒绝分支可达\n\nfunction authorize(token) {\n  if (revokedSet.has(token)) return { ok: false };\n  return { ok: true, token };\n}\n");
  A.g(["add", "-A"]);
  A.g(["commit", "-qm", "fix: revoke check"]);
  // F1 rebind（未变面重录——marker.txt 在 fix 提交后的 HEAD 树仍在场；finish 证据新鲜度要求）
  if (A.lzy(["step", "done", "F1", "--evidence", "green rebind: marker.txt present in HEAD tree（fix 提交后未变面重录）"]).exit !== 0) throw new Error("A rebind 失败");
  A.lzy(["finding", "resolve-request", fpA, "--note", "撤回检查已接入"]);
  const rcClose = A.lzy(["review", "recheck", "--timeout-ms", "30000"], { LZY_ZCODE_ENGINE: stub, LZY_STUB_LEDGER: "1", LZY_STUB_LEG: "green" });
  const closeRec = lastRec(A);
  push("a8-recheck-candidates", rcClose.exit === 0 && Array.isArray(closeRec.findingsLedger.closureCandidates) && closeRec.findingsLedger.closureCandidates.length === 1,
    "recheck 绿 ⇒ 闭候选 1 条（报文指路 close）", `exit=${rcClose.exit} cands=${(closeRec.findingsLedger.closureCandidates ?? []).length}`);
  const cl = A.lzy(["finding", "close", fpA, "--outcome", "fixed", "--basis", "撤回检查已入放行函数（recheck 不再报）", "--recheck", closeRec.runId]);
  push("a9-close-fixed", cl.exit === 0 && /closed-fixed/.test(cl.out), "close fixed 0", `exit=${cl.exit}`);
  const gatePass = A.lzy(["gate", "explain"]);
  const finOk = A.lzy(["loop", "finish"]);
  const attA = existsSync(join(A.d, ".lazyzcode", "attestations")) ? readdirSync(join(A.d, ".lazyzcode", "attestations")).filter((x) => x.endsWith(".json")).length : 0;
  push("a10-gate-finish", gatePass.exit === 0 && /裁决 PASS/.test(gatePass.out) && finOk.exit === 0 && attA === 1,
    "发现全闭 ⇒ gate PASS ⇒ finish 过门落 attestation", `gate=${/裁决 (\S+)/.exec(gatePass.out)?.[1]} finExit=${finOk.exit} att=${attA}`);

  // ── 替身链 B：证伪分支（falsified——替身腿 fixture 标记）──
  const B = readyGoal(fixture("chain-b"));
  runStub(B, "blocked");
  const fpB = fp8Of(B);
  B.lzy(["finding", "resolve-request", fpB, "--note", "原报与代码不符"]);
  // 证伪关闭同样须 recheck 运行（自审 r5-F2 收口——常规运行不构成独立复核）
  B.lzy(["review", "recheck", "--timeout-ms", "30000"], { LZY_ZCODE_ENGINE: stub, LZY_STUB_LEDGER: "1", LZY_STUB_LEG: "green" });
  const lastRunB = lastRec(B).runId;
  const clB = B.lzy(["finding", "close", fpB, "--outcome", "falsified", "--basis", "原报证据与代码不符——撤回账在别处已查（误报证伪）", "--recheck", lastRunB]);
  const flB = readLedger(B);
  push("b1-falsified", clB.exit === 0 && flB[Object.keys(flB)[0]].status === "closed-falsified",
    "证伪分支 close falsified（替身腿，fixture 标记）", `exit=${clB.exit} status=${flB[Object.keys(flB)[0]].status}`);

  // ── 替身链 C：存续（单工作区三面：reset 后同 slug 重注册 / rename relink / supersede）──
  const C = readyGoal(fixture("chain-c"));
  runStub(C, "blocked");
  const fpC = fp8Of(C);
  C.lzy(["loop", "reset"]);
  const rereg = C.lzy(["loop", "register", C.slug, "--title", "t2", "--contract", "contract.md"]);
  if (rereg.exit !== 0) throw new Error(`re-register 失败：${rereg.out}`);
  // 授权绑 contractHash（家族 reset 不清）——同契约重注册首采可能直接过（在案批准仍有效）
  const p1C = C.lzy(["loop", "plan", "plan.md"]);
  if (p1C.exit === 1) {
    const shortC = C.readGoal().contractPending.contractHash.slice(0, 8);
    C.hook(`批准 ${shortC}`);
    if (C.lzy(["loop", "plan", "plan.md"]).exit !== 0) throw new Error("重采纳失败");
  } else if (p1C.exit !== 0) {
    throw new Error(`重注册采纳异常：${p1C.out}`);
  }
  if (C.lzy(["loop", "start"]).exit !== 0) throw new Error("重启失败");
  const listAfterReset = C.lzy(["finding", "list"]);
  push("c1-survives-reset", /未关闭 1/.test(listAfterReset.out) && listAfterReset.out.includes(fpC),
    "reset 后同 slug 发现链存续（未关闭 1）", `out=${String(listAfterReset.out.split("\n").filter((l) => /fl-|未关闭/.test(l)).join("|").slice(0, 140))}`);
  // rename：reset → 同目录新 slug 重注册 → relink 旧→新（旧档同目录在案，并集可读）
  const REN = "fl-chain-c-renamed";
  C.lzy(["loop", "reset"]);
  const rereg2 = C.lzy(["loop", "register", REN, "--title", "t3", "--contract", "contract.md"]);
  if (rereg2.exit !== 0) throw new Error(`改名注册失败：${rereg2.out}`);
  const p1R = C.lzy(["loop", "plan", "plan.md"]);
  if (p1R.exit === 1) {
    const shortR = C.readGoal().contractPending.contractHash.slice(0, 8);
    C.hook(`批准 ${shortR}`);
    if (C.lzy(["loop", "plan", "plan.md"]).exit !== 0) throw new Error("改名采纳失败");
  } else if (p1R.exit !== 0) {
    throw new Error(`改名采纳异常：${p1R.out}`);
  }
  if (C.lzy(["loop", "start"]).exit !== 0) throw new Error("改名 start 失败");
  C.lzy(["finding", "relink", "--from", C.slug, "--to", REN]);
  const listRelinked = C.lzy(["finding", "list", "--goal", REN]);
  const gateRelinked = C.lzy(["gate", "explain"]);
  push("c2-survives-rename", listRelinked.out.includes(fpC) && gateRelinked.out.includes(fpC),
    "relink 后别名链并集可读且 gate 仍拦", `list=${listRelinked.out.includes(fpC)} gateHas=${gateRelinked.out.includes(fpC)}`);
  // supersede（attempt 递进）不洗发现
  writeFileSync(join(C.d, "plan.md"), `${QAR_PLAN}\n<!-- attempt2 supersede probe -->\n`);
  C.g(["add", "-A"]);
  C.g(["commit", "-qm", "plan attempt2"]);
  const sup = C.lzy(["loop", "supersede", "plan.md", "--review", "VERDICT: PASS — attempt2 增补探针注释，义务与验收映射不变"]);
  const listAfterSup = C.lzy(["finding", "list"]);
  push("c3-survives-supersede", sup.exit === 0 && listAfterSup.out.includes(fpC) && C.readGoal().attempt === 2,
    "supersede attempt2 后发现链存续", `supExit=${sup.exit} attempt=${C.readGoal().attempt} list=${listAfterSup.out.includes(fpC)}`);

  // ── 替身链 D：reassess（endpoint B 契约 → 强制拒删 + 取消活体）──
  const D = fixture("chain-d", { contractText: FL_CONTRACT_B });
  const trio = ["--impact", "endpoint B→A（契约改 A）", "--cancel-reason", "交付核对义务适用条件消失", "--basis", "re-derive 不再生成 delivery.audit（ADR-0033 §5）"];
  const denyBaseline = D.lzy(["policy", "reassess", "review.general-correctness", ...trio]);
  push("d1-reassess-baseline-denied", denyBaseline.exit === 1 && /baseline/.test(denyBaseline.out),
    "baseline 义务取消拒（exit 1）", `exit=${denyBaseline.exit}`);
  const denyStillDerived = D.lzy(["policy", "reassess", "delivery.audit", ...trio]);
  push("d2-reassess-derived-denied", denyStillDerived.exit === 1 && /取消无独立依据/.test(denyStillDerived.out),
    "现行推导仍含=取消拒", `exit=${denyStillDerived.exit}`);
  writeFileSync(join(D.d, "contract.md"), QAR_CONTRACT);
  D.g(["add", "-A"]);
  D.g(["commit", "-qm", "endpoint A"]);
  const okCancel = D.lzy(["policy", "reassess", "delivery.audit", ...trio]);
  const showD = D.lzy(["policy", "show"]);
  push("d3-reassess-cancel", okCancel.exit === 0 && !/delivery\.audit \n/.test(`${showD.out}\n`) && !/delivery\.audit$/.test(showD.out.trim().split("\n").filter((l) => /\[.*\] delivery/.test(l)).join("\n")),
    "额外义务取消活体（义务集不再列 delivery.audit）", `exit=${okCancel.exit} showStill=${/\[.*delivery\.audit\]/.test(showD.out)}`);

  // ── 真会话腿（能力探测后；预注册预算内）──
  const cap = {
    auth: detectHeadlessAuth(),
    engine: findEngine(),
    sqlite3: spawnSync("sqlite3", ["--version"], { timeout: 5000 }).status === 0,
  };
  const capMissing = [!cap.auth?.ok && "auth", !cap.engine && "engine", !cap.sqlite3 && "sqlite3"].filter(Boolean);
  const sessions = [];
  let usedSessions = 0;
  if (capMissing.length > 0) {
    push("real-legs", false, "真会话腿可达", `缺 ${capMissing.join("/")}（blocked(3) 具名，不算 SKIP；替身链不能充抵真腿）`);
    return {
      blocked: `真会话腿不可达：缺 ${capMissing.join("/")}（auth/引擎/sqlite3 缺席=blocked(3) 具名，不算 SKIP）`,
      assertions,
      sessions,
      probeBudget: { preregisteredSessions: 12, usedSessions: 0, note: "替身链完成；真会话腿因缺能力未跑" },
    };
  }
  // R1：真实评审对注缺陷夹具——valid+metered 必断言；verdict 如实记录（模型判决不预设）
  const R1 = readyGoal(fixture("real-defect"));
  const t1 = Date.now();
  let rr1 = R1.lzy(["review", "run", "--timeout-ms", "420000"], { LZY_ZCODE_ENGINE: cap.engine });
  usedSessions += 1;
  if (rr1.exit !== 0 && /exit-nonzero|interrupted/.test(rr1.out)) {
    rr1 = R1.lzy(["review", "run", "--timeout-ms", "420000"], { LZY_ZCODE_ENGINE: cap.engine });
    usedSessions += 1;
  }
  const rec1 = lastRec(R1);
  push("r1-real-run", rec1.validity.status === "valid" && rec1.metering.status === "metered" && rec1.metering.points > 0,
    "真实会话 valid metered（对注缺陷夹具；verdict 如实）", `validity=${rec1.validity.status} verdict=${rec1.result?.verdict} points=${rec1.metering.points} wallMs=${Date.now() - t1}`);
  sessions.push({ leg: "real-defect", sessionId: rec1.sessionId, verdict: rec1.result?.verdict ?? null, ledgerUpserted: rec1.findingsLedger?.upserted ?? null });
  // R2：真实 recheck 收口链——替身播种阻塞→修复→resolve→真 recheck→close→finish
  const R2 = readyGoal(fixture("real-close"));
  runStub(R2, "blocked");
  const fpR2 = fp8Of(R2);
  writeFileSync(join(R2.d, "auth.js"), "const revokedSet = new Set([\"tok-revoked-001\"]);// 契约 A1：已撤销令牌实钉在案——拒绝分支可达\n\nfunction authorize(token) {\n  if (revokedSet.has(token)) return { ok: false };\n  return { ok: true, token };\n}\n");
  R2.g(["add", "-A"]);
  R2.g(["commit", "-qm", "fix: revoke check"]);
  // F1 rebind（未变面重录——finish 证据新鲜度要求）
  if (R2.lzy(["step", "done", "F1", "--evidence", "green rebind: marker.txt present in HEAD tree（fix 提交后未变面重录）"]).exit !== 0) throw new Error("R2 rebind 失败");
  if (R2.lzy(["finding", "resolve-request", fpR2, "--note", "撤回检查已接入"]).exit !== 0) throw new Error("R2 resolve 失败");
  const t2 = Date.now();
  let rcReal = R2.lzy(["review", "recheck", "--timeout-ms", "420000"], { LZY_ZCODE_ENGINE: cap.engine });
  usedSessions += 1;
  if (rcReal.exit !== 0 && /exit-nonzero|interrupted/.test(rcReal.out)) {
    rcReal = R2.lzy(["review", "recheck", "--timeout-ms", "420000"], { LZY_ZCODE_ENGINE: cap.engine });
    usedSessions += 1;
  }
  const recR2 = lastRec(R2);
  push("r2-real-recheck", rcReal.exit === 0 && recR2.validity.status === "valid" && recR2.result?.verdict === "pass" && Array.isArray(recR2.findingsLedger.closureCandidates) && recR2.findingsLedger.closureCandidates.length === 1,
    "真实 recheck 绿 ⇒ 闭候选 1（原发现不再报）", `exit=${rcReal.exit} verdict=${recR2.result?.verdict} cands=${(recR2.findingsLedger.closureCandidates ?? []).length} wallMs=${Date.now() - t2}`);
  sessions.push({ leg: "real-recheck", sessionId: recR2.sessionId, verdict: recR2.result?.verdict ?? null });
  if (rcReal.exit === 0 && Array.isArray(recR2.findingsLedger.closureCandidates) && recR2.findingsLedger.closureCandidates.length === 1) {
    const closeReal = R2.lzy(["finding", "close", recR2.findingsLedger.closureCandidates[0].slice(0, 8), "--outcome", "fixed", "--basis", "真实 recheck 不再报——撤回检查已接入", "--recheck", recR2.runId]);
    const gateReal = R2.lzy(["gate", "explain"]);
    const finReal = R2.lzy(["loop", "finish"]);
    const attR2 = existsSync(join(R2.d, ".lazyzcode", "attestations")) ? readdirSync(join(R2.d, ".lazyzcode", "attestations")).filter((x) => x.endsWith(".json")).length : 0;
    push("r2-real-close-finish", closeReal.exit === 0 && finReal.exit === 0 && attR2 === 1,
      "真实全链收口：close→gate→finish attestation", `close=${closeReal.exit} fin=${finReal.exit} att=${attR2}`);
  } else {
    push("r2-real-close-finish", false, "真实全链收口", "前置腿未达（如实判败）");
  }
  console.error(`[v040-qa] finding-lifecycle 真会话腿：${usedSessions} 次（预注册 12 内）`);

  return {
    blocked: null,
    assertions,
    sessions,
    probeBudget: { preregisteredSessions: 12, usedSessions, note: "真会话=注缺陷评审 1 + recheck 收口 1（各含韧性重跑 1 次余量）" },
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
} else if (CASE === "finding-lifecycle") {
  result = await findingLifecycleCase();
} else if (CASE === "scope-qualification") {
  result = await scopeQualificationCase();
} else if (CASE === "migration-recovery") {
  result = await migrationRecoveryCase();
} else {
  die(`未知 --case：${CASE}（capability|capability-meter|gate-matrix|review-runtime|finding-lifecycle|scope-qualification|migration-recovery）`);
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
