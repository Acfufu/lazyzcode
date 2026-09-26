#!/usr/bin/env node
// 0.4.0 M0 能力探针驱动器（goal v040-m0-capability）
//
// 用法：
//   node scripts/v040/qa.mjs --case capability --fixture <隔离根> --out <证据根> [--keep] [--session-timeout-ms N]
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
//   2. 真实会话消耗计入宿主计费库——这正是计量腿的被测面；预算预注册 ≤8 会话（本案例 5）。
//   3. win32 未核（spawn 信号语义差异）；本工具按 unix/macOS QA 面使用。
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { findEngine } from "../../core/paths.js";
import { detectHeadlessAuth, spawnHeadless } from "../../core/headless.js";
import { querySessionPoints } from "../../core/cost.js";

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
  console.log(`用法: node scripts/v040/qa.mjs --case <id> --fixture <隔离根> --out <证据根> [--session-timeout-ms N]

案例:
  capability   M0 能力探针（隔离/负对照/计量/击杀续跑，真实引擎会话 5 次）
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

  // ── 腿 4：计量（对两个隔离会话逐 sessionId 读数＋重复读数恒等）───────────
  const metering = [];
  for (const s of isoLegs) {
    if (!s.sessionId) {
      metering.push({ leg: s.leg, sessionId: null, category: "no-session-id", points: null, readback2: null });
      continue;
    }
    const p1 = await querySessionPoints(s.sessionId);
    const p2 = await querySessionPoints(s.sessionId);
    s.pointsReadbacks = [p1, p2];
    metering.push({
      leg: s.leg,
      sessionId: s.sessionId,
      category: p1.absent ? "metering-absent" : p1.unpriced.length > 0 ? `unpriced:${p1.unpriced.join(",")}` : "priced",
      points: p1.points,
      readback2: p2.points,
      identical: p1.points === p2.points && JSON.stringify(p1.unpriced) === JSON.stringify(p2.unpriced),
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
  const killedReadback1 = killedSessionId ? await querySessionPoints(killedSessionId) : null;
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
    const killedReadback2 = await querySessionPoints(killedSessionId);
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

  // 计量
  const meteringOk = metering.every((m) => m.category === "priced" && m.points > 0);
  push("MET-1", meteringOk,
    "计量归因：两个完成会话逐 sessionId 积分非零（absent/unpriced ⇒ 计量能力不成立转阻塞）",
    metering.map((m) => `${m.leg}:${m.category}:${m.points}`).join(" "), "querySessionPoints 读数（result.json metering 节）");
  push("MET-2", metering.every((m) => m.identical !== false),
    "不双计：同 sessionId 二次读数恒等", metering.map((m) => `${m.leg}:${m.identical}`).join(" "), "querySessionPoints 二次读数");

  // 击杀/重启
  push("KILL-1", startObservedAt != null,
    "可观测启动事件：隔离 HOME 转录文件在场后才击杀", `startObservedAt=${startObservedAt ?? "never"}`, "artifacts/.../kill-resume.stdout.txt");
  push("KILL-2", killSignal === "SIGKILL" && killedReadback1 != null && killedReadback1.absent === true,
    "击杀读回诚实：SIGKILL 在途且账本零行（killed-inflight 假零形态显式申报，不计为零消耗）",
    `signal=${killSignal} killedReadback=${JSON.stringify(killedReadback1)}`, "artifacts/.../kill-resume.stdout.txt");
  push("KILL-3", resume != null && resume.ok && resume.sameSessionId && resume.pointsAfterResume > 0,
    "重启只续评：--resume 同 sessionId 续跑完成且消耗并入同 sessionId 计量",
    resume ? `ok=${resume.ok} sameSid=${resume.sameSessionId} points=${resume.pointsAfterResume}` : "resume 未执行", "artifacts/.../kill-resume.stdout.txt");
  push("KILL-4", newPassLike.length === 0,
    "重启不产权状：夹具与证据根前后差集中零 PASS/attestation 形态新文件",
    newPassLike.length === 0 ? "diff 干净" : newPassLike.slice(0, 3).join("; "), "前后清单快照（result.json snapshots 节）");

  // 计量缺席/未计价 ⇒ M0 出口「计量不成立则阻塞」；轨迹不可核验同法
  let blocked = null;
  const trajUnverifiable = isoLegs.some((s) => !s.transcriptInIsolatedHome || !s.transcriptHasToolReads);
  const meteringDead = isoLegs.length === 2 && metering.some((m) => m.category !== "priced");
  if (meteringDead) blocked = "计量腿：完成会话的账本读数 absent/unpriced——逐 sessionId 归因能力不成立（M0 出口报阻塞）";
  else if (trajUnverifiable) blocked = "隔离腿：转录缺席或不含工具读取记录——读取轨迹不可核验，隔离能力未证（M0 出口报阻塞）";

  return {
    blocked,
    cap,
    assertions,
    steps,
    sessions,
    metering,
    kill: { ...kill, killCode, killSignal, startObservedAt, killedSessionId, resume },
    probeBudget: {
      preregisteredSessions: PREREGISTERED_SESSIONS,
      usedSessions: sessions.length + 1, // 隔离2+负对照1+击杀1+续跑1
      note: "预注册 ≤8；失败即数据；探针不计入 M5 正式 36 次",
    },
    snapshots: { before: snapshotBefore, after: snapshotAfter },
  };
}

// ── 执行 ───────────────────────────────────────────────────────────────────
const started = nowIso();
let result;
if (CASE === "capability") {
  result = await capabilityCase();
} else {
  die(`未知 --case：${CASE}（capability）`);
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
  assertions,
  snapshots: result.snapshots ?? null,
};
writeFileSync(join(outDir, "result.json"), `${JSON.stringify(resultJson, null, 2)}\n`);

console.log(`[v040-qa] case=${CASE} passed=${passed}${result.blocked ? ` BLOCKED: ${result.blocked}` : ""}`);
for (const a of assertions) console.log(`  ${a.ok ? "✔" : "✖"} ${a.id} ${a.expected}｜observed: ${a.observed}`);
console.log(`  result.json → ${join(outDir, "result.json")}`);
if (result.blocked != null) process.exit(3);
process.exit(passed ? 0 : 1);
