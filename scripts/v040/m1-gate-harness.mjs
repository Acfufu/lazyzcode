#!/usr/bin/env node
// 0.4.0 M1 统一门「红绿同源」取证入口（goal v040-m1-gate#N8；INV-08 家法：同一入口脚本 +
// 被测面 env/root 注入——红半=git archive 改前树，绿半=工作树，禁两套脚本）。
//
// 用法：
//   node scripts/v040/m1-gate-harness.mjs --root <被测树根> [--source <ref 标识>] [--out <json>]
//   --root   被测树根（缺省=本脚本所在仓的工作树）。改前树配方：
//              git archive <改前 commit> | tar -x -C <临时目录>，再 --root <临时目录> --source <commit>
//   --out    JSON 落点（缺省只打印 stdout；F 项取证传 artifacts/ 下路径）
//
// 判据面=**观察**（不做断言；比较器在 F 项侧，两半各自读数对照）：
//   D1 done 分支直放   queue dispatch 遇 done 目标：条目结局（旧树 completed 直放 / 现行 ready 阻断）
//   D2 reconcile 直放  reconcile 追认 done 目标：条目结局（旧树 completed 直放 / 现行 不追认）
//   D3 CI 计绿口径     checkRunsVerdict([SUCCESS,NEUTRAL]).ok（旧树 true 计绿 / 现行 false 严判）
//   D4 gate explain 面 CLI 是否有统一门解释面（旧树「未知命令」/ 现行 解释面在案）
//
// 纪律：夹具 HOME 隔离 + LZY_ZCODE_ENGINE 抑制 + LZY_ABLATE_HUMAN_GATE=1（人权门/引擎面非本
// 判据面；两半同 env——被测面差异只在被测树代码本身）。被测树模块一律经 pathToFileURL 动态
// import（win32 安全），CLI 一律 spawn 被测树自己的 cli/lzy.js；本进程不 import 自己在跑的那棵树
// 的核心模块，故两半读数互不污染。
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const ROOT = resolve(typeof f.root === "string" ? f.root : REPO);
const SOURCE = typeof f.source === "string" ? f.source : null;
const OUT = typeof f.out === "string" ? resolve(f.out) : null;
const CLI = join(ROOT, "cli", "lzy.js");
const ENGINE_SUPPRESS = "/nonexistent-lzy-suppressed";

const BASE_ENV = {
  ...process.env,
  LZY_ZCODE_ENGINE: ENGINE_SUPPRESS,
  LZY_ABLATE_HUMAN_GATE: "1", // 人权门非本判据面（两半同 env）
};

const rootHead = (() => {
  const r = spawnSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 10_000 });
  return (r.stdout ?? "").trim() || null;
})();

const lzy = (cwd, args, extra = {}) => {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...BASE_ENV, ...extra },
  });
  return { exit: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

// 夹具：git 仓 + 空能力清单 + endpoint A 契约 + 单步计划；register→plan→start 全走被测树 CLI
// （旧树注册产物 v1 / 现行树 v2+策略记录——同脚本两半自然覆盖两种格式）。随后手置 status=done
// （测试态：本入口测的是「done 记录过不过门」，不是如何合法 done）。
function fixture(label) {
  const home = mkdtempSync(join(tmpdir(), `lzy-m1-${label}-home-`));
  const d = mkdtempSync(join(tmpdir(), `lzy-m1-${label}-`));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  writeFileSync(join(d, "lzy.project.json"), `${JSON.stringify({ schemaVersion: 1, capabilities: {} }, null, 2)}\n`);
  writeFileSync(join(d, "c-main.md"), "task: main A\nendpoint: A\nscope: .\nrecipe: none\n\n- [A1] x\n");
  writeFileSync(join(d, "p.md"), "- [N1] x\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "fixture"]);
  const env = { HOME: home, USERPROFILE: home };
  const reg = lzy(d, ["loop", "register", "qh", "--title", "t"], env);
  if (reg.exit !== 0) throw new Error(`register 失败：${reg.out}`);
  const plan = lzy(d, ["loop", "plan", "p.md"], env);
  if (plan.exit !== 0) throw new Error(`plan 失败：${plan.out}`);
  const start = lzy(d, ["loop", "start"], env);
  if (start.exit !== 0) throw new Error(`start 失败：${start.out}`);
  const gp = join(d, ".lazyzcode", "loop", "goal.json");
  const goal = JSON.parse(readFileSync(gp, "utf8"));
  goal.status = "done";
  writeFileSync(gp, `${JSON.stringify(goal, null, 2)}\n`);
  return { d, home, env, goalVersion: goal.version };
}

async function main() {
  const q = await import(pathToFileURL(join(ROOT, "core", "queue.js")).href);
  const deliv = await import(pathToFileURL(join(ROOT, "core", "delivery.js")).href);
  const obs = {};

  // ── D3：CI 计绿口径（纯函数面，零夹具）────────────────────────────────
  const v3 = deliv.checkRunsVerdict([
    { name: "a", status: "COMPLETED", conclusion: "SUCCESS" },
    { name: "b", status: "COMPLETED", conclusion: "NEUTRAL" },
  ]);
  obs.D3_ciNeutralOk = { ok: v3.ok, completed: v3.completed, bad: v3.bad, verdict: v3.ok ? "neutral-计绿" : "neutral-非绿（严判）" };

  // ── D1：done 分支直放（queue dispatch，deps.drive 假件）──────────────
  const fa = fixture("d1");
  try {
    const it = q.addQueueItem(fa.d, {
      title: "harness-item",
      contractFile: join(fa.d, "c-main.md"),
      planFile: join(fa.d, "p.md"),
      goalSlug: "qh",
      endpoint: "A",
    });
    const auth = await import(pathToFileURL(join(ROOT, "core", "contract.js")).href);
    auth.recordAuthorization(fa.d, { kind: "approval", slug: "qh", contractHash: it.contractHash, sessionId: "t", at: new Date().toISOString() });
    q.refreshQueue(fa.d);
    const res = await q.runQueueDispatch(fa.d, {}, { drive: async () => ({ ok: true, cause: "harness-fake-drive" }) });
    const item = q.loadQueue(fa.d).items.find((x) => x.id === it.id);
    const tx = q.loadDispatch(fa.d).txs.find((t) => t.itemId === it.id) ?? null;
    obs.D1_doneBranch = {
      itemState: item?.state ?? null,
      dispatched: item?.state === "completed",
      txPhase: tx?.phase ?? null,
      txNote: tx?.note ?? null,
      resultCause: String(res?.results?.[0]?.cause ?? "").slice(0, 300) || null,
    };
    // ── D4：gate explain 面（同一夹具，门解释面存在性）─────────────────
    const ge = lzy(fa.d, ["gate", "explain"], fa.env);
    obs.D4_gateExplain = {
      exit: ge.exit,
      hasGateFace: /统一门/.test(ge.out),
      unknownCommand: /未知命令/.test(ge.out),
      firstLine: ge.out.split("\n").find((l) => l.trim())?.slice(0, 200) ?? null,
    };
  } finally {
    rmSync(fa.d, { recursive: true, force: true });
    rmSync(fa.home, { recursive: true, force: true });
  }

  // ── D2：reconcile 直放（同一 done 态 + 手工 open tx）──────────────────
  const fb = fixture("d2");
  try {
    const it = q.addQueueItem(fb.d, {
      title: "harness-item",
      contractFile: join(fb.d, "c-main.md"),
      planFile: join(fb.d, "p.md"),
      goalSlug: "qh",
      endpoint: "A",
    });
    const auth = await import(pathToFileURL(join(ROOT, "core", "contract.js")).href);
    auth.recordAuthorization(fb.d, { kind: "approval", slug: "qh", contractHash: it.contractHash, sessionId: "t", at: new Date().toISOString() });
    q.refreshQueue(fb.d);
    const dj = q.loadDispatch(fb.d) ?? { txs: [] };
    dj.txs.push({
      txId: "t-harness-1",
      itemId: it.id,
      goalSlug: "qh",
      phase: "open",
      openedAt: new Date().toISOString(),
      settledAt: null,
      limits: { wallMs: null, points: null },
      segments: [],
      note: null,
    });
    q.saveDispatch(fb.d, dj);
    const rec = q.reconcileDispatch(fb.d, {});
    const item = q.loadQueue(fb.d).items.find((x) => x.id === it.id);
    obs.D2_reconcile = {
      itemState: item?.state ?? null,
      reconciled: item?.state === "completed",
      blockedReason: item?.blockedReason ?? null,
      verdict: rec?.verdicts?.find((v) => v.txId === "t-harness-1")?.verdict?.slice(0, 300) ?? null,
      txPhase: q.loadDispatch(fb.d).txs.find((t) => t.txId === "t-harness-1")?.phase ?? null,
    };
  } finally {
    rmSync(fb.d, { recursive: true, force: true });
    rmSync(fb.home, { recursive: true, force: true });
  }

  const out = {
    schemaVersion: 1,
    harness: "scripts/v040/m1-gate-harness.mjs",
    root: ROOT,
    source: SOURCE,
    rootHead,
    generatedAt: new Date().toISOString(),
    env: { engine: ENGINE_SUPPRESS, humanGateAblated: true, note: "人权门/引擎面非本判据面——两半同 env" },
    observations: obs,
  };
  const text = `${JSON.stringify(out, null, 2)}\n`;
  if (OUT) writeFileSync(OUT, text);
  process.stdout.write(text);
}

main().catch((e) => {
  process.stderr.write(`[m1-harness] 失败：${e?.stack ?? e}\n`);
  process.exit(1);
});
