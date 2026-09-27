#!/usr/bin/env node
// INV-08 红绿同源 harness（0.4.0 M2 N9；goal v040-m2-review，附注红绿 mapping）。
// 冻结入口脚本：--root <被测树> 动态以子进程驱动被测树的 CLI/钩子（本进程**不 import**被测
// 树任何模块——观察面独立于被测版本），只记观察不做断言；断言=对照面（F6 comparator）的活。
// 两半同脚本同 env（夹具 HOME 隔离 + LZY_ZCODE_ENGINE 指替身 + LZY_ABLATE_HUMAN_GATE=1）：
//   绿半=工作树（--root <repo>）；红半=git archive <改前树> | tar -x 解出的改前树（--source <sha> 记录出处）。
// 观察面（附注 mapping：D1/D2=pre-N5 · D3=pre-N6 · D4=pre-N1 · D5=pre-N4 · D6=pre-N3）：
//   D1 无运行→gate 阻塞理由（gate explain 活体）
//   D2 有效 metered pass 运行→义务满足（替身引擎真实运行产物——替身写转录+子账本，不植入记录）
//   D3 review list|show 面存在性（真 CLI 退出码）
//   D4 家族损坏 fail-closed（植入一位校验和损坏档→list 非零 + gate 具名）
//   D5 计量参数化（子账本 metered vs 宿主对照——SQL 形状按 core/cost.js 聚合列，本进程本地副本）
//   D6 结构归一化（矛盾体 pass∧blocking → blocked + 归一化注记）
// 用法：node scripts/v040/m2-review-harness.mjs --root <被测树> [--source <sha>] --out <观察.json>
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  console.log("用法: m2-review-harness.mjs --root <被测树> [--source <sha>] --out <观察.json>");
  process.exit(0);
}
if (!OUT) {
  console.error("[m2-harness] 缺 --out <观察.json>（观察面落盘）");
  process.exit(2);
}

const CLI = join(ROOT, "cli", "lzy.js");
const TRIGGER = join(ROOT, "plugin", "hooks", "trigger.js");
const CONTRACT = "task: review harness fixture\nendpoint: A\nscope: .\nrecipe: none\nbudget-ref: none\n\n- [A1] marker file works\n";
const PLAN = "- [N1] add marker file\n- [F1] marker exists\naccepts: A1\n";
const METER_SQL = (sid) =>
  "SELECT m.session_id AS sid, m.model_id AS model, m.started_at/3600000 AS h, " +
  "SUM(m.input_tokens) AS it, SUM(m.cache_read_input_tokens) AS crt, SUM(m.output_tokens) AS ot " +
  "FROM model_usage m WHERE m.session_id = '" + sid + "' AND m.status = 'completed' " +
  "GROUP BY sid, model, h";

const observations = [];
const obs = (id, observed, detail) => observations.push({ id, observed, detail: String(detail ?? "").slice(0, 400) });

// 替身引擎（写约定转录+按腿写子账本；绿=pass 围栏，矛盾=矛盾体围栏，sleep=挂起）
function writeStub(dir) {
  const p = join(dir, "stub-engine.cjs");
  writeFileSync(
    p,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const leg = process.env.LZY_STUB_LEG ?? "green";
const home = process.env.HOME ?? process.env.USERPROFILE;
const cwd = process.cwd();
const sessionId = "sess-harness-" + leg + "-" + (process.env.LZY_STUB_SID ?? "1");
fs.mkdirSync(path.join(home, ".zcode", "cli", "rollout"), { recursive: true });
fs.writeFileSync(path.join(home, ".zcode", "cli", "rollout", "model-io-" + sessionId + ".jsonl"),
  JSON.stringify({ tool: "read", file_path: path.join(cwd, "a.txt") }) + "\\n");
if (process.env.LZY_STUB_LEDGER === "1") {
  const db = path.join(home, ".zcode", "cli", "db", "db.sqlite");
  fs.mkdirSync(path.dirname(db), { recursive: true });
  spawnSync("sqlite3", [db, "CREATE TABLE IF NOT EXISTS model_usage (session_id TEXT, model_id TEXT, started_at INTEGER, input_tokens INTEGER, cache_read_input_tokens INTEGER, output_tokens INTEGER, status TEXT); INSERT INTO model_usage VALUES ('" + sessionId + "', 'glm-5.3-flash', 1, 100000, 0, 1000, 'completed');"]);
}
const BT = String.fromCharCode(96);
let response = "";
if (leg === "green") response = BT + BT + BT + "json\\n" + JSON.stringify({ duty: "review.general-correctness", verdict: "pass", findings: [], summary: "harness 替身绿例" }) + "\\n" + BT + BT + BT;
if (leg === "contradiction") response = BT + BT + BT + "json\\n" + JSON.stringify({ duty: "review.general-correctness", verdict: "pass", findings: [{ id: "F-1", title: "t", severity: "P1", blocking: true, location: "a.txt:1", evidence: "e", summary: "s" }], summary: "矛盾体" }) + "\\n" + BT + BT + BT;
if (leg === "sleep") { const end = Date.now() + 120000; while (Date.now() < end) {} }
process.stdout.write(JSON.stringify({ sessionId, response, usage: { input_tokens: 1, output_tokens: 1 } }) + "\\n");
`,
    { mode: 0o755 },
  );
  return p;
}

// ── 夹具（v2 目标全链 + 评审就绪态）─────────────────────────────────────────
const work = mkdtempSync(join(tmpdir(), "lzy-m2h-"));
const stub = writeStub(work);
const fxHome = mkdtempSync(join(tmpdir(), "lzy-m2h-home-"));
const fx = join(work, "fixture");
mkdirSync(fx, { recursive: true });
{
  const g = (args) => spawnSync("git", args, { cwd: fx, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(fx, ".gitignore"), ".lazyzcode/\nnode_modules/\n");
  writeFileSync(join(fx, "a.txt"), "a\n");
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
{
  const reg = lzy(["loop", "register", "m2h", "--title", "t", "--contract", "contract.md"]);
  if (reg.exit !== 0) throw new Error(`register 失败：${reg.out}`);
  const p1 = lzy(["loop", "plan", "plan.md"]);
  let goal = JSON.parse(readFileSync(join(fx, ".lazyzcode", "loop", "goal.json"), "utf8"));
  const hookApprove = (hash) =>
    spawnSync(process.execPath, [TRIGGER], {
      cwd: fx, encoding: "utf8", timeout: 30_000,
      input: JSON.stringify({ prompt: `批准 ${hash.slice(0, 8)}`, cwd: fx, sessionId: "sess_m2h" }),
      env: baseEnv,
    });
  if (goal.contractPending) {
    // 非消融形态：首采落 contractPending → 真 UPS 批准 → 重采
    const ap = hookApprove(goal.contractPending.contractHash);
    if (!(ap.stdout ?? "").includes("Human approval recorded")) throw new Error(`批准未记录：${ap.out}`);
    const p2 = lzy(["loop", "plan", "plan.md"]);
    if (p2.exit !== 0) throw new Error(`采纳失败：${p2.out}`);
  } else if (p1.exit === 0) {
    // 消融形态（LZY_ABLATE_HUMAN_GATE=1）：首采直采——UPS 钩子只记 pending 批准（无 pending
    // 明确拒录），故授权记录由器具 recordAuthorization 直落（夹具装配面，非观察面）。
    recordAuthorization(fx, {
      kind: "approval",
      slug: goal.slug,
      contractHash: goal.contract.contractHash,
      sessionId: "sess_m2h",
      at: new Date().toISOString(),
    });
  } else {
    throw new Error(`首采异常退出：${p1.out}`);
  }
  const st = lzy(["loop", "start"]);
  if (st.exit !== 0) throw new Error(`start 失败：${st.out}`);
  const red = lzy(["evidence", "red", "F1", "--evidence", "red: marker absent on baseline"]);
  if (red.exit !== 0) throw new Error(`红半失败：${red.out}`);
  writeFileSync(join(fx, "marker.txt"), "marker\n");
  spawnSync("git", ["add", "-A"], { cwd: fx });
  spawnSync("git", ["commit", "-qm", "marker"], { cwd: fx });
  const n1 = lzy(["step", "done", "N1", "--note", "add marker"]);
  if (n1.exit !== 0) throw new Error(`N1 失败：${n1.out}`);
  const f1 = lzy(["step", "done", "F1", "--evidence", "green: marker present"]);
  if (f1.exit !== 0) throw new Error(`F1 失败：${f1.out}`);
}

const reviewDir = join(fx, ".lazyzcode", "review");
const listFam = () => {
  try {
    return readdirSync(reviewDir).filter((x) => x.endsWith(".json"));
  } catch {
    return [];
  }
};
const readSubPoints = (home, sid) => {
  const db = join(home, ".zcode", "cli", "db", "db.sqlite");
  if (!existsSync(db)) return { absent: true, rows: 0 };
  const r = spawnSync("sqlite3", ["-readonly", "-json", db, METER_SQL(sid)], { encoding: "utf8", timeout: 10_000 });
  if (r.status !== 0 || !(r.stdout ?? "").trim()) return { absent: true, rows: 0 };
  try {
    const rows = JSON.parse(r.stdout);
    return { absent: rows.length === 0, rows: rows.length };
  } catch {
    return { absent: true, rows: 0 };
  }
};

// ── D1：无运行 → gate 阻塞理由 ──
{
  const ge = lzy(["gate", "explain"]);
  const rev = /义务 review\.general-correctness[^＝]*＝ (\S+)/.exec(ge.out)?.[1] ?? "?";
  const firstReason = /义务 review\.general-correctness[^\n]*\n\s{6}(.+)/.exec(ge.out)?.[1] ?? "(理由行缺席)";
  obs("D1", `gate.exit=${ge.exit} review=${rev} reason=${firstReason.slice(0, 120)}`, "无在案运行时 gate explain 活体（绿半期望=评审无在案运行阻塞；红半期望=受控评审运行器未接入）");
}

// ── D2：有效 metered pass 运行 → 义务满足（替身真实运行产物）──
let d2Record = null;
{
  const rr = lzy(["review", "run", "--timeout-ms", "30000"], { LZY_ZCODE_ENGINE: stub, LZY_STUB_LEG: "green", LZY_STUB_LEDGER: "1", LZY_STUB_SID: "d2" });
  const fam = listFam();
  d2Record = fam[0] ? JSON.parse(readFileSync(join(reviewDir, fam[0]), "utf8")) : null;
  obs("D2", `run.exit=${rr.exit} validity=${d2Record?.validity?.status ?? "-"} verdict=${d2Record?.result?.verdict ?? "-"} metering=${d2Record?.metering?.status ?? "-"}`,
    "有效 metered pass 运行落档（绿半期望=exit0 valid pass metered；红半期望=未知命令 exit1）");
  if (d2Record?.validity?.status === "valid" && d2Record?.result?.verdict === "pass") {
    const ge = lzy(["gate", "explain"]);
    const verdict = /裁决 (\S+)/.exec(ge.out)?.[1] ?? "?";
    obs("D2b", `gate.exit=${ge.exit} verdict=${verdict}`, "评审义务翻满足后 gate 裁决（绿半期望=PASS；红半不可达）");
  }
}

// ── D3：review list|show 面存在性 ──
{
  const ls = lzy(["review", "list"]);
  const runId = d2Record?.runId ?? "m2h.a1.r1";
  const sh = lzy(["review", "show", runId]);
  obs("D3", `list.exit=${ls.exit} show.exit=${sh.exit} listHas=${/m2h\.a1\.r\d/.test(ls.out)}`, "review list/show 真 CLI 退出码（绿半期望=0/0 且枚举到档；红半期望=未知命令非 0）");
}

// ── D4：家族损坏 fail-closed ──
{
  const fam = listFam();
  if (fam.length > 0) {
    const p = join(reviewDir, fam[0]);
    const obj = JSON.parse(readFileSync(p, "utf8"));
    obj.duty = { id: "tampered" };
    delete obj.checksum;
    writeFileSync(p, JSON.stringify(obj, null, 2));
    const ls = lzy(["review", "list"]);
    const ge = lzy(["gate", "explain"]);
    obs("D4", `list.exit=${ls.exit} listChecksum=/校验和/.test?${String(/校验和/.test(ls.out))} gate.exit=${ge.exit} gateBlocked=${/裁决 BLOCKED/.test(ge.out)}`,
      "植入校验和损坏档后（绿半期望=list 非 0+校验和具名+gate blocked；红半=未知命令非 0）");
    rmSync(p); // 拆除损坏档，D5/D6 复用族位
  } else {
    obs("D4", "no-record-to-corrupt", "族内无档（红半形态）");
  }
}

// ── D5：计量参数化（子账本 metered vs 宿主对照）──
{
  if (d2Record?.metering?.status === "metered") {
    const runHome = join(reviewDir, d2Record.runId, "home");
    const sub = readSubPoints(runHome, d2Record.sessionId);
    const hostDb = join(fxHome, ".zcode", "cli", "db", "db.sqlite");
    const host = existsSync(hostDb) ? readSubPoints(fxHome, d2Record.sessionId) : { absent: true, rows: 0, noDb: true };
    obs("D5", `sub.absent=${sub.absent} sub.rows=${sub.rows} host.absent=${host.absent} hostDbExists=${existsSync(hostDb)}`,
      "计量参数化（绿半期望=子账本有行+宿主结构性零行/无库——M0 发现一收口；红半=运行不可达）");
  } else {
    obs("D5", `d2Metering=${d2Record?.metering?.status ?? "-"}`, "D2 未产 metered 记录（红半形态）");
  }
}

// ── D6：结构归一化（矛盾体判 blocked）──
{
  const rr = lzy(["review", "run", "--timeout-ms", "30000"], { LZY_ZCODE_ENGINE: stub, LZY_STUB_LEG: "contradiction", LZY_STUB_LEDGER: "1", LZY_STUB_SID: "d6" });
  const fam = listFam();
  const rec = fam.map((x) => JSON.parse(readFileSync(join(reviewDir, x), "utf8"))).at(-1) ?? null;
  obs("D6", `run.exit=${rr.exit} verdict=${rec?.result?.verdict ?? "-"} normalization=${String(rec?.result?.normalization ?? "").slice(0, 80)}`,
    "矛盾体（pass∧blocking）归一化（绿半期望=exit1 blocked+归一化注记；红半=未知命令）");
}

// ── 输出 ──
const out = {
  schemaVersion: 1,
  harness: "m2-review-harness",
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
  at: new Date().toISOString(),
  observations,
};
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`[m2-harness] root=${ROOT} source=${SOURCE ?? "-"} observations=${observations.length}`);
for (const o of observations) console.log(`  ${o.id}: ${o.observed}`);
console.log(`  → ${OUT}`);
rmSync(work, { recursive: true, force: true });
