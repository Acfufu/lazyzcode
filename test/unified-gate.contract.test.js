// 统一只读放行门契约测试（0.4.0 M1 N8；docs/plan-v040-engineering-policy.md §6，V02/V03/V09
// 的 M1 面）。被测面=core/gate.js 的逐义务裁决 + N5 四处接线的「无旁路」语义：
//   ① 反例族八体：失败但可复用回执 / 错契约 / 错候选 / CI 漏项 / 授权撤回 / 评审缺席 /
//      v2 目标契约缺席 / 契约在案但验收映射缺项 —— 全 blocked 且原因逐体对应；
//   ② done 旧记录不免核：queue dispatch（core/queue.js:1182 缝）与 reconcile 追认
//      （core/queue.js:853-858 缝）两缝直测，各带 v1 对照半（既有成功路径不变，拍板 6）；
//   ③ 外发前置：beginAct 阻塞不落 acting、contractPending 原样保留，v1 对照半放行。
// 家法：判定面直调 evaluateGate（core 函数级模子）；接线面走真 CLI/真 API（真子进程 +
// HOME 隔离 + 假 gh 注入缝 LZY_GH_BIN）。契约批准走真实 UPS 短语（hook trigger），不用手写
// 批准记录。评审义务在 M1 恒不可满足（runnerFace.available=false）=诚实阻塞；0.4.0 M2 N5
// 翻面（runner available=true）后阻塞理由位移为「评审无在案运行」（拍板 6：夹具无评审运行
// 在案，七合取缺席）——重钉≠放宽，义务仍恒 unsatisfied。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateGate } from "../core/gate.js";
import { runCheck, listReceipts } from "../core/verify.js";
import { recordAuthorization } from "../core/contract.js";
import { bindDeliveryContract } from "../core/loop.js";
import { actDeliveryB, loadIntents, validateDeliveryContract } from "../core/delivery.js";
import { addQueueItem, loadDispatch, loadQueue, reconcileDispatch, refreshQueue, runQueueDispatch, saveDispatch } from "../core/queue.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = join(ROOT, "cli", "lzy.js");
const TRIGGER = join(ROOT, "plugin", "hooks", "trigger.js");
const HOME = mkdtempSync(join(tmpdir(), "lzy-ugate-home-"));
const REQ_CI = ["ci / test (24, ubuntu-latest)", "ci / test (24, windows-latest)"];
const REPO = "Acfufu/lazyzcode";

const CONTRACT = "task: ugate\nendpoint: A\nscope: .\nrecipe: none\n\n- [A1] alpha works\n- [A2] beta works\n";
const PLAN = "- [N1] work\n- [F1] alpha\naccepts: A1\n- [F2] beta\naccepts: A2\n";

function env(extra = {}) {
  return { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "/nonexistent-lzy-suppressed", LZY_ABLATE_HUMAN_GATE: "", ...extra };
}

function lzy(d, args, extra = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: "utf8", timeout: 120_000, env: env(extra) });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function hookRun(d, prompt) {
  const r = spawnSync(process.execPath, [TRIGGER], {
    cwd: d,
    encoding: "utf8",
    timeout: 30_000,
    input: JSON.stringify({ prompt, cwd: d, sessionId: "sess_ugate" }),
    env: env(),
  });
  return { code: r.status, json: (() => { try { return JSON.parse(r.stdout ?? ""); } catch { return null; } })(), out: r.stdout ?? "" };
}

function scratch(prefix, { checkArgv = ["node", "-e", "process.exit(0)"] } = {}) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  g(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  writeFileSync(
    join(d, "lzy.project.json"),
    `${JSON.stringify({ schemaVersion: 1, capabilities: { check: [{ id: "smoke", argv: checkArgv }], ci: { requiredChecks: REQ_CI } } }, null, 2)}\n`,
  );
  writeFileSync(join(d, "contract.md"), CONTRACT);
  writeFileSync(join(d, "plan.md"), PLAN);
  g(["add", "-A"]);
  g(["commit", "-qm", "fixture"]);
  g(["remote", "add", "origin", `https://github.com/${REPO}.git`]);
  return d;
}

function fakeGh(checks) {
  const dir = mkdtempSync(join(tmpdir(), "lzy-ugate-gh-"));
  const p = join(dir, "gh");
  writeFileSync(p, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(checks))});\n`);
  chmodSync(p, 0o755);
  return p;
}


const goalJson = (d) => JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
const nap = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };

// 已批准契约 + 已开跑的 v2 目标：register --contract → plan（拒：contractPending）→
// 真实 UPS 批准 → plan → start。批准只走钩子（不手写批准记录）。
function approvedGoal(prefix, opts) {
  const d = scratch(prefix, opts);
  const reg = lzy(d, ["loop", "register", "ugate", "--title", "t", "--contract", "contract.md"]);
  assert.equal(reg.code, 0, reg.out);
  const first = lzy(d, ["loop", "plan", "plan.md"]);
  assert.equal(first.code, 1, first.out);
  const short = goalJson(d).contractPending.contractHash.slice(0, 8);
  const h = hookRun(d, `批准 ${short}`);
  assert.equal(h.json?.additionalContext?.includes("Human approval recorded for contract"), true, h.out);
  const second = lzy(d, ["loop", "plan", "plan.md"]);
  assert.equal(second.code, 0, second.out);
  const start = lzy(d, ["loop", "start"]);
  assert.equal(start.code, 0, start.out);
  return d;
}

const REVIEW_REASON = /评审无在案运行——lzy review run/;

// 基态：unsatisfied 义务=评审底线+推导专项（M4 翻面 v4——夹具有清单 check/ci ⇒ verification-deps
// 推导在场）；其余义务与子句全 satisfied。
function assertReviewOnlyBlocker(gate) {
  assert.equal(gate.applicable, true);
  const bad = gate.obligations.filter((o) => o.state !== "satisfied");
  assert.deepEqual(bad.map((o) => o.id), ["review.general-correctness", "review.verification-deps"], gate.blockedReasons.join("\n"));
  assert.match(bad[0].reasons.join("\n"), REVIEW_REASON);
  assert.deepEqual(Object.entries(gate.clauses).filter(([, c]) => !c.ok).map(([n]) => n), []);
  assert.equal(gate.blocked, true);
}

test("基态+反例族 ②③④⑤⑥⑦：同一已批准契约夹具注入-恢复，原因逐体对应", () => {
  const d = approvedGoal("lzy-ugate-matrix-");
  const gh = fakeGh(REQ_CI.map((n) => ({ name: n, conclusion: "success" })));
  try {
    // 正判腿：真实执行回执（check）+ 真实 CI 读回（ci）——两义务满足
    const chk = runCheck(d, "smoke");
    assert.equal(chk.receipt.exit.code, 0);
    assert.equal(lzy(d, ["verify", "ci"], { LZY_GH_BIN: gh }).code, 0);
    // CI 回执清单轴 n/a（kind=ci 的 recipe.manifestHash=null 如实形态，0.4.0 M1 N8 修正）
    const gate0 = evaluateGate(d);
    assertReviewOnlyBlocker(gate0);
    assert.deepEqual(gate0.obligations.map((o) => `${o.id}:${o.state}`), [
      "review.general-correctness:unsatisfied",
      "review.verification-deps:unsatisfied",
      "check.smoke:satisfied",
      "ci.required-checks:satisfied",
    ]);
    // 反例②：错契约——契约文件盘上漂移（新哈希=新授权请求）
    const contractAbs = join(d, "contract.md");
    const original = readFileSync(contractAbs, "utf8");
    writeFileSync(contractAbs, original.replace("alpha works", "alpha works（改）"));
    const g2 = evaluateGate(d);
    assert.equal(g2.blocked, true);
    assert.match(g2.blockedReasons.join("\n"), /\[a\.contract-unmutated\] 契约已变/);
    assert.match(g2.blockedReasons.join("\n"), /策略输入身份漂移/);
    writeFileSync(contractAbs, original);
    assertReviewOnlyBlocker(evaluateGate(d));
    // 反例③：错候选——回执后候选前移（对旧候选的事实不冒充现行绿）
    const g3pre = spawnSync("git", ["-C", d, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(join(d, "b.txt"), "b\n");
    spawnSync("git", ["-C", d, "add", "b.txt"]); // 只加本文件：.lazyzcode/ 不入提交（reset --hard 才不会带走账本）
    spawnSync("git", ["-C", d, "commit", "-qm", "move"]);
    const g3 = evaluateGate(d);
    assert.equal(g3.blocked, true);
    assert.match(g3.blockedReasons.join("\n"), /候选已前移/);
    assert.match(g3.blockedReasons.join("\n"), /check\.smoke/);
    spawnSync("git", ["-C", d, "reset", "--hard", g3pre]);
    assertReviewOnlyBlocker(evaluateGate(d));
    // 反例④：CI 漏项——必需集合两项只回来一项（不能拿查到的项顶替完整集合）
    nap(8);
    const ghPartial = fakeGh([{ name: REQ_CI[0], conclusion: "success" }]);
    assert.equal(lzy(d, ["verify", "ci"], { LZY_GH_BIN: ghPartial }).code, 0);
    const g4 = evaluateGate(d);
    assert.equal(g4.blocked, true);
    assert.match(g4.blockedReasons.join("\n"), /ci\.required-checks/);
    assert.match(g4.blockedReasons.join("\n"), new RegExp(`必需检查「${REQ_CI[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}」missing`));
    nap(8);
    assert.equal(lzy(d, ["verify", "ci"], { LZY_GH_BIN: gh }).code, 0);
    assertReviewOnlyBlocker(evaluateGate(d));
    // 反例⑥：v2 目标契约缺席——契约文件被删（绑定在案=读不到即拒，不猜补）
    rmSync(contractAbs, { force: true });
    const g6 = evaluateGate(d);
    assert.equal(g6.blocked, true);
    assert.match(g6.blockedReasons.join("\n"), /\[a\.contract-readable\] 契约文件不可读或结构非法/);
    writeFileSync(contractAbs, original);
    assertReviewOnlyBlocker(evaluateGate(d));
    // 反例⑦：契约在案但验收映射缺项——F 项未覆盖 A2（注入缝：goal 对象覆盖，不写盘）
    const goal = goalJson(d);
    const cut = { ...goal, steps: goal.steps.map((s) => (s.id === "F2" ? { ...s, acceptsRefs: [] } : s)) };
    const g7 = evaluateGate(d, { goal: cut });
    assert.equal(g7.blocked, true);
    assert.match(g7.blockedReasons.join("\n"), /验收覆盖缺口：契约验收项 A2 无任何 F 项 accepts 引用/);
    // 脱节腿：F 项引用契约不存在的验收项
    const stray = { ...goal, steps: goal.steps.map((s) => (s.id === "F2" ? { ...s, acceptsRefs: ["A9"] } : s)) };
    const g7b = evaluateGate(d, { goal: stray });
    assert.match(g7b.blockedReasons.join("\n"), /验收覆盖脱节：F 项引用契约不存在的验收项 F2→A9/);
    assertReviewOnlyBlocker(evaluateGate(d));
    // 反例⑤：授权撤回——撤回在案即 b.authorized 非真（撤回短码见回执原文）。置于末位：
    // 其后走真实恢复流程（重规划被门拒并落新请求→真实批准→重规划过），恢复面同时被测。
    const short = goalJson(d).contract.contractHash.slice(0, 8);
    const w = hookRun(d, `撤回 ${short}`);
    assert.equal(w.json?.additionalContext?.includes("Withdrawal recorded"), true, w.out);
    const g5 = evaluateGate(d);
    assert.equal(g5.blocked, true);
    assert.match(g5.blockedReasons.join("\n"), /\[b\.authorized\] 契约授权已被用户撤回/);
    writeFileSync(join(d, "plan.md"), `${PLAN}\n<!-- replan -->\n`);
    const sup1 = lzy(d, ["loop", "supersede", "plan.md"]);
    assert.equal(sup1.code, 1, sup1.out);
    assert.match(sup1.out, /撤回|b\.authorized/);
    const h2 = hookRun(d, `批准 ${short}`);
    assert.equal(h2.json?.additionalContext?.includes("Human approval recorded for contract"), true, h2.out);
    const sup2 = lzy(d, ["loop", "supersede", "plan.md"]);
    assert.equal(sup2.code, 0, sup2.out);
    assert.equal(goalJson(d).attempt, 2, "supersede 开新代次");
    assertReviewOnlyBlocker(evaluateGate(d));
    assert.ok(readFileSync(join(d, "plan.md"), "utf8").includes("<!-- replan -->"));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("反例①：失败但可复用的回执不满足成功义务（V03——适用≠成功）", () => {
  const d = approvedGoal("lzy-ugate-fail-", { checkArgv: ["node", "-e", "process.exit(3)"] });
  try {
    const chk = runCheck(d, "smoke");
    assert.equal(chk.receipt.exit.code, 3);
    const g = evaluateGate(d);
    assert.equal(g.blocked, true);
    const ob = g.obligations.find((o) => o.id === "check.smoke");
    assert.equal(ob.state, "unsatisfied");
    assert.match(ob.reasons.join("\n"), /exit\.code==3（非 0）——失败回执可复用仅构成适用性事实，不满足成功义务（V03）/);
    // 回执本体在案（历史事实保留——适用性判定面 ≠ 成功义务面）
    assert.equal(listReceipts(d, "ugate").filter((r) => r.checkId === "smoke").length, 1);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("反例⑧：无契约 v2 目标不豁免评审义务（拍板 7——不存在「无契约→免评审」旁路）", () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-ugate-nocontract-"));
  try {
    const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
    g(["init", "-q"]);
    g(["config", "user.email", "t@t"]);
    g(["config", "user.name", "t"]);
    writeFileSync(join(d, "a.txt"), "a\n");
    g(["add", "a.txt"]);
    g(["commit", "-qm", "init"]);
    writeFileSync(join(d, "plan.md"), "- [N1] work\n");
    assert.equal(lzy(d, ["loop", "register", "ugnc", "--title", "t"], { LZY_ABLATE_HUMAN_GATE: "1" }).code, 0);
    assert.equal(lzy(d, ["loop", "plan", "plan.md"], { LZY_ABLATE_HUMAN_GATE: "1" }).code, 0);
    const gt = evaluateGate(d);
    assert.equal(gt.applicable, true);
    assert.equal(gt.blocked, true);
    assert.match(gt.blockedReasons.join("\n"), REVIEW_REASON);
    assert.equal(gt.obligations.length, 1); // 无清单=无 check/ci 义务；评审底线恒生成
    assert.equal(gt.obligations[0].id, "review.general-correctness");
    assert.match(gt.clauses.contractAndAuth.reasons.join("\n"), /无契约 v2 目标/);
    assert.deepEqual(gt.clauses.acceptanceCoverage.reasons, ["无契约——验收映射由计划 F 面承载（n.a.）"]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("真 CLI 面：finish 过统一门（v2 拒且非零）；gate explain 退出码契约与 v1 裁决行逐字", () => {
  const d = approvedGoal("lzy-ugate-cli-");
  try {
    runCheck(d, "smoke");
    for (const [id, ev] of [["N1", null], ["F1", "alpha-live"], ["F2", "beta-live"]]) {
      const r = ev ? lzy(d, ["step", "done", id, "--evidence", ev]) : lzy(d, ["step", "done", id]);
      assert.equal(r.code, 0, r.out);
    }
    const fin = lzy(d, ["loop", "finish"]);
    assert.notEqual(fin.code, 0);
    assert.match(fin.out, /统一门阻塞（政策层/);
    assert.match(fin.out, REVIEW_REASON);
    assert.equal(goalJson(d).status, "executing", "门阻塞不得置 done（状态与裁决一致）");
    const ex = lzy(d, ["gate", "explain"]);
    assert.notEqual(ex.code, 0);
    assert.match(ex.out, /裁决 BLOCKED/);
    assert.match(ex.out, /review\.general-correctness/);
    assert.match(ex.out, /快照 [0-9a-f]{8}/);
    // v1 分域：裁决行逐字 + 退出码 0（拍板 5）
    const gp = join(d, ".lazyzcode", "loop", "goal.json");
    const goal = JSON.parse(readFileSync(gp, "utf8"));
    delete goal.policy;
    goal.version = 1;
    writeFileSync(gp, `${JSON.stringify(goal, null, 2)}\n`);
    const ex1 = lzy(d, ["gate", "explain"]);
    assert.equal(ex1.code, 0, ex1.out);
    assert.match(ex1.out, /政策裁决不适用（v1 旧规则延续）/);
    assert.equal(evaluateGate(d).applicable, false);
    const fin1 = lzy(d, ["loop", "finish"]);
    assert.equal(fin1.code, 0, `v1 旧规则延续：既有成功路径不变（${fin1.out}）`);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── done 旧记录不免核两缝（queue 1182 / reconcile 853-858）─────────────────────
// 队列夹具：条目 endpoint A（无交付链）+ 项目清单就绪 + 已授权主契约；goal 槽位按需造
// 「done」态（v2=现行格式带策略记录；v1=demote 对照半）。
function queueFixture(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  writeFileSync(join(d, "lzy.project.json"), `${JSON.stringify({ schemaVersion: 1, capabilities: {} }, null, 2)}\n`);
  writeFileSync(join(d, "c-main.md"), "task: main\nendpoint: A\nscope: .\nrecipe: none\n\n- [A1] x\n");
  writeFileSync(join(d, "p.md"), "- [N1] x\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "fixture"]);
  const it = addQueueItem(d, { title: "ugate-item", contractFile: join(d, "c-main.md"), planFile: join(d, "p.md"), goalSlug: "ugateq", endpoint: "A" });
  recordAuthorization(d, { kind: "approval", slug: "ugateq", contractHash: it.contractHash, sessionId: "t", at: new Date().toISOString() });
  refreshQueue(d);
  return { d, it };
}

// 槽位造态：真注册 + 真采纳（v2 带策略记录）→ 置 done；v1 对照半=直写降级。
function doneGoalSlot(d, { v1 = false } = {}) {
  assert.equal(lzy(d, ["loop", "register", "ugateq", "--title", "t"], { LZY_ABLATE_HUMAN_GATE: "1" }).code, 0);
  writeFileSync(join(d, "slot-plan.md"), "- [N1] x\n");
  assert.equal(lzy(d, ["loop", "plan", "slot-plan.md"], { LZY_ABLATE_HUMAN_GATE: "1" }).code, 0);
  const gp = join(d, ".lazyzcode", "loop", "goal.json");
  const g = JSON.parse(readFileSync(gp, "utf8"));
  if (v1) {
    delete g.policy;
    g.version = 1;
  }
  g.status = "done";
  writeFileSync(gp, `${JSON.stringify(g, null, 2)}\n`);
}

test("缝 queue 1182：done 旧记录不免核——v2 blocked 回 ready；v1 对照半照常 completed", async () => {
  for (const v1 of [false, true]) {
    const { d, it } = queueFixture(v1 ? "lzy-ugate-q1-" : "lzy-ugate-q2-");
    try {
      doneGoalSlot(d, { v1 });
      const deps = { drive: async () => ({ ok: true, cause: "fake-ok" }) };
      const res = await runQueueDispatch(d, {}, deps);
      const item = loadQueue(d).items.find((x) => x.id === it.id);
      if (v1) {
        assert.equal(item.state, "completed", `v1 对照半：既有成功路径不变（${JSON.stringify(res)}）`);
        assert.equal(item.blockedReason ?? null, null);
      } else {
        assert.equal(item.state, "ready", `v2 done 记录过门被拒须回 ready：${JSON.stringify(res)}`);
        // 未竟收束的成因如实落 tx note（item.blockedReason 只在失败路径写，本路径=回 ready 续跑）
        const tx = loadDispatch(d).txs.find((t) => t.itemId === it.id);
        assert.equal(tx.phase, "killed", "未竟收束：tx 记 killed，消耗如实结算（不假完成）");
        assert.match(tx.note, /未竟（finish 未过：统一门阻塞（done 记录不免核/);
        assert.match(tx.note, REVIEW_REASON);
        assert.match(String(res.results?.[0]?.cause ?? ""), /统一门阻塞（done 记录不免核/);
      }
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }
});

test("缝 reconcile 853-858：done 追认前过门——v2 不追认（条目保持未决+trace 原因）；v1 对照半 settled", () => {
  for (const v1 of [false, true]) {
    const { d, it } = queueFixture(v1 ? "lzy-ugate-r1-" : "lzy-ugate-r2-");
    try {
      doneGoalSlot(d, { v1 });
      // 手工 open tx（走 saveDispatch 家族校验和/形状同源，不手写 JSON）
      const dj = loadDispatch(d) ?? { txs: [] };
      dj.txs.push({
        txId: "tx-manual-1",
        itemId: it.id,
        goalSlug: it.goalSlug,
        phase: "open",
        openedAt: new Date().toISOString(),
        settledAt: null,
        limits: { wallMs: null, points: null },
        segments: [],
        note: null,
      });
      saveDispatch(d, dj);
      const recount = reconcileDispatch(d);
      const item2 = loadQueue(d).items.find((x) => x.id === it.id);
      const v2 = recount.verdicts.find((v) => v.txId === "tx-manual-1");
      if (v1) {
        assert.equal(item2.state, "completed", `v1 对照半：追认照常（${JSON.stringify(recount)})`);
        assert.match(v2.verdict, /settled/);
      } else {
        assert.notEqual(item2.state, "completed", "v2 blocked 不追认：条目保持未决（不置 completed）");
        assert.match(item2.blockedReason, /reconcile 追认被统一门拒绝/);
        assert.match(item2.blockedReason, REVIEW_REASON);
        assert.match(v2.verdict, /blocked（统一门/);
        assert.equal(loadDispatch(d).txs.find((t) => t.txId === "tx-manual-1").phase, "open", "tx 留在可 reconcile 集（处置根因后可重跑）");
      }
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }
});

test("缝 delivery beginAct：v2 阻塞不落 acting 且 contractPending 不动；v1 对照半外发放行", () => {
  const d = approvedGoal("lzy-ugate-act-");
  try {
    writeFileSync(join(d, "cb.md"), "task: 交付B\nendpoint: B\nscope: .\nrecipe: none\n\n- [A1] x\n");
    writeFileSync(join(d, "cc.md"), "task: 交付C\nendpoint: C\nscope: .\nrecipe: none\n\n- [A1] x\n");
    const b = validateDeliveryContract(d, "B", join(d, "cb.md"));
    const c = validateDeliveryContract(d, "C", join(d, "cc.md"));
    bindDeliveryContract(d, "B", join(d, "cb.md"), b.hash);
    bindDeliveryContract(d, "C", join(d, "cc.md"), c.hash);
    recordAuthorization(d, { kind: "approval", slug: "ugate", contractHash: b.hash, sessionId: "t", at: new Date().toISOString() });
    recordAuthorization(d, { kind: "approval", slug: "ugate", contractHash: c.hash, sessionId: "t", at: new Date().toISOString() });
    // contractPending 置位（模拟待批状态）：门阻塞时须原样保留（授权待决不被政策层清掉）
    const gp = join(d, ".lazyzcode", "loop", "goal.json");
    const goal = JSON.parse(readFileSync(gp, "utf8"));
    goal.contractPending = { contractHash: b.hash, path: "cb.md", requestedAt: new Date().toISOString() };
    writeFileSync(gp, `${JSON.stringify(goal, null, 2)}\n`);
    writeFileSync(join(d, "body.md"), "pr body\n");
    const opts = { repo: REPO, branch: "v040", base: "main", head: "a".repeat(40), prTitle: "t", prBodyFile: "body.md" };
    const calls = [];
    const deps = {
      sleep: () => {},
      gitPush: () => { calls.push("git-push"); return { code: 0, stdout: "", stderr: "" }; },
      ghApi: (args) => { calls.push(args.join(" ")); return { code: 0, stdout: "{}", stderr: "" }; },
    };
    // v2：政策层 blocked → 外发前置拒（授权门之后、落 acting 之前——被阻塞的外发意图不落账）
    assert.throws(() => actDeliveryB(d, opts, deps), /外发前置统一门（ep B）阻塞/);
    assert.equal(calls.length, 0, `零外部调用，实得：${calls.join("|")}`);
    assert.equal((loadIntents(d)?.intents ?? []).length, 0, "被阻塞的外发意图不落账");
    assert.equal(JSON.parse(readFileSync(gp, "utf8")).contractPending.contractHash, b.hash, "contractPending 原样保留（授权待决不因政策层被清）");
    // v1 分域对照半：同夹具降 v1 → 门不适用，外发照常走到落 acting
    const g2 = JSON.parse(readFileSync(gp, "utf8"));
    delete g2.policy;
    g2.version = 1;
    writeFileSync(gp, `${JSON.stringify(g2, null, 2)}\n`);
    let merged = false;
    const deps2 = {
      sleep: () => {},
      gitPush: () => { calls.push("git-push2"); return { code: 0, stdout: "", stderr: "" }; },
      ghApi: (args) => {
        calls.push(args.join(" "));
        if (args[0] === "pr" && args[1] === "list") return { code: 0, stdout: "[]", stderr: "" };
        if (args[0] === "pr" && args[1] === "create") return { code: 0, stdout: JSON.stringify({ number: 7 }), stderr: "" };
        if (args[0] === "pr" && args[1] === "merge") {
          merged = true;
          return { code: 0, signal: null, stdout: "", stderr: "" };
        }
        if (args[0] === "pr" && args[1] === "view") {
          return {
            code: 0,
            stdout: JSON.stringify({
              state: merged ? "MERGED" : "OPEN",
              headRefOid: "a".repeat(40),
              baseRefName: "main",
              number: 7,
              url: "u",
              mergeCommit: merged ? { oid: "b".repeat(40) } : null,
            }),
            stderr: "",
          };
        }
        if (String(args[1] ?? "").includes("check-runs")) {
          return { code: 0, stdout: JSON.stringify([{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }]), stderr: "" };
        }
        return { code: 1, stdout: "", stderr: `fake 未匹配：${args.join(" ")}` };
      },
    };
    const out = actDeliveryB(d, opts, deps2);
    assert.equal(out.intent.status, "done", JSON.stringify(out));
    assert.equal(out.mergeSha, "b".repeat(40));
    assert.equal(loadIntents(d).intents[0].status, "done", "v1 对照半：外发意图照常落账并收束（既有成功路径不变）");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
