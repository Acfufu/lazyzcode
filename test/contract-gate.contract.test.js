// 契约门（0.3.0 M1，ADR-0024）契约：CLI 闸（contract gate 五查+contractPending 幂等再置）
// 与钩子（契约批准双分派+撤回短语）两面，加 authorizations 账本家族义务（reset 存活+无疤痕）。
// 家法同 human-gate.contract.test.js：真子进程、HOME 隔离、恰 "1" 消融矩阵。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = join(ROOT, "cli", "lzy.js");
const TRIGGER = join(ROOT, "plugin", "hooks", "trigger.js");
const SUPPRESS_ENGINE = "lzy-test-suppress";

const sha = (b) => createHash("sha256").update(b).digest("hex");

function scratch() {
  const d = mkdtempSync(join(tmpdir(), "lzy-cg-"));
  const HOME = mkdtempSync(join(tmpdir(), "lzy-cg-home-"));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  return { d, HOME };
}

function lzy(args, s, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: s.d,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      LZY_ABLATE_HUMAN_GATE: "",
      HOME: s.HOME,
      USERPROFILE: s.HOME,
      LZY_ZCODE_ENGINE: SUPPRESS_ENGINE,
      ...env,
    },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function hookRun(prompt, s, env = {}) {
  const r = spawnSync(process.execPath, [TRIGGER], {
    cwd: s.d,
    encoding: "utf8",
    timeout: 30_000,
    input: JSON.stringify({ prompt, cwd: s.d, sessionId: "sess_cg" }),
    env: { ...process.env, HOME: s.HOME, USERPROFILE: s.HOME, ...env },
  });
  return { code: r.status, json: (() => { try { return JSON.parse(r.stdout ?? ""); } catch { return null; } })(), out: r.stdout ?? "" };
}

const readGoalJson = (s) => JSON.parse(readFileSync(join(s.d, ".lazyzcode", "loop", "goal.json"), "utf8"));
const authDir = (s) => join(s.d, ".lazyzcode", "authorizations");
const authNames = (s) => (existsSync(authDir(s)) ? readdirSync(authDir(s)).filter((f) => f.endsWith(".json")) : []);

// 契约 goal 现场合法化：采纳→批准→采纳→start，返回契约短码。
function authorizeAndStart(s) {
  lzy(["loop", "plan", "plan.md"], s); // 第一次拒：落 contractPending
  const goal = readGoalJson(s);
  const short = goal.contractPending.contractHash.slice(0, 8);
  const hook = hookRun(`批准 ${short}`, s);
  assert.equal(hook.json?.additionalContext?.includes("Human approval recorded for contract"), true);
  const adopt2 = lzy(["loop", "plan", "plan.md"], s);
  assert.equal(adopt2.code, 0, adopt2.out);
  const start = lzy(["loop", "start"], s);
  assert.equal(start.code, 0, start.out);
  return short;
}

function fixture(s, { recipeLine = "recipe: none" } = {}) {
  writeFileSync(join(s.d, "contract.md"), `task: gate-demo\nendpoint: A\nscope: .\n${recipeLine}\n\n- [A1] alpha works\n- [A2] beta works\n`);
  writeFileSync(join(s.d, "plan.md"), "- [N1] work\n- [F1] alpha\naccepts: A1\n- [F2] beta\naccepts: A2\n");
  lzy(["loop", "register", "cg", "--title", "t", "--contract", "contract.md"], s);
}

test("register --contract 坏契约拒（缺必填键）且不落 goal", () => {
  const s = scratch();
  writeFileSync(join(s.d, "bad.md"), "endpoint: A\n\n- [A1] x\n");
  const r = lzy(["loop", "register", "cg", "--title", "t", "--contract", "bad.md"], s);
  assert.equal(r.code, 1);
  assert.match(r.out, /契约无效/);
  assert.equal(existsSync(join(s.d, ".lazyzcode", "loop", "goal.json")), false);
});

test("门：契约 goal 首采拒——contractPending 落盘且报文带契约短码；批准句错码不记录", () => {
  const s = scratch();
  fixture(s);
  const r1 = lzy(["loop", "plan", "plan.md"], s);
  assert.equal(r1.code, 1);
  const short = readGoalJson(s).contractPending.contractHash.slice(0, 8);
  assert.match(r1.out, new RegExp(short));
  assert.match(r1.out, /批准/);
  const wrong = hookRun(`批准 ${"0".repeat(8)}`, s);
  assert.equal(wrong.json?.additionalContext?.includes("mismatch"), true);
  assert.equal(authNames(s).length, 0);
});

test("门：批准→采纳过；approvalPending 全程恒 null（契约 goal 不产生 planHash 门）；contractPending 放行即清", () => {
  const s = scratch();
  fixture(s);
  lzy(["loop", "plan", "plan.md"], s);
  // register 阶段尚未写入 approvalPending 键（undefined）——契约 goal 全程不得出现真值。
  assert.equal(readGoalJson(s).approvalPending ?? null, null);
  const short = readGoalJson(s).contractPending.contractHash.slice(0, 8);
  hookRun(`批准 ${short}`, s);
  const r2 = lzy(["loop", "plan", "plan.md"], s);
  assert.equal(r2.code, 0, r2.out);
  const goal = readGoalJson(s);
  assert.equal(goal.approvalPending, null);
  assert.equal(goal.contractPending, null);
  assert.equal(authNames(s).length, 1);
});

test("门查 c：覆盖缺口拒（删验收项=扩大权限）；坏引用同拒", () => {
  const s = scratch();
  fixture(s);
  authorizeAndStart(s);
  writeFileSync(join(s.d, "gap.md"), "- [N1] w\n- [F1] alpha only\naccepts: A1\n");
  const r = lzy(["loop", "supersede", "gap.md"], s);
  assert.equal(r.code, 1);
  assert.match(r.out, /查 c/);
  assert.match(r.out, /A2/);
  writeFileSync(join(s.d, "badref.md"), "- [N1] w\n- [F1] x\naccepts: A9\n- [F2] beta\naccepts: A2\n");
  const r2 = lzy(["loop", "supersede", "badref.md"], s);
  assert.equal(r2.code, 1);
  assert.match(r2.out, /A9/);
});

test("门查 d：subject 出 scope 拒", () => {
  const s = scratch();
  fixture(s);
  const sib = mkdtempSync(join(tmpdir(), "lzy-cg-sib-"));
  spawnSync("git", ["init", "-q"], { cwd: sib });
  spawnSync("git", ["config", "user.email", "t@t"], { cwd: sib });
  spawnSync("git", ["config", "user.name", "t"], { cwd: sib });
  writeFileSync(join(sib, "x.txt"), "x\n");
  spawnSync("git", ["add", "-A"], { cwd: sib });
  spawnSync("git", ["commit", "-qm", "s"], { cwd: sib });
  authorizeAndStart(s);
  writeFileSync(join(s.d, "out.md"), `subjects: ${sib}\n\n- [N1] w\n- [F1] alpha\naccepts: A1\n- [F2] beta\naccepts: A2\n`);
  const r = lzy(["loop", "supersede", "out.md"], s);
  assert.equal(r.code, 1);
  assert.match(r.out, /查 d/);
  rmSync(sib, { recursive: true, force: true });
});

test("门查 e：配方漂移拒；查 a：契约文件漂移拒", () => {
  const s = scratch();
  writeFileSync(join(s.d, "lzy.project.json"), "v1\n");
  fixture(s, { recipeLine: `recipe: ${sha("v1\n").slice(0, 8)}` });
  const short = (() => {
    lzy(["loop", "plan", "plan.md"], s);
    return readGoalJson(s).contractPending.contractHash.slice(0, 8);
  })();
  hookRun(`批准 ${short}`, s);
  assert.equal(lzy(["loop", "plan", "plan.md"], s).code, 0);
  // 配方漂移（查 e）
  writeFileSync(join(s.d, "lzy.project.json"), "v2\n");
  const re = lzy(["loop", "plan", "plan.md"], s);
  assert.equal(re.code, 1);
  assert.match(re.out, /查 e/);
  assert.match(re.out, /配方已漂移/);
  // 恢复配方后契约文件漂移（查 a）——改契约=新哈希
  writeFileSync(join(s.d, "lzy.project.json"), "v1\n");
  writeFileSync(join(s.d, "contract.md"), `task: gate-demo\nendpoint: A\nscope: .\nrecipe: ${sha("v1\n").slice(0, 8)}\n\n- [A1] alpha works changed\n- [A2] beta works\n`);
  const ra = lzy(["loop", "plan", "plan.md"], s);
  assert.equal(ra.code, 1);
  assert.match(ra.out, /查 a/);
});

test("撤回：批准→生效→撤回→supersede 被拒点名撤回→再批准重新生效", () => {
  const s = scratch();
  fixture(s);
  const short = authorizeAndStart(s);
  const w = hookRun(`撤回 ${short}`, s);
  assert.equal(w.json?.additionalContext?.includes("Withdrawal recorded"), true);
  writeFileSync(join(s.d, "plan.md"), "- [N1] work v2\n- [F1] alpha\naccepts: A1\n- [F2] beta\naccepts: A2\n");
  const r = lzy(["loop", "supersede", "plan.md"], s);
  assert.equal(r.code, 1);
  assert.match(r.out, /撤回/);
  assert.match(r.out, /查 b/);
  const re = hookRun(`批准 ${short}`, s);
  assert.equal(re.json?.additionalContext?.includes("Human approval recorded"), true);
  assert.equal(lzy(["loop", "supersede", "plan.md"], s).code, 0);
  const kinds = authNames(s).map((f) => JSON.parse(readFileSync(join(authDir(s), f), "utf8")).kind).sort();
  assert.deepEqual(kinds, ["approval", "approval", "withdrawal"]);
});

test("钩子：契约批准 exact-hash 复核——批准后改契约文件，批准作废", () => {
  const s = scratch();
  fixture(s);
  lzy(["loop", "plan", "plan.md"], s);
  const short = readGoalJson(s).contractPending.contractHash.slice(0, 8);
  writeFileSync(join(s.d, "contract.md"), `task: gate-demo\nendpoint: A\nscope: .\nrecipe: none\n\n- [A1] alpha works CHANGED\n- [A2] beta works\n`);
  const h = hookRun(`批准 ${short}`, s);
  assert.equal(h.json?.additionalContext?.includes("void"), true);
  assert.equal(authNames(s).length, 0);
});

test("消融矩阵：LZY_ABLATE_HUMAN_GATE 恰 \"1\" 才放行无批准采纳；钩子侧恰 \"1\" 双分支同灭", () => {
  const s = scratch();
  fixture(s);
  const ablated = lzy(["loop", "plan", "plan.md"], s, { LZY_ABLATE_HUMAN_GATE: "1" });
  assert.equal(ablated.code, 0, ablated.out);
  assert.equal(authNames(s).length, 0);
  const s2 = scratch();
  fixture(s2);
  const notAblated = lzy(["loop", "plan", "plan.md"], s2, { LZY_ABLATE_HUMAN_GATE: "" });
  assert.equal(notAblated.code, 1);
  const s3 = scratch();
  fixture(s3);
  lzy(["loop", "plan", "plan.md"], s3);
  const short = readGoalJson(s3).contractPending.contractHash.slice(0, 8);
  const hookOff = hookRun(`批准 ${short}`, s3, { LZY_ABLATE_HOOK_HUMAN_GATE: "1" });
  assert.deepEqual(hookOff.json ?? {}, {}); // 恰 "1" 短路=failOpen 空 JSON，无诊断无记录
  assert.equal(authNames(s3).length, 0);
});

test("账本家族：authorizations reset 存活；孤儿 tmp 计数可见（两面同一清单）", () => {
  const s = scratch();
  fixture(s);
  const short = authorizeAndStart(s);
  assert.equal(lzy(["loop", "reset"], s).code, 0);
  assert.equal(authNames(s).length, 1, "authorizations/ 追加式 reset 不清");
  mkdirSync(authDir(s), { recursive: true });
  writeFileSync(join(authDir(s), ".orphan.123.tmp"), "x");
  const status = lzy(["loop", "status"], s);
  assert.equal(status.code, 0); // 无 goal 读面：恢复式报文（不静默接管），退出码 0
  assert.match(status.out, /没有目标循环状态/);
});
