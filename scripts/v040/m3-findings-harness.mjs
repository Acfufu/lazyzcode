#!/usr/bin/env node
// INV-08 红绿同源 harness（0.4.0 M3 N12；goal v040-m3-findings，计划 N12/F6 附注红绿 mapping）。
// 冻结入口脚本：--root <被测树> 动态以子进程驱动被测树的 CLI（本进程**不 import**被测树任何
// 模块——观察面独立于被测版本），只记观察不做断言；断言=对照面（F6 comparator）的活。
// 两半同脚本同 env（夹具 HOME 隔离 + LZY_ZCODE_ENGINE 指替身 + LZY_ABLATE_HUMAN_GATE=1）：
//   绿半=工作树（--root <repo>）；红半=git archive 6b4f7fb1e0edda11dbfad9d6ab503e4ccf89d6db
//   （M2 收口冻结树，写定时钉定）| tar -x 解出的改前树（--source <sha> 记录出处）。
// 观察面（红半判据=三改前行为，计划 N12/F6 附注）：
//   D1 未关闭阻塞发现：植入合法格式发现账本档+替身绿运行翻满足 review 义务 →
//      gate 裁决与 finish 退出码（红半期望=占位子句不拦→PASS/finish 0；绿半=[findings] 拦→BLOCKED/finish 非 0）
//   D2 finding 命令族存在性（红半=未知命令非 0；绿半=0 且枚举到在案发现）
//   D3 relink 别名链（红半=未知命令；绿半=0 且 gate 仍拦同名发现——改名后同链可读仍拦）
//   D4 reassess 面（红半=未知命令+obligationsLog removed 档不可读；绿半=命令在场+removed
//      reassess 形档可读——ADR-0033 三件套合法形）
// 用法：node scripts/v040/m3-findings-harness.mjs --root <被测树> [--source <sha>] --out <观察.json>
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  console.log("用法: m3-findings-harness.mjs --root <被测树> [--source <sha>] --out <观察.json>");
  process.exit(0);
}
if (!OUT) {
  console.error("[m3-harness] 缺 --out <观察.json>（观察面落盘）");
  process.exit(2);
}

const CLI = join(ROOT, "cli", "lzy.js");
const TRIGGER = join(ROOT, "plugin", "hooks", "trigger.js");
const CONTRACT = "task: findings harness fixture\nendpoint: A\nscope: .\nrecipe: none\nbudget-ref: none\n\n- [A1] marker file works\n";
const PLAN = "- [N1] add marker file\n- [F1] marker exists\naccepts: A1\n";

const observations = [];
const obs = (id, observed, detail) => observations.push({ id, observed, detail: String(detail ?? "").slice(0, 400) });

// 替身引擎（绿腿：pass 围栏 + 写约定转录 + 子账本行——真实运行产物不植入）
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
const sessionId = "sess-m3h-" + (process.env.LZY_STUB_SID ?? "1");
fs.mkdirSync(path.join(home, ".zcode", "cli", "rollout"), { recursive: true });
fs.writeFileSync(path.join(home, ".zcode", "cli", "rollout", "model-io-" + sessionId + ".jsonl"),
  JSON.stringify({ tool: "read", file_path: path.join(cwd, "a.txt") }) + "\\n");
{
  const db = path.join(home, ".zcode", "cli", "db", "db.sqlite");
  fs.mkdirSync(path.dirname(db), { recursive: true });
  spawnSync("sqlite3", [db, "CREATE TABLE IF NOT EXISTS model_usage (session_id TEXT, model_id TEXT, started_at INTEGER, input_tokens INTEGER, cache_read_input_tokens INTEGER, output_tokens INTEGER, status TEXT); INSERT INTO model_usage VALUES ('" + sessionId + "', 'glm-5.3-flash', 1, 100000, 0, 1000, 'completed');"]);
}
const BT = String.fromCharCode(96);
const response = BT + BT + BT + "json\\n" + JSON.stringify({ duty: "review.general-correctness", verdict: "pass", findings: [], summary: "m3 harness 替身绿例" }) + "\\n" + BT + BT + BT;
process.stdout.write(JSON.stringify({ sessionId, response, usage: { input_tokens: 1, output_tokens: 1 } }) + "\\n");
`,
    { mode: 0o755 },
  );
  return p;
}

// 植入合法格式发现账本档（两半同格式：红半树无此家族读面=惰性文件；绿半形状闸可读）。
// checksum 复刻 saveFamilyFile 家法：sha256(JSON.stringify(payload))（键序=本对象字面序）。
function seedFindingLedger(fx, slug) {
  const fp = createHash("sha256").update("P1|授权撤回缺陷：已撤销令牌仍可放行|auth.js:12").digest("hex");
  const payload = {
    schemaVersion: 1,
    slug,
    aliases: [],
    findings: {
      [fp]: {
        severity: "P1",
        title: "授权撤回缺陷：已撤销令牌仍可放行",
        location: "auth.js:12",
        status: "open",
        firstSeen: { runId: `${slug}.a1.r1`, attempt: 1, at: "2026-09-28T00:00:00.000Z" },
        lastSeen: { runId: `${slug}.a1.r1`, attempt: 1, at: "2026-09-28T00:00:00.000Z" },
        occurrences: 1,
        invalidFixCount: 0,
        resolveRequest: null,
        closure: null,
        diagnosis: null,
        history: [{ at: "2026-09-28T00:00:00.000Z", kind: "seen", runId: `${slug}.a1.r1`, attempt: 1 }],
      },
    },
  };
  const checksum = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const dir = join(fx, ".lazyzcode", "findings");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slug}.json`), `${JSON.stringify({ ...payload, checksum }, null, 2)}\n`, { mode: 0o600 });
  return fp.slice(0, 8);
}

// 植入带 reassess removed 条目的策略档（复制现行档→追加合法形 log 项）。红半形状闸
// （removed 非空即拒）读不出；绿半（M3 N8）可读。
function seedReassessLog(fx, slug) {
  const p = join(fx, ".lazyzcode", "policy", `${slug}.a1.json`);
  if (!existsSync(p)) return "policy-record-absent";
  const obj = JSON.parse(readFileSync(p, "utf8"));
  const { checksum, ...rest } = obj;
  rest.obligationsLog = [
    ...(rest.obligationsLog ?? []),
    {
      at: "2026-09-28T00:00:00.000Z",
      event: "reassess",
      from: rest.inputsHash,
      to: rest.inputsHash,
      added: [],
      removed: ["check.harness-probe"],
      impactChange: "清单配方移除（harness 植入）",
      cancelReason: "检查适用条件消失（harness 植入）",
      basis: "re-derive 不再生成 check.harness-probe（ADR-0033 §5 三件套植入面）",
      obligationsAfter: (rest.obligations ?? []).map((o) => o.id),
    },
  ];
  const checksum2 = createHash("sha256").update(JSON.stringify(rest)).digest("hex");
  writeFileSync(p, `${JSON.stringify({ ...rest, checksum: checksum2 }, null, 2)}\n`, { mode: 0o600 });
  return "seeded";
}

// ── 夹具（v2 目标全链 + 评审就绪态）─────────────────────────────────────────
const work = mkdtempSync(join(tmpdir(), "lzy-m3h-"));
const stub = writeStub(work);
const fxHome = mkdtempSync(join(tmpdir(), "lzy-m3h-home-"));
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
  const reg = lzy(["loop", "register", "m3h", "--title", "t", "--contract", "contract.md"]);
  if (reg.exit !== 0) throw new Error(`register 失败：${reg.out}`);
  const p1 = lzy(["loop", "plan", "plan.md"]);
  const goal = JSON.parse(readFileSync(join(fx, ".lazyzcode", "loop", "goal.json"), "utf8"));
  const hookApprove = (hash) =>
    spawnSync(process.execPath, [TRIGGER], {
      cwd: fx, encoding: "utf8", timeout: 30_000,
      input: JSON.stringify({ prompt: `批准 ${hash.slice(0, 8)}`, cwd: fx, sessionId: "sess_m3h" }),
      env: baseEnv,
    });
  if (goal.contractPending) {
    const ap = hookApprove(goal.contractPending.contractHash);
    if (!(ap.stdout ?? "").includes("Human approval recorded")) throw new Error(`批准未记录：${ap.out}`);
    const p2 = lzy(["loop", "plan", "plan.md"]);
    if (p2.exit !== 0) throw new Error(`采纳失败：${p2.out}`);
  } else if (p1.exit === 0) {
    recordAuthorization(fx, {
      kind: "approval",
      slug: goal.slug,
      contractHash: goal.contract.contractHash,
      sessionId: "sess_m3h",
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

// ── D1：植入未关闭阻塞发现 + 替身绿运行 → gate 裁决与 finish ──
const fp8 = seedFindingLedger(fx, "m3h");
{
  const rr = lzy(["review", "run", "--timeout-ms", "30000"], { LZY_ZCODE_ENGINE: stub, LZY_STUB_SID: "d1" });
  const ge = lzy(["gate", "explain"]);
  const verdict = /裁决 (\S+)/.exec(ge.out)?.[1] ?? "?";
  const hasFindingsClause = /\[findings\]/.test(ge.out) || /发现面/.test(ge.out);
  const fin = lzy(["loop", "finish"]);
  obs("D1", `run.exit=${rr.exit} gate=${verdict} findingsClause=${hasFindingsClause} gateHasFp=${ge.out.includes(fp8)} finish.exit=${fin.exit}`,
    "植入未关闭阻塞发现+review 义务已满足（红半期望=占位子句不拦→PASS·finish 0；绿半=[findings] 拦点名指纹→BLOCKED·finish 非 0）");
}

// ── D2：finding 命令族存在性 ──
{
  const ls = lzy(["finding", "list"]);
  obs("D2", `list.exit=${ls.exit} listHasFp=${ls.out.includes(fp8)} unknownCmd=${/未知命令/.test(ls.out)}`,
    "finding list（红半期望=未知命令非 0；绿半=0 且枚举到在案发现）");
}

// ── D3：relink 别名链（改名后同链可读仍拦）──
{
  const rl = lzy(["finding", "relink", "--from", "m3h-legacy", "--to", "m3h"]);
  const ge = lzy(["gate", "explain"]);
  obs("D3", `relink.exit=${rl.exit} unknownCmd=${/未知命令/.test(rl.out)} gateStillHasFp=${ge.out.includes(fp8)}`,
    "relink 旧名→现行（红半=未知命令；绿半=0 且 gate 仍拦同名发现——别名闭包并集读）");
}

// ── D4：reassess 面（CLI 存在性 + removed 合法形档可读性）──
{
  const ra = lzy(["policy", "reassess", "check.x", "--impact", "i", "--cancel-reason", "c", "--basis", "b"]);
  const seedState = seedReassessLog(fx, "m3h");
  const show = lzy(["policy", "show"]);
  obs("D4", `reassess.exit=${ra.exit} unknownCmd=${/未知命令/.test(ra.out)} seed=${seedState} show.exit=${show.exit} showOnDisk=${/记录在案/.test(show.out)} showRejected=${/形状非法|removed/.test(show.out)}`,
    "reassess CLI + obligationsLog removed 条目（红半=reassess 拒+档读不出→现算显示「未落档」；绿半=命令在场（usage 拒≠未知）+removed reassess 形档「记录在案」可读）");
}

// ── 输出 ──
const out = {
  schemaVersion: 1,
  harness: "m3-findings-harness",
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
console.log(`[m3-harness] root=${ROOT} source=${SOURCE ?? "-"} observations=${observations.length}`);
for (const o of observations) console.log(`  ${o.id}: ${o.observed}`);
console.log(`  → ${OUT}`);
rmSync(work, { recursive: true, force: true });
