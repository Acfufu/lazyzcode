#!/usr/bin/env node
// INV-08 红绿同源 harness（0.4.0 M4 N9；goal v040-m4-scope-qualification，计划 N9/F5 附注红绿 mapping）。
// 冻结入口脚本：--root <被测树> 动态以子进程驱动被测树的 CLI（本进程**不 import**被测树任何
// 模块——观察面独立于被测版本），只记观察不做断言；断言=对照面（F5 comparator）的活。
// 两半同脚本同 env（夹具 HOME 隔离 + LZY_ZCODE_ENGINE 指替身 + LZY_ABLATE_HUMAN_GATE=1）：
//   绿半=工作树（--root <repo>）；红半=git archive 245a7ec（M3 收口冻结树，写定时钉定）
//   | tar -x 解出的改前树（--source <sha> 记录出处）。
// 观察面（红半判据=三改前行为，计划 N9）：
//   D1 命令族：review qualify / review reuse / finding reopen（红半=未知命令；绿半=在案命令，
//      前置/用法拒面与未知命令可辨）+ 绿半专项运行 r1 在案（红半=职责不在表 v3）
//   D2 review-scope 家族写入：qualify 落档 granted + reuse 落档 applicable/fallback 逐因
//      （红半=目录不在场——命令缺则零写入）
//   D3 gate 复用腿实拦：同代次专项 r1（C0）+ 现行基线运行与 check 回执（C1）下
//      — C1（无关变化+applicable 适用档）⇒ 复用链满足专项义务（绿半可满足；红半无该义务）
//      — C2（未知新文件使最新适用档 fallback）⇒ 复用不足因阻塞（绿半实拦点名未知路径）
// 用法：node scripts/v040/m4-scope-harness.mjs --root <被测树> [--source <sha>] --out <观察.json>
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { recordAuthorization } from "../../core/contract.js"; // 器具内部件：夹具授权落档（非观察面）

function parseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith("--")) {
      f[key] = next;
      i += 1;
    } else f[key] = true;
  }
  return f;
}
const f = parseArgs(process.argv.slice(2));
const ROOT = resolve(typeof f.root === "string" ? f.root : ".");
const SOURCE = typeof f.source === "string" ? f.source : null;
const OUT = typeof f.out === "string" ? f.out : null;
if (f.help === true) {
  console.log("用法: m4-scope-harness.mjs --root <被测树> [--source <sha>] --out <观察.json>");
  process.exit(0);
}
if (!OUT) {
  console.error("[m4-harness] 缺 --out <观察.json>（观察面落盘）");
  process.exit(2);
}

const CLI = join(ROOT, "cli", "lzy.js");
const TRIGGER = join(ROOT, "plugin", "hooks", "trigger.js");
const NODE = process.execPath;
const CONTRACT = "task: scope harness fixture\nendpoint: A\nscope: .\nrecipe: none\nbudget-ref: none\n\n- [A1] marker file works\n";
const PLAN = "- [N1] add marker file\n- [F1] marker exists\naccepts: A1\n";
const DUTY = "review.verification-deps";

const observations = [];
const obs = (id, observed, detail, raw) => observations.push({ id, observed, detail: String(detail ?? "").slice(0, 400), raw: raw ? String(raw).slice(0, 2000) : null });

// 替身引擎（绿腿：pass 围栏回显请求职责 + 写约定转录 + 子账本行——真实运行产物不植入）。
function writeStub(dir) {
  const p = join(dir, "stub-engine.cjs");
  writeFileSync(
    p,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const home = process.env.HOME ?? process.env.USERPROFILE;
const cwd = process.cwd();
const sessionId = "sess-m4h-" + (process.env.LZY_STUB_SID ?? "1");
const duty = process.env.LZY_STUB_DUTY ?? "review.general-correctness";
fs.mkdirSync(path.join(home, ".zcode", "cli", "rollout"), { recursive: true });
fs.writeFileSync(path.join(home, ".zcode", "cli", "rollout", "model-io-" + sessionId + ".jsonl"),
  JSON.stringify({ tool: "read", file_path: path.join(cwd, "a.txt") }) + "\\n");
{
  const db = path.join(home, ".zcode", "cli", "db", "db.sqlite");
  fs.mkdirSync(path.dirname(db), { recursive: true });
  spawnSync("sqlite3", [db, "CREATE TABLE IF NOT EXISTS model_usage (session_id TEXT, model_id TEXT, started_at INTEGER, input_tokens INTEGER, cache_read_input_tokens INTEGER, output_tokens INTEGER, status TEXT); INSERT INTO model_usage VALUES ('" + sessionId + "', 'glm-5.3-flash', 1, 100000, 0, 1000, 'completed');"]);
}
const BT = String.fromCharCode(96);
const response = BT + BT + BT + "json\\n" + JSON.stringify({ duty, verdict: "pass", findings: [], summary: "m4 harness 替身绿例" }) + "\\n" + BT + BT + BT;
process.stdout.write(JSON.stringify({ sessionId, response, usage: { input_tokens: 1, output_tokens: 1 } }) + "\\n");
`,
    { mode: 0o755 },
  );
  return p;
}

// ── 夹具（v2 目标全链 + 评审就绪态 C0）──────────────────────────────────────
// 清单声明 check 配方（派生 review.verification-deps 专项义务）+ 声明三轴可用文件面
// （src=声明内 / docs=可保持 / scripts=声明内 / 锁文件+JSON 齐备——随包套件各轴可解析）。
const work = mkdtempSync(join(tmpdir(), "lzy-m4h-"));
const stub = writeStub(work);
const fxHome = mkdtempSync(join(tmpdir(), "lzy-m4h-home-"));
const fx = join(work, "fixture");
for (const sub of ["docs", "src", "scripts"]) mkdirSync(join(fx, sub), { recursive: true });
{
  const g = (args) => spawnSync("git", args, { cwd: fx, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(fx, ".gitignore"), ".lazyzcode/\nnode_modules/\n");
  writeFileSync(join(fx, "a.txt"), "a\n");
  writeFileSync(join(fx, "docs", "readme.md"), "# doc\n");
  writeFileSync(join(fx, "src", "util.js"), "export const a=1;\n");
  writeFileSync(join(fx, "scripts", "check.sh"), "echo ok\n");
  writeFileSync(join(fx, "package-lock.json"), "{}\n");
  writeFileSync(join(fx, "lzy.project.json"), `${JSON.stringify({ schemaVersion: 1, capabilities: { check: [{ id: "build", argv: [NODE, "--version"] }] } }, null, 2)}\n`);
  writeFileSync(join(fx, "contract.md"), CONTRACT);
  writeFileSync(join(fx, "plan.md"), PLAN);
  g(["add", "-A"]);
  g(["commit", "-qm", "fixture"]);
}
const baseEnv = { ...process.env, HOME: fxHome, USERPROFILE: fxHome, LZY_ABLATE_HUMAN_GATE: "1" };
const lzy = (args, extra = {}, timeout = 300_000) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: fx, encoding: "utf8", timeout, env: { ...baseEnv, ...extra } });
  return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const git = (args) => spawnSync("git", args, { cwd: fx, encoding: "utf8" }).status;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const runRec = (stem) => join(fx, ".lazyzcode", "review", `${stem}.json`);
{
  const reg = lzy(["loop", "register", "m4h", "--title", "t", "--contract", "contract.md"]);
  if (reg.exit !== 0) throw new Error(`register 失败：${reg.out}`);
  const p1 = lzy(["loop", "plan", "plan.md"]);
  const goal = readJson(join(fx, ".lazyzcode", "loop", "goal.json"));
  if (goal.contractPending) {
    const ap = spawnSync(process.execPath, [TRIGGER], {
      cwd: fx, encoding: "utf8", timeout: 30_000,
      input: JSON.stringify({ prompt: `批准 ${goal.contractPending.contractHash.slice(0, 8)}`, cwd: fx, sessionId: "sess_m4h" }),
      env: baseEnv,
    });
    if (!(ap.stdout ?? "").includes("Human approval recorded")) throw new Error(`批准未记录：${ap.stdout}${ap.stderr}`);
    const p2 = lzy(["loop", "plan", "plan.md"]);
    if (p2.exit !== 0) throw new Error(`采纳失败：${p2.out}`);
  } else if (p1.exit === 0) {
    recordAuthorization(fx, { kind: "approval", slug: goal.slug, contractHash: goal.contract.contractHash, sessionId: "sess_m4h", at: new Date().toISOString() });
  } else {
    throw new Error(`首采异常退出：${p1.out}`);
  }
  const st = lzy(["loop", "start"]);
  if (st.exit !== 0) throw new Error(`start 失败：${st.out}`);
  const red = lzy(["evidence", "red", "F1", "--evidence", "red: marker absent on baseline"]);
  if (red.exit !== 0) throw new Error(`红半失败：${red.out}`);
  writeFileSync(join(fx, "marker.txt"), "marker\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "marker"]);
  const n1 = lzy(["step", "done", "N1", "--note", "add marker"]);
  if (n1.exit !== 0) throw new Error(`N1 失败：${n1.out}`);
  const f1 = lzy(["step", "done", "F1", "--evidence", "green: marker present"]);
  if (f1.exit !== 0) throw new Error(`F1 失败：${f1.out}`);
}

// ── C0：专项职责替身运行（红半=职责不在表 v3——非零且无运行档）──────────────
const baseStem = "m4h.a1.r1";
{
  const r = lzy(["review", "run", "--duty", DUTY, "--timeout-ms", "30000"], { LZY_ZCODE_ENGINE: stub, LZY_STUB_DUTY: DUTY });
  const rec = existsSync(runRec(baseStem)) ? readJson(runRec(baseStem)) : null;
  obs("D1a-专项运行", `run.exit=${r.exit} 在案=${rec !== null} duty=${rec?.duty?.id ?? "-"} ${rec?.validity?.status ?? "-"}/${rec?.metering?.status ?? "-"}/${rec?.result?.verdict ?? "-"}`,
    "替代评审专项职责运行（红半期望=职责不在表拒+无运行档；绿半=valid metered pass）", /职责不在表|未知/.test(r.out) ? r.out.split("\n").slice(0, 3).join(" ") : null);
}

// ── C1：无关变化 + 现行基线运行与 check 回执（专项运行仍停在 C0）───────────
writeFileSync(join(fx, "docs", "readme.md"), "# doc\n# unrelated\n");
git(["add", "-A"]);
git(["commit", "-qm", "docs unrelated"]);
const declPath = join(work, "scope.decl.json"); // 声明档落夹具仓外（仓内会进候选 diff）
writeFileSync(declPath, JSON.stringify({
  dutyId: DUTY,
  rules: [{ pattern: "src/**", class: "in-scope" }, { pattern: "docs/**", class: "unrelated" }, { pattern: "scripts/**", class: "in-scope" }],
  sharedInputs: ["package-lock.json"],
}));
const vr1 = lzy(["verify", "run", "build"]);
const br1 = lzy(["review", "run", "--timeout-ms", "30000"], { LZY_ZCODE_ENGINE: stub });
obs("D3a-现行基线与回执", `verify.exit=${vr1.exit} baseline.exit=${br1.exit}`,
  "C1 面：check 回执 + 基线评审运行均绑现行候选（复用腿判据的隔离前置——非 blocker 面）");
const q1 = lzy(["review", "qualify", baseStem, "--scope", declPath]);
const scopeDir = join(fx, ".lazyzcode", "review-scope");
const scopeFiles = existsSync(scopeDir) ? readdirSync(scopeDir).sort() : null;
const qRec = scopeFiles ? scopeFiles.filter((x) => /\.q\d+\.json$/.test(x)).map((x) => readJson(join(scopeDir, x))).at(-1) ?? null : null;
obs("D2a-资格落档", `qualify.exit=${q1.exit} 家族目录=${scopeFiles === null ? "不在场" : "在场"} granted=${qRec?.granted ?? "-"} 挑战=${(qRec?.challenges ?? []).filter((c) => c.ok).length}/${(qRec?.challenges ?? []).length}`,
  "资格挑战落档（红半期望=未知命令+目录不在场零写入；绿半=granted 且十轴全过落档）", q1.out);
const u1 = lzy(["review", "reuse", baseStem]);
const pRecs = () => (existsSync(scopeDir) ? readdirSync(scopeDir).filter((x) => /\.p\d+\.json$/.test(x)).map((x) => readJson(join(scopeDir, x))) : []);
const p1 = pRecs().at(-1) ?? null;
obs("D2b-适用档落档", `reuse.exit=${u1.exit} verdict=${p1?.verdict ?? "-"} 因=${(p1?.reasons ?? []).length} 绑资格档=${p1?.qualificationId ?? "-"}`,
  "无关变化适用档（红半期望=未知命令零落档；绿半=applicable 且绑资格档 id）", u1.out);
const g1 = lzy(["gate", "explain"]);
obs("D3b-复用链满足", `gate.exit=${g1.exit} 裁决=${/裁决 (\S+)/.exec(g1.out)?.[1] ?? "?"} 复用字样=${/复用/.test(g1.out)} 适用档=${p1?.id ?? "-"} ${p1?.id && g1.out.includes(p1.id) ? "被引" : "未被引"}`,
  "C1 门裁决（红半期望=无复用链叙述且无该专项义务；绿半=专项义务经复用腿满足且叙述点名适用档 id）", g1.out);

// ── C2：未知新文件使最新适用档 fallback ⇒ 复用腿实拦 ────────────────────────
writeFileSync(join(fx, "stranger.txt"), "??\n");
git(["add", "-A"]);
git(["commit", "-qm", "unknown"]);
lzy(["verify", "run", "build"]);
lzy(["review", "run", "--timeout-ms", "30000"], { LZY_ZCODE_ENGINE: stub });
const u2 = lzy(["review", "reuse", baseStem]);
const p2 = pRecs().at(-1) ?? null;
obs("D2c-未知路径 fallback", `reuse.exit=${u2.exit} verdict=${p2?.verdict ?? "-"} 因点名未知=${(p2?.reasons ?? []).filter((x) => /未知路径：stranger\.txt/.test(x)).length}`,
  "未知新文件⇒最新适用档 fallback 逐因点名 stranger.txt（红半=未知命令）", u2.out);
const g2 = lzy(["gate", "explain"]);
obs("D3c-复用腿实拦", `gate.exit=${g2.exit} 裁决=${/裁决 (\S+)/.exec(g2.out)?.[1] ?? "?"} 复用不足因=${/复用/.test(g2.out) && /不足|fallback|适用档/.test(g2.out)} 点名声明依赖=${/stranger\.txt/.test(g2.out)}`,
  "C2 门裁决（红半期望=无复用腿可言；绿半=其余义务全现行下由复用不足因单独阻塞并点名未知路径）", g2.out);

// ── D1：命令族存在性（三命令的拒面与「未知命令」可辨）──────────────────────
{
  const qa = lzy(["review", "qualify"]);
  const ra = lzy(["review", "reuse"]);
  const ro = lzy(["finding", "reopen", "0000000000000000"]);
  // 事实读数=拒面上是否出现该命令的**规范用法名**（红半 review 家族用法只列 run|recheck|list|show：
  // 命令族缺席；绿半用法行即「lzy review qualify/reuse <…>」）。reopen 另看是否报未知子命令。
  obs("D1b-命令族", `qualify.exit=${qa.exit} 规范用法名=${/lzy review qualify/.test(qa.out)} reuse.exit=${ra.exit} 规范用法名=${/lzy review reuse/.test(ra.out)} reopen.exit=${ro.exit} 未知子命令=${/未知子命令/.test(ro.out)}`,
    "三命令在场性（红半期望=qualify/reuse 的规范用法名缺席+reopen 报未知子命令；绿半=用法名在场、reopen 走域拒）",
    [qa.out, ra.out, ro.out].map((x) => x.split("\n")[0]).join(" | "));
}

// ── 输出 ──
const out = {
  schemaVersion: 1,
  harness: "m4-scope-harness",
  root: ROOT,
  source: SOURCE,
  rootTree: spawnSync("git", ["show", "-s", "--format=%T", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null,
  rootHead: spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null,
  rootCliVersion: (() => {
    try {
      return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version ?? null;
    } catch {
      return null;
    }
  })(),
  at: new Date().toISOString(),  observations,
};
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`[m4-harness] root=${ROOT} source=${SOURCE ?? "-"} observations=${observations.length}`);
for (const o of observations) console.log(`  ${o.id}: ${o.observed}`);
console.log(`  → ${OUT}`);
rmSync(work, { recursive: true, force: true });
rmSync(fxHome, { recursive: true, force: true });

// ── 结构失败出口（0.4.0 M5 N3，M4 输入 9②）：判据观察齐备 sanity——只核机器面（八判据 id
// 齐备+读数可解析；spawn 失败的 exit=null 也算缺位），观察内容判读仍归 comparator（INV-08
// 家法不破）。缺位=退化环境/重构事故，exit 1 防静默绿——红半=同突变对照实测（改前删一条
// 观察仍 exit 0，artifacts/v040/M5/dev-evidence/n3-red-harness-mutant.txt）。
const EXPECTED_OBS_IDS = [
  "D1a-专项运行",
  "D2a-资格落档",
  "D2b-适用档落档",
  "D3a-现行基线与回执",
  "D3b-复用链满足",
  "D2c-未知路径 fallback",
  "D3c-复用腿实拦",
  "D1b-命令族",
];
const structuralMissing = EXPECTED_OBS_IDS.filter(
  (id) => !observations.some((o) => o.id === id && o.observed != null && !/exit=(null|undefined)\b/.test(o.observed)),
);
if (structuralMissing.length > 0) {
  console.error(`[m4-harness] 结构失败（exit 1）：判据观察缺位或不可解析：${structuralMissing.join(" · ")}（观察 JSON 已落盘；内容判读归 comparator）`);
  process.exit(1);
}
