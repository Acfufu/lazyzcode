// 交付授权 hook 面契约测试（0.3.0 M4，ADR-0028，拍板 2）：spawn 真钩子（plugin/hooks/
// trigger.js）+ stdin 模拟 UPS 事件——批准分支对 delivery 契约（contractPending 三字段）
// 零改动即生效（评审最重 seam 的活体钉）；撤回分支短码集合扩展=[goal.contract, …delivery]
// 零命中列全码、原 goal 契约撤回语义回归。授权记录形状两侧同钉（contract-gate 套件）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
