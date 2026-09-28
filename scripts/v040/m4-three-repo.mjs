#!/usr/bin/env node
// 0.4.0 M4 N10 三仓真实正反例驱动（goal v040-m4-scope-qualification；V08 出口取证面）。
// 每仓：冻结 HEAD 内容物化开发夹具（git archive <frozenSha> → 新 git 仓）→ 真实专项评审 base
//（真引擎会话，隔离 HOME，metered 入账）→ 无关变化复用 applicable → 声明内变化 fallback + 真实
// 重评 → 未知新文件回退 → 越界声明被遗漏反例点名拒 → base 档与资格档 sha256 前后不变读数。
// 环境不成立（引擎/凭据/冻结 sha 缺席）即如实阻塞该仓腿，不冒充。
//
// 用法：node scripts/v040/m4-three-repo.mjs [--repos lazyzcode,openchamber,zpigeon-ios]
//        [--out-dir artifacts/v040/M4] [--work-dir <夹具根>] [--timeout-ms 600000]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
function parseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next != null && !next.startsWith("--")) {
      f[a.slice(2)] = next;
      i += 1;
    } else f[a.slice(2)] = true;
  }
  return f;
}
const f = parseArgs(process.argv.slice(2));
const REPOS = String(f.repos ?? "lazyzcode,openchamber,zpigeon-ios").split(",").map((s) => s.trim()).filter(Boolean);
const OUT_DIR = resolve(REPO, typeof f["out-dir"] === "string" ? f["out-dir"] : "artifacts/v040/M4");
const WORK_DIR = resolve(typeof f["work-dir"] === "string" ? f["work-dir"] : mkdtempSync(join(tmpdir(), "lzy-m4-3r-")));
const TIMEOUT_MS = f["timeout-ms"] != null ? Number(f["timeout-ms"]) : 600_000;
const CLI = join(REPO, "cli", "lzy.js");
const TRIGGER = join(REPO, "plugin", "hooks", "trigger.js");
const DUTY = "review.verification-deps";

// 仓配置：冻结清单（HEAD 钉值）+ 源码克隆位 + 声明面（in-scope 须对仓现存文件命中；unrelated 同）
const REPO_CONF = {
  lazyzcode: {
    src: REPO,
    manifest: "scripts/evaluation/manifests/m0-freeze-lazyzcode.json",
    inScope: ["core/**", "cli/**", "plugin/**", "scripts/**"],
    unrelated: ["docs/**"],
    changeTarget: "core/review.js",
  },
  openchamber: {
    src: join(homedir(), "Codehub", "openchamber"),
    manifest: "scripts/evaluation/manifests/m0-freeze-openchamber.json",
    inScope: ["packages/**", "src/**"],
    unrelated: ["docs/**"],
    changeTarget: null, // 运行时按声明命中集取首个文件
  },
  "zpigeon-ios": {
    src: join(homedir(), "Codehub", "zpigeon-ios"),
    manifest: "scripts/evaluation/manifests/m0-freeze-zpigeon-ios.json",
    inScope: ["ZPigeon/**", "Sources/**"],
    unrelated: ["docs/**"],
    changeTarget: null,
  },
};

// 迷你 glob（与 core/review.js globToRegExp 同语义的取证侧副本——只读，不 import 被测实现）
function globToRe(pattern) {
  let re = "^";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") { re += "(?:.*/)?"; i += 3; } else { re += ".*"; i += 2; }
    } else if (pattern[i] === "*") { re += "[^/]*"; i += 1; } else if (pattern[i] === "?") { re += "[^/]"; i += 1; } else { re += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); i += 1; }
  }
  return new RegExp(`${re}$`);
}
function treePaths(root) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r);
      else out.push(r);
    }
  };
  walk(root, "");
  return out.sort();
}
const sha256OfFile = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

function runRepo(name) {
  const conf = REPO_CONF[name];
  const leg = { repo: name, frozen: null, ok: false, blocked: null, readings: {}, artifacts: [] };
  const log = [];
  const say = (s) => { log.push(s); console.log(`  [${name}] ${s}`); };
  const outDir = join(OUT_DIR, name);
  mkdirSync(outDir, { recursive: true });
  const writeLog = () => writeFileSync(join(outDir, "leg-log.txt"), `${log.join("\n")}\n`);
  const freeze = readJson(join(REPO, conf.manifest));
  leg.frozen = freeze.frozenHeadSha;
  if (!existsSync(conf.src)) {
    leg.blocked = `源码克隆缺席：${conf.src}`;
    say(`阻塞：${leg.blocked}`);
    writeLog();
    return leg;
  }
  const hasSha = spawnSync("git", ["-C", conf.src, "cat-file", "-e", `${freeze.frozenHeadSha}^{commit}`], { encoding: "utf8" }).status === 0;
  if (!hasSha) {
    leg.blocked = `冻结 sha 不在克隆内：${freeze.frozenHeadSha.slice(0, 12)}（须复核重冻结）`;
    say(`阻塞：${leg.blocked}`);
    writeLog();
    return leg;
  }
  const home = mkdtempSync(join(tmpdir(), `lzy-m4-3r-${name}-home-`));
  const fx = join(WORK_DIR, name);
  rmSync(fx, { recursive: true, force: true });
  mkdirSync(fx, { recursive: true });
  {
    const arch = spawnSync("git", ["-C", conf.src, "archive", freeze.frozenHeadSha], { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 });
    if (arch.status !== 0) { leg.blocked = `git archive 失败：${String(arch.stderr).slice(0, 160)}`; say(`阻塞：${leg.blocked}`); writeLog(); return leg; }
    const tar = join(WORK_DIR, `${name}.tar`);
    writeFileSync(tar, arch.stdout);
    const ext = spawnSync("tar", ["-x", "-f", tar, "-C", fx], { encoding: "utf8" });
    rmSync(tar, { force: true });
    if (ext.status !== 0) { leg.blocked = `tar 解包失败：${String(ext.stderr).slice(0, 160)}`; say(`阻塞：${leg.blocked}`); writeLog(); return leg; }
    const g = (args) => spawnSync("git", args, { cwd: fx, encoding: "utf8" });
    g(["init", "-q"]);
    g(["config", "user.email", "m4@l"]);
    g(["config", "user.name", "m4"]);
    writeFileSync(join(fx, ".gitignore"), `${existsSync(join(fx, ".gitignore")) ? readFileSync(join(fx, ".gitignore"), "utf8") : ""}\n.lazyzcode/\n`);
    g(["add", "-A"]);
    g(["commit", "-qm", `fixture @ ${freeze.frozenHeadSha.slice(0, 8)}`]);
  }
  // 人权门不消融（ADR-0027 口径）：走真实 UPS 批准流量（trigger 钩子记批准），否则 review 前置
  // 「契约授权有效」恒拒（ablate 只跳门不落批准——实测 exit 3，见 leg-log）。
  const baseEnv = { ...process.env, HOME: home, USERPROFILE: home };
  delete baseEnv.LZY_ZCODE_ENGINE; // 真实引擎（本 leg 的判据面——不注入替身）
  const lzy = (args, extra = {}, timeout = TIMEOUT_MS + 60_000) => {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: fx, encoding: "utf8", timeout, env: { ...baseEnv, ...extra } });
    return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, ms: Date.now() - t0 };
  };
  const git = (args) => spawnSync("git", args, { cwd: fx, encoding: "utf8" });
  const commit = (msg) => { git(["add", "-A"]); git(["commit", "-qm", msg]); };
  const paths = treePaths(fx);
  leg.readings.fixtureFiles = paths.length;
  leg.readings.fixtureTree = git(["show", "-s", "--format=%T", "HEAD"]).stdout.trim();
  // 夹具=frozen 内容 + 基线提交（.gitignore 追加 .lazyzcode/——runner 状态面不属候选）
  leg.readings.fixtureNote = `git archive ${freeze.frozenHeadSha.slice(0, 12)} 内容 + 基线提交（.gitignore 追加 .lazyzcode/）`;
  const firstMatch = (pattern) => paths.find((p) => globToRe(pattern).test(p)) ?? null;
  // 共享输入（须在候选中在场——lockfile 轴按声明取值）
  const shared = ["package-lock.json", "pnpm-lock.yaml", "bun.lockb", "yarn.lock", "Package.resolved", "project.yml", "package.json"].find((p) => paths.includes(p)) ?? firstMatch("**/*lock*");
  const decl = {
    dutyId: DUTY,
    rules: [...conf.inScope.map((pattern) => ({ pattern, class: "in-scope" })), ...conf.unrelated.map((pattern) => ({ pattern, class: "unrelated" }))],
    sharedInputs: shared ? [shared] : [],
  };
  const inScopeFile = conf.changeTarget && paths.includes(conf.changeTarget) ? conf.changeTarget : firstMatch(conf.inScope[0]);
  const unrelatedFile = firstMatch(conf.unrelated[0]);
  leg.readings.declaration = decl;
  leg.readings.inScopeFile = inScopeFile;
  leg.readings.unrelatedFile = unrelatedFile;
  if (!inScopeFile || !unrelatedFile || !shared) {
    leg.blocked = `声明面不成立（in-scope=${inScopeFile} unrelated=${unrelatedFile} shared=${shared}）`;
    say(`阻塞：${leg.blocked}`);
    writeLog();
    return leg;
  }
  // 目标全链（register→plan→start→红半→marker→N1/F1 = 评审就绪）
  // 契约与计划落 .lazyzcode/（gitignore 面）——输入工件不进候选树，复用 diff 面保持纯净。
  mkdirSync(join(fx, ".lazyzcode"), { recursive: true });
  writeFileSync(join(fx, ".lazyzcode", "m4-contract.md"), "task: m4 three-repo leg\nendpoint: A\nscope: .\nrecipe: none\nbudget-ref: none\n\n- [A1] fixture leg\n");
  const reg = lzy(["loop", "register", `m4-${name}`, "--title", `M4 three-repo ${name}`, "--contract", ".lazyzcode/m4-contract.md"]);
  if (reg.exit !== 0) { leg.blocked = `register 失败：${reg.out.split("\n")[0]}`; say(`阻塞：${leg.blocked}`); writeLog(); return leg; }
  writeFileSync(join(fx, ".lazyzcode", "plan.md"), "- [N1] fixture step\n- [F1] fixture marker\naccepts: A1\n");
  const p1 = lzy(["loop", "plan", ".lazyzcode/plan.md"]);
  const goal = readJson(join(fx, ".lazyzcode", "loop", "goal.json"));
  if (goal.contractPending) {
    const ap = spawnSync(process.execPath, [TRIGGER], { cwd: fx, encoding: "utf8", timeout: 30_000, input: JSON.stringify({ prompt: `批准 ${goal.contractPending.contractHash.slice(0, 8)}`, cwd: fx, sessionId: "sess_m4_3r" }), env: baseEnv });
    if (!(ap.stdout ?? "").includes("Human approval recorded")) { leg.blocked = `批准未记录：${String(ap.stdout).slice(0, 120)}`; say(`阻塞：${leg.blocked}`); writeLog(); return leg; }
    const p2 = lzy(["loop", "plan", ".lazyzcode/plan.md"]);
    if (p2.exit !== 0) { leg.blocked = `采纳失败：${p2.out.split("\n")[0]}`; say(`阻塞：${leg.blocked}`); writeLog(); return leg; }
  } else if (p1.exit !== 0) { leg.blocked = `首采异常：${p1.out.split("\n")[0]}`; say(`阻塞：${leg.blocked}`); writeLog(); return leg; }
  const st = lzy(["loop", "start"]);
  if (st.exit !== 0) { leg.blocked = `start 失败：${st.out.split("\n")[0]}`; say(`阻塞：${leg.blocked}`); writeLog(); return leg; }
  if (lzy(["evidence", "red", "F1", "--evidence", "red: marker absent on baseline tree"]).exit !== 0) { leg.blocked = "红半失败"; say(`阻塞：${leg.blocked}`); writeLog(); return leg; }
  writeFileSync(join(fx, "m4-marker.txt"), "marker\n");
  commit("marker");
  lzy(["step", "done", "N1", "--note", "fixture step"]);
  lzy(["step", "done", "F1", "--evidence", "green: marker present"]);
  // 声明档落夹具外（仓内=候选污染）
  const declPath = join(WORK_DIR, `${name}.decl.json`);
  writeFileSync(declPath, JSON.stringify(decl));
  // 越界声明=把依赖制品（json 面）划 unrelated。规则序=首匹配，故须**前置**——追加在 in-scope
  // 宽模式（如 ZPigeon/**、packages/**）之后会被其先命中而完全无效（N10 首跑 zpigeon 实测：
  // 追加版 granted=true 未被点名拒，leg 记 PARTIAL）。
  const overbroad = { ...decl, rules: [{ pattern: "**/*.json", class: "unrelated" }, ...decl.rules] };
  const overPath = join(WORK_DIR, `${name}.decl-overbroad.json`);
  writeFileSync(overPath, JSON.stringify(overbroad));
  say(`夹具就绪 files=${paths.length} tree=${leg.readings.fixtureTree.slice(0, 12)} inScope=${inScopeFile} unrelated=${unrelatedFile} shared=${shared}`);
  // ① 真实专项评审 base（真会话；metered 入账）
  const baseStem = `m4-${name}.a1.r1`;
  const baseRun = lzy(["review", "run", "--duty", DUTY, "--timeout-ms", String(TIMEOUT_MS)]);
  writeFileSync(join(outDir, "base-run.stdout.txt"), `### lzy review run --duty ${DUTY}（exit=${baseRun.exit} ${baseRun.ms}ms）\n${baseRun.out}\n`);
  leg.artifacts.push("base-run.stdout.txt");
  const runFile = join(fx, ".lazyzcode", "review", `${baseStem}.json`);
  const rec = existsSync(runFile) ? readJson(runFile) : null;
  leg.readings.base = rec ? { runId: rec.runId, validity: rec.validity?.status, metering: rec.metering?.status, points: rec.metering?.points, verdict: rec.result?.verdict, sessionId: rec.sessionId, findings: (rec.result?.findings ?? []).length } : null;
  say(`base 运行 exit=${baseRun.exit} validity=${rec?.validity?.status} metering=${rec?.metering?.status} points=${rec?.metering?.points} verdict=${rec?.result?.verdict} session=${rec?.sessionId ?? "-"}`);
  if (!rec || rec.validity?.status !== "valid" || rec.result?.verdict !== "pass") {
    leg.blocked = `base 运行未达 valid∧pass（validity=${rec?.validity?.status ?? "档缺席"} verdict=${rec?.result?.verdict ?? "-"}）`
      + (rec?.validity?.reason ? ` reason=${rec.validity.reason}` : "");
    say(`阻塞（如实，不冒充）：${leg.blocked}`);
    writeLog();
    return leg;
  }
  const baseSha0 = sha256OfFile(runFile);
  // ② 资格挑战（机械；三仓声明对表）
  const q1 = lzy(["review", "qualify", baseStem, "--scope", declPath]);
  writeFileSync(join(outDir, "qualify.stdout.txt"), `### lzy review qualify ${baseStem} --scope <仓声明白>（exit=${q1.exit}）\n${q1.out}\n`);
  leg.artifacts.push("qualify.stdout.txt");
  const scopeDir = join(fx, ".lazyzcode", "review-scope");
  const qFiles = () => (existsSync(scopeDir) ? readdirSync(scopeDir).filter((x) => /\.q\d+\.json$/.test(x)).map((x) => ({ file: join(scopeDir, x), rec: readJson(join(scopeDir, x)) })) : []);
  const q1rec = qFiles().at(-1)?.rec ?? null;
  const q1file = qFiles().at(-1)?.file ?? null;
  const q1failed = (q1rec?.challenges ?? []).filter((c) => !c.ok);
  leg.readings.qualification = { id: q1rec?.id ?? null, granted: q1rec?.granted ?? null, failed: q1failed.map((c) => `${c.axis}:${c.observed}`) };
  say(`qualify exit=${q1.exit} granted=${q1rec?.granted} 失败轴=${q1failed.map((c) => c.axis).join(",") || "无"}`);
  if (q1rec?.granted !== true) {
    leg.blocked = `资格未授予（${q1failed.map((c) => `${c.axis}:${c.observed}`).join("; ") || "无档"}）——复用腿不可达`;
    say(`阻塞（如实）：${leg.blocked}`);
  } else {
    const qualSha0 = sha256OfFile(q1file);
    // ③ 无关变化 ⇒ 复用 applicable
    writeFileSync(join(fx, unrelatedFile), `${readFileSync(join(fx, unrelatedFile), "utf8")}\n<!-- m4 unrelated -->\n`);
    commit("unrelated change");
    const u1 = lzy(["review", "reuse", baseStem]);
    const pRec = () => {
      const fs2 = existsSync(scopeDir) ? readdirSync(scopeDir).filter((x) => /\.p\d+\.json$/.test(x)).map((x) => readJson(join(scopeDir, x))) : [];
      return fs2.at(-1) ?? null;
    };
    const p1rec = pRec();
    writeFileSync(join(outDir, "reuse-unrelated.stdout.txt"), `### lzy review reuse ${baseStem}（无关变化；exit=${u1.exit}）\n${u1.out}\n`);
    leg.artifacts.push("reuse-unrelated.stdout.txt");
    leg.readings.reuseUnrelated = { exit: u1.exit, id: p1rec?.id ?? null, verdict: p1rec?.verdict ?? null, entries: (p1rec?.diff?.entries ?? []).map((e) => e.path), reasons: (p1rec?.reasons ?? []).length };
    say(`reuse(无关) exit=${u1.exit} verdict=${p1rec?.verdict} entries=${(p1rec?.diff?.entries ?? []).map((e) => e.path).join(",")}`);
    // ④ 声明内变化 ⇒ 复用 fallback + 真实重评（第二真实会话）
    writeFileSync(join(fx, inScopeFile), `${readFileSync(join(fx, inScopeFile), "utf8")}\n// m4 in-scope change\n`);
    commit("in-scope change");
    const u2 = lzy(["review", "reuse", baseStem]);
    const p2rec = pRec();
    const re = lzy(["review", "run", "--duty", DUTY, "--timeout-ms", String(TIMEOUT_MS)]);
    writeFileSync(join(outDir, "reuse-inscope-and-reeval.stdout.txt"), `### lzy review reuse ${baseStem}（声明内变化；exit=${u2.exit}）\n${u2.out}\n\n### lzy review run（真实重评；exit=${re.exit} ${re.ms}ms）\n${re.out}\n`);
    leg.artifacts.push("reuse-inscope-and-reeval.stdout.txt");
    const reStem = existsSync(join(fx, ".lazyzcode", "review"))
      ? readdirSync(join(fx, ".lazyzcode", "review")).filter((x) => x.endsWith(".json")).map((x) => x.slice(0, -5)).sort((a, b) => Number(a.split(".r")[1]) - Number(b.split(".r")[1])).at(-1)
      : null;
    const reRec = reStem ? readJson(join(fx, ".lazyzcode", "review", `${reStem}.json`)) : null;
    leg.readings.reuseInScope = { exit: u2.exit, verdict: p2rec?.verdict ?? null, reasons: (p2rec?.reasons ?? []).slice(0, 2) };
    leg.readings.reeval = reRec ? { runId: reRec.runId, validity: reRec.validity?.status, metering: reRec.metering?.status, points: reRec.metering?.points, verdict: reRec.result?.verdict, sessionId: reRec.sessionId } : null;
    say(`reuse(声明内) exit=${u2.exit} verdict=${p2rec?.verdict} 因=${(p2rec?.reasons ?? []).length} | 重评 exit=${re.exit} validity=${reRec?.validity?.status} points=${reRec?.metering?.points}`);
    // ⑤ 未知新文件 ⇒ 回退
    writeFileSync(join(fx, "m4-stranger.txt"), "unknown\n");
    commit("unknown new file");
    const u3 = lzy(["review", "reuse", baseStem]);
    const p3rec = pRec();
    leg.readings.reuseUnknown = { exit: u3.exit, verdict: p3rec?.verdict ?? null, namedUnknown: (p3rec?.reasons ?? []).some((x) => /m4-stranger\.txt/.test(x)) };
    say(`reuse(未知) exit=${u3.exit} verdict=${p3rec?.verdict} 点名=${leg.readings.reuseUnknown.namedUnknown}`);
    // ⑥ 越界声明 ⇒ 遗漏反例点名拒（拒绝也落档）
    const q2 = lzy(["review", "qualify", baseStem, "--scope", overPath]);
    const q2rec = qFiles().at(-1)?.rec ?? null;
    const q2fail = (q2rec?.challenges ?? []).filter((c) => !c.ok);
    writeFileSync(join(outDir, "qualify-overbroad.stdout.txt"), `### lzy review qualify ${baseStem} --scope <越界声明>（exit=${q2.exit}）\n${q2.out}\n`);
    leg.artifacts.push("qualify-overbroad.stdout.txt");
    leg.readings.qualificationOverbroad = { exit: q2.exit, granted: q2rec?.granted ?? null, failed: q2fail.map((c) => `${c.axis}:${c.observed}`) };
    say(`qualify(越界) exit=${q2.exit} granted=${q2rec?.granted} 失败=${q2fail.map((c) => c.axis).join(",") || "无"}`);
    // ⑦ 字节不变读数（base 运行档 + 首个资格档）
    leg.readings.byteStable = { baseRunUnchanged: sha256OfFile(runFile) === baseSha0, qualificationUnchanged: sha256OfFile(q1file) === qualSha0 };
    say(`字节不变 base=${leg.readings.byteStable.baseRunUnchanged} 资格档=${leg.readings.byteStable.qualificationUnchanged}`);
    leg.ok = Boolean(leg.readings.reuseUnrelated.verdict === "applicable" && leg.readings.reuseInScope.verdict === "fallback" && leg.readings.reuseUnknown.verdict === "fallback" && leg.readings.qualificationOverbroad.granted === false);
  }
  writeLog();
  rmSync(home, { recursive: true, force: true });
  return leg;
}

// ── 驱动 ──────────────────────────────────────────────────────────────────
console.log(`[m4-3r] repos=${REPOS.join(",")} out=${OUT_DIR} work=${WORK_DIR} timeout=${TIMEOUT_MS}ms`);
const legs = [];
for (const name of REPOS) {
  if (!REPO_CONF[name]) { console.error(`[m4-3r] 未知仓：${name}`); process.exitCode = 2; continue; }
  console.log(`\n== ${name} ==`);
  legs.push(runRepo(name));
}
// 汇总合并：单仓重跑（--repos 子集）不抹掉其它仓的在案读数
const summaryPath = join(OUT_DIR, "summary.json");
let prior = null;
try {
  prior = JSON.parse(readFileSync(summaryPath, "utf8"));
} catch {
  prior = null;
}
const priorLegs = Array.isArray(prior?.legs) ? prior.legs.filter((l) => !legs.some((n) => n.repo === l.repo)) : [];
const summary = { schemaVersion: 1, at: new Date().toISOString(), timeoutMs: TIMEOUT_MS, legs: [...legs, ...priorLegs] };
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\n[m4-3r] 汇总（本次跑 ${legs.length} 腿，合并后 ${summary.legs.length} 腿）：`);
for (const l of legs) console.log(`  ${l.repo}: ${l.blocked ? `BLOCKED（${l.blocked}）` : l.ok ? "OK（三腿与越界拒面齐备）" : "PARTIAL"}`);
console.log(`  → ${join(OUT_DIR, "summary.json")}`);
