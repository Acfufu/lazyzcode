// 交付授权 hook 面契约测试（0.3.0 M4，ADR-0028，拍板 2）：spawn 真钩子（plugin/hooks/
// trigger.js）+ stdin 模拟 UPS 事件——批准分支对 delivery 契约（contractPending 三字段）
// 零改动即生效（评审最重 seam 的活体钉）；撤回分支短码集合扩展=[goal.contract, …delivery]
// 零命中列全码、原 goal 契约撤回语义回归。授权记录形状两侧同钉（contract-gate 套件）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { effectiveAuthorization, loadAuthorizations, loadContract, recordAuthorization } from "../core/contract.js";
import { bindDeliveryContract } from "../core/loop.js";

const HOME = mkdtempSync(join(tmpdir(), "lzy-dhook-home-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const TRIGGER = join(ROOT, "plugin", "hooks", "trigger.js");

function lzyIn(d, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: d, encoding: "utf8", timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "/nonexistent-lzy-suppressed" },
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function hookRun(d, prompt) {
  const r = spawnSync(process.execPath, [TRIGGER], {
    input: JSON.stringify({ prompt, cwd: d, session_id: "dhook" }),
    encoding: "utf8", timeout: 30_000,
    env: { ...process.env, HOME, USERPROFILE: HOME },
  });
  return { status: r.status, out: r.stdout ?? "" };
}

// 契约 goal 夹具：register --contract → 预置批准（recordAuthorization=测试写者）→ plan → start
// → 绑定 delivery B 契约（contractPending 指向 delivery 哈希）。
function contractGoalRepo(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  g(["remote", "add", "origin", "https://github.com/Acfufu/lazyzcode.git"]);
  writeFileSync(join(d, "goalc.md"), "task: goal 主契约\nendpoint: B\nscope: .\nrecipe: none\n\n- [A1] x\n");
  const main = loadContract(join(d, "goalc.md"), d);
  const r1 = lzyIn(d, ["loop", "register", "dhook", "--title", "t", "--contract", "goalc.md"]);
  if (r1.status !== 0) throw new Error(`register 失败：${r1.out}`);
  recordAuthorization(d, { kind: "approval", slug: "dhook", contractHash: main.hash, sessionId: "seed", at: new Date().toISOString() });
  writeFileSync(join(d, "p.md"), "- [N1] x\n- [F1] m\naccepts: A1\n");
  const r2 = lzyIn(d, ["loop", "plan", "p.md"]);
  if (r2.status !== 0) throw new Error(`plan 失败：${r2.out}`);
  const r3 = lzyIn(d, ["loop", "start"]);
  if (r3.status !== 0) throw new Error(`start 失败：${r3.out}`);
  writeFileSync(join(d, "db.md"), "task: 交付B\nendpoint: B\nscope: .\nrecipe: none\n\n- [A1] x\n");
  const db = loadContract(join(d, "db.md"), d);
  bindDeliveryContract(d, "B", join(d, "db.md"), db.hash);
  return { d, mainHash: main.hash, dbHash: db.hash };
}

const authCount = (d, hash, kind) => loadAuthorizations(d).filter((r) => r.contractHash === hash && r.kind === kind).length;

test("①批准分支对 delivery 契约零改动即生效：contractPending=delivery 哈希→「批准 <短码>」落账", () => {
  const { d, dbHash } = contractGoalRepo("lzy-dhook-1-");
  try {
    assert.equal(effectiveAuthorization(d, "dhook", dbHash).authorized, false);
    const r = hookRun(d, `批准 ${dbHash.slice(0, 8)}`);
    assert.match(r.out, /Human approval recorded for contract of goal dhook/);
    assert.equal(effectiveAuthorization(d, "dhook", dbHash).authorized, true, "delivery 契约授权应生效");
    assert.equal(authCount(d, dbHash, "approval"), 1);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("②批准后哈希漂移=短码作废（contractPath exact-hash 复核活体）", () => {
  const { d, dbHash } = contractGoalRepo("lzy-dhook-2-");
  try {
    writeFileSync(join(d, "db.md"), "task: 交付B 被篡改\nendpoint: B\nscope: .\nrecipe: none\n\n- [A1] x\n");
    const r = hookRun(d, `批准 ${dbHash.slice(0, 8)}`);
    assert.match(r.out, /Contract changed since this approval was requested/);
    assert.equal(effectiveAuthorization(d, "dhook", dbHash).authorized, false, "漂移后不得落账");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("③撤回分支扩展：delivery 短码撤回落账（后到者赢）", () => {
  const { d, dbHash } = contractGoalRepo("lzy-dhook-3-");
  try {
    recordAuthorization(d, { kind: "approval", slug: "dhook", contractHash: dbHash, sessionId: "seed", at: new Date().toISOString() });
    assert.equal(effectiveAuthorization(d, "dhook", dbHash).authorized, true);
    const r = hookRun(d, `撤回 ${dbHash.slice(0, 8)}`);
    assert.match(r.out, /Withdrawal recorded for goal dhook/);
    assert.equal(effectiveAuthorization(d, "dhook", dbHash).authorized, false, "撤回对生效判定立即翻转");
    assert.equal(authCount(d, dbHash, "withdrawal"), 1);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("④主契约撤回语义回归：goal 契约短码仍可撤回（扩展不破旧行为）", () => {
  const { d, mainHash } = contractGoalRepo("lzy-dhook-4-");
  try {
    const r = hookRun(d, `撤回 ${mainHash.slice(0, 8)}`);
    assert.match(r.out, /Withdrawal recorded for goal dhook/);
    assert.equal(effectiveAuthorization(d, "dhook", mainHash).authorized, false);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑤零命中：mismatch 诊断列出全部合法短码且零记录", () => {
  const { d, mainHash, dbHash } = contractGoalRepo("lzy-dhook-5-");
  try {
    const before = loadAuthorizations(d).length;
    const r = hookRun(d, "撤回 deadbeef");
    assert.match(r.out, /Withdrawal code mismatch/);
    assert.match(r.out, new RegExp(mainHash.slice(0, 8)));
    assert.match(r.out, new RegExp(dbHash.slice(0, 8)));
    assert.match(r.out, /Nothing was recorded/);
    assert.equal(loadAuthorizations(d).length, before, "零命中零记录");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── 0.3.1 棒1（ADR-0030 修正节，N5）：钩子 queue-pending 批准解析支 ──
// 夹具：真 CLI queue add（endpoint B + delivery 契约）→ 入队时 goal 尚不存在，
// 批准须由队列待批准面解析（同短语/同记录形状/同目录）。
function queueDeliveryRepo(prefix, { twoItems = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  writeFileSync(
    join(d, "lzy.project.json"),
    JSON.stringify({ schemaVersion: 1, capabilities: { check: [{ id: "smoke", argv: ["node", "-e", "process.exit(0)"], timeoutMs: 30000 }] } }),
  );
  writeFileSync(join(d, "c-main-b.md"), "task: main B\nendpoint: B\nscope: .\nrecipe: none\n\n- [A1] x\n");
  writeFileSync(join(d, "cb.md"), "task: B 交付\nendpoint: B\nscope: .\nrepo: Acfufu/lazyzcode\nbase: main\nbranch: v031\npr-title: t\n\n- [A1] x\n");
  writeFileSync(join(d, "cc.md"), "task: C 交付\nendpoint: C\nscope: .\nrepo: Acfufu/lazyzcode\nexpect-marker: v0.3.1\n\n- [A1] x\n");
  writeFileSync(join(d, "p.md"), "- [N1] x\n- [F1] marker\n");
  g(["add", "-A"]);
  g(["commit", "-qm", "fixture"]);
  const args = ["queue", "add", "b-item", "--contract", "c-main-b.md", "--plan", "p.md", "--endpoint", "B", "--delivery-b", "cb.md", "--delivery-c", "cc.md", "--goal-slug", "qb1"];
  const r1 = lzyIn(d, args);
  if (r1.status !== 0) throw new Error(`queue add 失败：${r1.out}`);
  if (twoItems) {
    const r2 = lzyIn(d, [...args, "--goal-slug", "qb2"]);
    if (r2.status !== 0) throw new Error(`queue add2 失败：${r2.out}`);
  }
  const hash = loadContract(join(d, "cb.md"), d).hash;
  return { d, hash, short: hash.slice(0, 8) };
}

const authTotal = (d) => loadAuthorizations(d).length;

test("⑥queue-pending 批准：短码命中→同族记录（slug=条目 goalSlug/hash=交付契约）+确认文案含 item/ep；双跑字节一致", () => {
  const { d, hash, short } = queueDeliveryRepo("lzy-dhook-6-");
  try {
    const before = authTotal(d);
    const r1 = hookRun(d, `批准 ${short}`);
    assert.match(r1.out, new RegExp(`Human approval recorded for delivery B of queue item q1 \\(short code ${short}\\)`));
    assert.equal(authTotal(d), before + 1, "须恰写一条记录");
    const rec = loadAuthorizations(d).at(-1);
    assert.equal(rec.kind, "approval");
    assert.equal(rec.slug, "qb1");
    assert.equal(rec.contractHash, hash);
    assert.equal(effectiveAuthorization(d, "qb1", hash).authorized, true);
    // 双跑确定性：同态同输入 → 逐字节同输出
    const r2 = hookRun(d, `批准 ${short}`);
    assert.equal(r2.out, r1.out, "二次同态批准输出须逐字节一致");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑦错码：有候选不匹配→列出待批准短码且零记录（可诊断不出刀）", () => {
  const { d, short } = queueDeliveryRepo("lzy-dhook-7-");
  try {
    const before = authTotal(d);
    const r = hookRun(d, "批准 deadbeef");
    assert.match(r.out, /No pending approval matches this code/);
    assert.match(r.out, new RegExp(`q1/B（${short}）`));
    assert.match(r.out, /Nothing was recorded/);
    assert.equal(authTotal(d), before, "错码零记录");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑧漂移作废：入队后改交付契约→短码作废且零记录", () => {
  const { d, short } = queueDeliveryRepo("lzy-dhook-8-");
  try {
    const before = authTotal(d);
    writeFileSync(join(d, "cb.md"), "task: B 交付（改）\nendpoint: B\nscope: .\nrepo: Acfufu/lazyzcode\nbase: main\nbranch: v031\npr-title: t\n\n- [A1] x\n");
    const r = hookRun(d, `批准 ${short}`);
    assert.match(r.out, /changed since it was enqueued/);
    assert.match(r.out, /Nothing was recorded/);
    assert.equal(authTotal(d), before, "漂移零记录");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑨多命中拒猜：两条目共用同一交付契约→列候选且零记录（沿 8hex 碰撞家法）", () => {
  const { d, short } = queueDeliveryRepo("lzy-dhook-9-", { twoItems: true });
  try {
    const before = authTotal(d);
    const r = hookRun(d, `批准 ${short}`);
    assert.match(r.out, /matches multiple queue items — refusing to guess/);
    assert.match(r.out, /q1\/B/);
    assert.match(r.out, /q2\/B/);
    assert.equal(authTotal(d), before, "多命中零记录");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑩queue.json 损坏/缺席：fail-open 落回既有诊断支（零记录零崩溃）", () => {
  const { d, short } = queueDeliveryRepo("lzy-dhook-10-");
  try {
    const before = authTotal(d);
    writeFileSync(join(d, ".lazyzcode", "queue", "queue.json"), "{ 坏 JSON");
    const r = hookRun(d, `批准 ${short}`);
    assert.equal(r.status, 0, "损坏面不得炸钩子");
    assert.match(r.out, /no goal loop is registered/);
    assert.equal(authTotal(d), before, "损坏零记录");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("⑪优先级钉子：goal 侧 approvalPending 在场时 queue 支不得抢先（计划批准走 legacy 分支）", () => {
  const { d, short } = queueDeliveryRepo("lzy-dhook-11-");
  try {
    // 造 goal 侧 pending：register + 首次采纳（未批准 → approvalPending 落盘）
    const r1 = lzyIn(d, ["loop", "register", "dprio", "--title", "t"]);
    if (r1.status !== 0) throw new Error(r1.out);
    const r2 = lzyIn(d, ["loop", "plan", "p.md"]);
    assert.notEqual(r2.status, 0, "首采应停在人权门");
    const pending = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8")).approvalPending;
    assert.ok(pending?.planHash, "须有 plan pending");
    const before = authTotal(d);
    const r = hookRun(d, `批准 ${pending.planHash.slice(0, 8)}`);
    assert.match(r.out, /Human approval recorded for plan dprio/, "goal 侧计划批准必须走 legacy 分支");
    assert.equal(authTotal(d), before, "queue 支不得越权写 authorizations");
    // 反向：交付码在 goal pending 在场时也不得被 queue 支解析
    const r2b = hookRun(d, `批准 ${short}`);
    assert.match(r2b.out, /Approval code mismatch — the pending plan short code is/, "goal pending 在场时按 legacy 报错（含其短码）");
    assert.equal(authTotal(d), before, "零误写");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
