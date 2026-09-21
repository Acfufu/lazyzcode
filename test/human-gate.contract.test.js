// 人权门（0.1.1 goal1，ADR-0018）契约：门（CLI 采纳面）与钩子（UPS 批准分支）两面。
// 本文件是唯一被测人权门的文件——其余触采纳面的测试文件顶部落 LZY_ABLATE_HUMAN_GATE=1 通行。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
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
  const d = mkdtempSync(join(tmpdir(), "lzy-hg-"));
  const HOME = mkdtempSync(join(tmpdir(), "lzy-hg-home-")); // HOME 隔离：不读真实引擎日志
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
      LZY_ABLATE_HUMAN_GATE: "", // 默认门在（恰 "1" 才消融）；用例按需覆盖
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
    input: JSON.stringify({ prompt, cwd: s.d, sessionId: "sess_hg" }),
    env: { ...process.env, HOME: s.HOME, USERPROFILE: s.HOME, ...env },
  });
  return { code: r.status, out: r.stdout ?? "" };
}

// cwd 漂移形态（债 E 事故建模）：进程 cwd 与引擎投递的 input.cwd 分离——规划期 cd 后
// 用户发批准句，钩子按 input.cwd 就地读 goal 读不到。input.cwd 由本助手显式指定。
function hookRunAt(prompt, atCwd, s, env = {}) {
  const r = spawnSync(process.execPath, [TRIGGER], {
    cwd: s.d,
    encoding: "utf8",
    timeout: 30_000,
    input: JSON.stringify({ prompt, cwd: atCwd, sessionId: "sess_hg" }),
    env: { ...process.env, HOME: s.HOME, USERPROFILE: s.HOME, ...env },
  });
  return { code: r.status, out: r.stdout ?? "" };
}

const sessionsDir = (s) => join(s.d, ".lazyzcode", "loop", "sessions");

const PLAN1 = "- [N1] item one\n";
const PLAN2 = "- [N1] item one changed\n";
const approvalsDir = (s) => join(s.d, ".lazyzcode", "loop", "approvals");
const readGoalJson = (s) => JSON.parse(readFileSync(join(s.d, ".lazyzcode", "loop", "goal.json"), "utf8"));

function registerGoal(s) {
  writeFileSync(join(s.d, "plan.md"), PLAN1);
  lzy(["loop", "register", "t1", "--title", "t"], s);
}

function writeRecord(s, slug, planHash, tag = "r1") {
  mkdirSync(approvalsDir(s), { recursive: true });
  writeFileSync(
    join(approvalsDir(s), `${planHash.slice(0, 8)}-${tag}.json`),
    JSON.stringify({ version: 1, slug, planHash, at: "2026-09-19T00:00:00.000Z", sessionId: "sess_fixture" }),
  );
}

test("门：无批准记录采纳拒——报文含短码与恢复指引，goal 留 planning 且 approvalPending 落盘", () => {
  const s = scratch();
  registerGoal(s);
  const r = lzy(["loop", "plan", "plan.md"], s);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes("人权门未过"));
  assert.ok(r.out.includes(sha(PLAN1).slice(0, 8)));
  assert.ok(r.out.includes("批准"));
  assert.ok(r.out.includes("UserPromptSubmit"));
  const goal = readGoalJson(s);
  assert.equal(goal.status, "planning");
  assert.equal(goal.approvalPending.planHash, sha(PLAN1));
  assert.ok(goal.approvalPending.planPath);
});

test("门：记录在位采纳过——steps 落地且 approvalPending 清 null", () => {
  const s = scratch();
  registerGoal(s);
  lzy(["loop", "plan", "plan.md"], s); // 拒（写 pending）
  writeRecord(s, "t1", sha(PLAN1));
  const r = lzy(["loop", "plan", "plan.md"], s);
  assert.equal(r.code, 0);
  assert.equal(readGoalJson(s).approvalPending, null);
  assert.equal(readGoalJson(s).steps.length, 1);
});

test("门：slug 错配与 hash 错配的记录都拒", () => {
  const s = scratch();
  registerGoal(s);
  lzy(["loop", "plan", "plan.md"], s);
  writeRecord(s, "other-slug", sha(PLAN1));
  assert.equal(lzy(["loop", "plan", "plan.md"], s).code, 1);
  rmSync(approvalsDir(s), { recursive: true, force: true });
  writeRecord(s, "t1", sha(PLAN2)); // hash 属别的计划
  assert.equal(lzy(["loop", "plan", "plan.md"], s).code, 1);
});

test("门：--force 不越过（无逃生 flag）", () => {
  const s = scratch();
  registerGoal(s);
  lzy(["loop", "plan", "plan.md"], s);
  assert.ok(lzy(["loop", "plan", "plan.md", "--force"], s).out.includes("人权门未过"));
});

test("门：批准后改计划文件=记录过期，重拒且 pending 刷新为新 hash", () => {
  const s = scratch();
  registerGoal(s);
  lzy(["loop", "plan", "plan.md"], s);
  writeRecord(s, "t1", sha(PLAN1));
  writeFileSync(join(s.d, "plan.md"), PLAN2);
  const r = lzy(["loop", "plan", "plan.md"], s);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes(sha(PLAN2).slice(0, 8)));
  assert.equal(readGoalJson(s).approvalPending.planHash, sha(PLAN2));
});

test("门：LIGHT 同门（双档全适用，V3 表4 H1）", () => {
  const s = scratch();
  registerGoal(s); // 默认 light
  assert.equal(lzy(["loop", "plan", "plan.md"], s).code, 1);
});

test("门：supersede 同门——新 hash 无批准拒，批准后开新代次", () => {
  const s = scratch();
  registerGoal(s);
  lzy(["loop", "plan", "plan.md"], s);
  writeRecord(s, "t1", sha(PLAN1));
  assert.equal(lzy(["loop", "plan", "plan.md"], s).code, 0);
  assert.equal(lzy(["loop", "start"], s).code, 0);
  writeFileSync(join(s.d, "plan.md"), PLAN2);
  const r = lzy(["loop", "supersede", "plan.md"], s);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes(sha(PLAN2).slice(0, 8)));
  writeRecord(s, "t1", sha(PLAN2), "r2");
  assert.equal(lzy(["loop", "supersede", "plan.md"], s).code, 0);
  assert.equal(readGoalJson(s).attempt, 2); // register 起 attempt=1，supersede 开 2
});

test("开关：LZY_ABLATE_HUMAN_GATE 恰 \"1\" 消融，空串/0/true 皆门在", () => {
  const s = scratch();
  registerGoal(s);
  assert.equal(lzy(["loop", "plan", "plan.md"], s, { LZY_ABLATE_HUMAN_GATE: "1" }).code, 0);
  for (const v of ["", "0", "true"]) {
    const s2 = scratch();
    registerGoal(s2);
    assert.equal(lzy(["loop", "plan", "plan.md"], s2, { LZY_ABLATE_HUMAN_GATE: v }).code, 1, `值 ${JSON.stringify(v)} 必须门在`);
  }
});

test("钩子：短码不符——纠错报文报 pending 短码，零记录", () => {
  const s = scratch();
  registerGoal(s);
  lzy(["loop", "plan", "plan.md"], s);
  const r = hookRun("批准 deadbeef", s);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes("mismatch"));
  assert.ok(r.out.includes(sha(PLAN1).slice(0, 8)));
  assert.ok(!existsSync(approvalsDir(s)));
});

test("钩子：否定形态零记录照走既有管线（全矩阵，V021-ADJ-56）", () => {
  const s = scratch();
  registerGoal(s);
  lzy(["loop", "plan", "plan.md"], s);
  const code = sha(PLAN1).slice(0, 8);
  // 旧守卫只挡紧邻「不/别」，以下全形都照写记录（门语义缺口）——矩阵钉死全否。
  const negations = [
    `不批准 ${code}`,
    `别批准 ${code}`,
    `不要批准 ${code}`,
    `不准批准 ${code}`,
    `未批准 ${code}`,
    `请勿批准 ${code}`,
    `拒绝批准 ${code}`,
    `don't approve ${code}`,
    `do not approve ${code}`,
    `我不批准 ${code}`,
  ];
  for (const p of negations) {
    const r = hookRun(p, s);
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "{}", `${JSON.stringify(p)} 落回触发词逻辑→failOpen {}`);
    assert.ok(!existsSync(approvalsDir(s)), `${JSON.stringify(p)} 不得写记录`);
  }
  // 反向（防误伤）：否定词在批准词**之后**、或与批准词隔着句读的另一分句，都仍算批准。
  const approvals = [
    `批准 ${code}，不要改计划`,
    `批准 ${code}。不要改计划`,
    `不要改计划，批准 ${code}`,
    `请勿修改计划，批准 ${code}`,
  ];
  for (const p of approvals) {
    assert.equal(existsSync(approvalsDir(s)), false, "前提：每轮前无记录（幂等检查）");
    const r = hookRun(p, s);
    assert.equal(r.code, 0);
    assert.ok(r.out.includes("Human approval recorded for plan"), `${JSON.stringify(p)} 应算批准`);
    rmSync(approvalsDir(s), { recursive: true, force: true }); // 清记录，下轮重新验证
  }
});

test("钩子：批准记录写入失败——emit 原因诊断且不落回静默（V021-ADJ-63）", () => {
  const s = scratch();
  registerGoal(s);
  lzy(["loop", "plan", "plan.md"], s);
  const code = sha(PLAN1).slice(0, 8);
  // 态 A：approvals 路径被普通文件占位（mkdirSync 失败）
  mkdirSync(join(s.d, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(approvalsDir(s), "blocker");
  const a = hookRun(`批准 ${code}`, s);
  assert.equal(a.code, 0);
  assert.ok(a.out.includes("could not be written"), "诊断接管本回合，不得零反馈");
  assert.ok(a.out.includes("approvals"), "诊断点名可写性检查面");
  assert.ok(!a.out.includes("Human approval recorded for plan"), "未记录不得报成功");
  assert.ok(!/at .*trigger\.js/.test(a.out), "无异常栈外溢");
  assert.equal(readFileSync(approvalsDir(s), "utf8"), "blocker", "占位文件不被破坏");
  rmSync(approvalsDir(s), { force: true }); // 移除占位文件（本文件既无全局 cleanup 助手，就地清）
});

test(
  "钩子：批准记录写入失败（EACCES 只读目录）——同款诊断（V021-ADJ-63）",
  { skip: process.platform === "win32" || (process.getuid?.() ?? -1) === 0 },
  () => {
    const s = scratch();
    mkdirSync(approvalsDir(s), { recursive: true });
    registerGoal(s);
    lzy(["loop", "plan", "plan.md"], s);
    chmodSync(approvalsDir(s), 0o500); // r-x：mkdir 递归已存在=no-op，writeFileSync EACCES
    try {
      const r = hookRun(`批准 ${sha(PLAN1).slice(0, 8)}`, s);
      assert.equal(r.code, 0);
      assert.ok(r.out.includes("could not be written"));
      assert.ok(r.out.includes("EACCES"), "原因摘要带 errno");
      assert.ok(!r.out.includes("Human approval recorded for plan"));
      assert.ok(!/at .*trigger\.js/.test(r.out), "无异常栈外溢");
      assert.equal(readdirSync(approvalsDir(s)).filter((f) => f.endsWith(".json")).length, 0);
    } finally {
      chmodSync(approvalsDir(s), 0o700); // 恢复权限，否则清理失败
    }
  },
);

test("钩子：无 goal / 无 pending——诊断报文接管，批准面不写盘", () => {
  const s = scratch();
  const code = sha(PLAN1).slice(0, 8);
  // 判据=成功标记缺席（trigger.js:82）。不写「不含 recorded」——诊断文案自身含
  // "nothing was recorded"，该断言不可满足（评审订正）。
  const r1 = hookRun(`批准 ${code}`, s); // 无 goal
  assert.equal(r1.code, 0);
  assert.ok(!r1.out.includes("Human approval recorded for plan"));
  assert.ok(r1.out.includes("no goal loop is registered"));
  registerGoal(s);
  const r2 = hookRun(`批准 ${code}`, s); // 有 goal 无 pending
  assert.equal(r2.code, 0);
  assert.ok(!r2.out.includes("Human approval recorded for plan"));
  assert.ok(r2.out.includes("no pending plan adoption to approve"));
  assert.ok(r2.out.includes("t1")); // 报文点名 slug
  assert.ok(!existsSync(approvalsDir(s)));
});

test("钩子：cwd 漂移（宿主根在祖先）——报文点名宿主根绝对路径", () => {
  const s = scratch();
  registerGoal(s);
  const sub = join(s.d, "deep", "deeper");
  mkdirSync(sub, { recursive: true });
  const r = hookRunAt(`批准 ${sha(PLAN1).slice(0, 8)}`, sub, s);
  assert.equal(r.code, 0);
  assert.ok(!r.out.includes("Human approval recorded for plan"));
  // 报文比对走解码后的 additionalContext，不对原始 stdout 断言路径：raw stdout 是 JSON
  // 信封，win32 路径的反斜杠在其中被转义成 `\\`（darwin 无此面，故本地恒绿）——直接
  // `r.out.includes(<path>)` 是 win32 测试雷（CI windows 腿首跑即红，2026-09-21）。
  const o = JSON.parse(r.out);
  assert.ok(o.additionalContext.includes("A goal loop was found at"));
  assert.ok(o.additionalContext.includes(s.d)); // 宿主根绝对路径被点名（债 E 的修复本相）
  assert.ok(!existsSync(approvalsDir(s)));
});

test("钩子：无任何祖先目标——B 支文案（or any parent directory）", () => {
  const s = scratch();
  const sub = join(s.d, "iso");
  mkdirSync(sub, { recursive: true });
  const r = hookRunAt(`批准 ${sha(PLAN1).slice(0, 8)}`, sub, s);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes("or any parent directory"));
  assert.ok(!r.out.includes("A goal loop was found at"));
  assert.ok(!existsSync(approvalsDir(s)));
});

test("钩子：日期串误命中（批准 20260920）——C 支含 slug 与「非本意请忽略」子句", () => {
  const s = scratch();
  registerGoal(s);
  const r = hookRun("批准 20260920", s); // [0-9a-f]{8} 命中纯数字日期串
  assert.equal(r.code, 0);
  assert.ok(!r.out.includes("Human approval recorded for plan"));
  assert.ok(r.out.includes("no pending plan adoption to approve"));
  assert.ok(r.out.includes("t1"));
  assert.ok(r.out.includes("If you did not intend to approve a plan adoption, ignore this notice."));
  assert.ok(!existsSync(approvalsDir(s)));
});

test("钩子：诊断报文双跑字节一致（确定性不变量）", () => {
  const s = scratch();
  registerGoal(s);
  const sub = join(s.d, "deep");
  mkdirSync(sub, { recursive: true });
  const a1 = hookRunAt(`批准 ${sha(PLAN1).slice(0, 8)}`, sub, s).out;
  const a2 = hookRunAt(`批准 ${sha(PLAN1).slice(0, 8)}`, sub, s).out;
  assert.ok(a1.includes("A goal loop was found at"));
  assert.equal(a1, a2);
  const c1 = hookRun(`批准 ${sha(PLAN1).slice(0, 8)}`, s).out;
  const c2 = hookRun(`批准 ${sha(PLAN1).slice(0, 8)}`, s).out;
  assert.ok(c1.includes("no pending plan adoption to approve"));
  assert.equal(c1, c2);
});

test("钩子：LZY_ABLATE_HOOK_HUMAN_GATE=1 下诊断分支同样短路", () => {
  const s = scratch();
  registerGoal(s);
  const sub = join(s.d, "deep");
  mkdirSync(sub, { recursive: true });
  const r = hookRunAt(`批准 ${sha(PLAN1).slice(0, 8)}`, sub, s, {
    LZY_ABLATE_HOOK_HUMAN_GATE: "1",
  });
  assert.equal(r.code, 0);
  assert.ok(!r.out.includes("no goal loop is registered"));
  assert.equal(r.out.trim(), "{}"); // 批准面全灭→非触发词→failOpen
});

test("钩子：优先序代价钉——触发词+批准形态同现时 C 支接管，本回合零认领零 ZW 注入", () => {
  const s = scratch();
  registerGoal(s);
  // 采纳（消融人权门过）→ start 进 executing；此时无 pending，落 C 支。
  lzy(["loop", "plan", "plan.md"], s, { LZY_ABLATE_HUMAN_GATE: "1" });
  lzy(["loop", "start"], s);
  assert.equal(readGoalJson(s).status, "executing");
  const r = hookRun("zw 批准 deadbeef", s);
  assert.equal(r.code, 0);
  // C 支文案在场
  assert.ok(r.out.includes("no pending plan adoption to approve"));
  // 代价：触发词管线未进入——ZW 引导未注入、认领未写（N2③ 记账的取舍，此处钉死）
  assert.ok(!r.out.includes("Trigger word detected"));
  assert.ok(!existsSync(join(sessionsDir(s), "sess_hg.json")));
});

test("钩子：全符——记录落盘字段齐（slug/planHash/sessionId）+确认报文含短码", () => {
  const s = scratch();
  registerGoal(s);
  lzy(["loop", "plan", "plan.md"], s);
  const r = hookRun(`批准 ${sha(PLAN1).slice(0, 8)}`, s);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes("recorded"));
  assert.ok(r.out.includes(sha(PLAN1).slice(0, 8)));
  const files = readdirSync(approvalsDir(s)).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 1);
  const rec = JSON.parse(readFileSync(join(approvalsDir(s), files[0]), "utf8"));
  assert.equal(rec.slug, "t1");
  assert.equal(rec.planHash, sha(PLAN1));
  assert.equal(rec.sessionId, "sess_hg");
  assert.equal(rec.version, 1);
});

test("钩子：批准后改计划——短码作废报文，零记录", () => {
  const s = scratch();
  registerGoal(s);
  lzy(["loop", "plan", "plan.md"], s);
  writeFileSync(join(s.d, "plan.md"), PLAN2); // pending.planPath 指向的文件内容已变
  const r = hookRun(`批准 ${sha(PLAN1).slice(0, 8)}`, s);
  assert.ok(r.out.includes("void"));
  assert.ok(!existsSync(approvalsDir(s)));
});

test("钩子：双跑字节一致（确定性不变量）", () => {
  const s = scratch();
  registerGoal(s);
  lzy(["loop", "plan", "plan.md"], s);
  const a = hookRun("批准 deadbeef", s).out;
  const b = hookRun("批准 deadbeef", s).out;
  assert.equal(a, b);
});

test("钩子：LZY_ABLATE_HOOK_HUMAN_GATE=1 批准分支短路；zw 注入面不受扰", () => {
  const s = scratch();
  registerGoal(s);
  lzy(["loop", "plan", "plan.md"], s);
  const r = hookRun(`批准 ${sha(PLAN1).slice(0, 8)}`, s, { LZY_ABLATE_HOOK_HUMAN_GATE: "1" });
  assert.equal(r.out.trim(), "{}"); // 短路=落回触发词逻辑
  assert.ok(!existsSync(approvalsDir(s)));
  const zw = hookRun("zw 继续", s);
  assert.ok(zw.out.includes("Trigger word detected")); // 触发词注入不受人权门分支扰动
});

test("reset 存活与 doctor 无疤痕误警：approvals/ 记录跨 reset 常驻", () => {
  const s = scratch();
  registerGoal(s);
  lzy(["loop", "plan", "plan.md"], s);
  hookRun(`批准 ${sha(PLAN1).slice(0, 8)}`, s);
  assert.equal(lzy(["loop", "reset"], s).code, 0);
  assert.equal(readdirSync(approvalsDir(s)).filter((f) => f.endsWith(".json")).length, 1);
  const doc = lzy(["doctor"], s);
  // 隔离 HOME 下 install/files 检查本就 fail 级（无注册表/无缓存，既有行为）——本文件
  // 只钉疤痕巡逻判据：approvals 在豁免集 → 不产生疤痕行（疤痕字样缺席）。
  assert.ok(!doc.out.includes("疤痕"));
});
