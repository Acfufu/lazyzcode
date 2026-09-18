// ablation-switch 契约测试（ADR-0015，goal true-ablation-full-flow#N2/N3）：全部 10 个
// kill-switch（机器层 5 + 钩子层 5）每开关两半——开（恰 "1"）=闸门确被绕过/钩子确被静默
// （fixture CLI stdout 为证）、关=与改动前 fixture 结果一致（同一 fixture 上拒辞/注入逐字段
// 同，先关后开串行复用一仓）。取值语义钉：缺席/空串/"0"/"true" 皆关——开关判定严格 === "1"，
// 防半开半关的脏配置静默混入消融样本。
// 红半约定（N1 钉死）：开关态无法先于改动存在，红半=开关开的 fixture 表面捕获。
import { test } from "node:test";
// 人权门非本文件被测面（门由 human-gate.contract.test.js 两面钉）——spawn 继承此 env 保采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-abl-home-")); // HOME 隔离+引擎抑制（债③家法）

function repo(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  return d;
}

function lzy(args, cwd, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE, ...env },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function commitAll(cwd, msg) {
  spawnSync("git", ["add", "-A"], { cwd });
  spawnSync("git", ["commit", "-qm", msg], { cwd });
}

// 造一个已取证的 executing goal（N1/F1 done，F1 证据新鲜，树净）。plan 落 .lazyzcode/
// （账本目录不计脏，integrity 闸门口径）；heavy=true 时带 PASS 评审过 HEAVY 采纳门。
function cycle(d, { heavy = false } = {}) {
  assert.equal(
    lzy(["loop", "register", "t", "--title", "t", ...(heavy ? ["--tier", "heavy"] : [])], d).code,
    0,
  );
  writeFileSync(join(d, ".lazyzcode", "plan.md"), "- [N1] x\n- [F1] v\n");
  const adopt = lzy(
    ["loop", "plan", ".lazyzcode/plan.md", ...(heavy ? ["--review", "plan-reviewer: PASS — t"] : [])],
    d,
  );
  assert.equal(adopt.code, 0, adopt.out);
  assert.equal(lzy(["loop", "start"], d).code, 0);
  assert.equal(lzy(["step", "done", "N1", "--note", "x"], d).code, 0);
  assert.equal(lzy(["step", "done", "F1", "--evidence", "绿半"], d).code, 0);
}

test("PLAN_GATE：关=禁词计划拒（逐字段同）；开=TBD 计划可采纳", () => {
  const d = repo("lzy-abl-plan-");
  try {
    assert.equal(lzy(["loop", "register", "t", "--title", "t"], d).code, 0);
    writeFileSync(join(d, ".lazyzcode", "plan.md"), "# 计划\n- [N1] 方案取舍 TBD\n- [F1] 终验\n");
    const off = lzy(["loop", "plan", ".lazyzcode/plan.md"], d);
    assert.equal(off.code, 1);
    assert.match(off.out, /计划未决策完备/);
    assert.match(off.out, /L2/); // 行号精确指向含 TBD 的行
    const on = lzy(["loop", "plan", ".lazyzcode/plan.md"], d, { LZY_ABLATE_PLAN_GATE: "1" });
    assert.equal(on.code, 0, on.out);
    assert.match(on.out, /计划门通过：2 项已采纳（N:1 F:1）/); // 消融面=只跳禁词扫描，清单解析照常
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("TIER_GATE：关=HEAVY 无 PASS 评审拒采纳；开=无评审可采纳", () => {
  const d = repo("lzy-abl-tier-");
  try {
    assert.equal(lzy(["loop", "register", "t", "--title", "t", "--tier", "heavy"], d).code, 0);
    writeFileSync(join(d, ".lazyzcode", "plan.md"), "- [N1] x\n- [F1] v\n");
    const off = lzy(["loop", "plan", ".lazyzcode/plan.md"], d); // 不带 --review
    assert.equal(off.code, 1);
    assert.match(off.out, /HEAVY 目标机器拒：无 PASS 评审不得采纳/);
    const on = lzy(["loop", "plan", ".lazyzcode/plan.md"], d, { LZY_ABLATE_TIER_GATE: "1" });
    assert.equal(on.code, 0, on.out);
    assert.match(on.out, /计划门通过/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("VERIFY：关=过期证据拒 finish；开=放行（范围=doFinishLoop 两处拒绝）", () => {
  const d = repo("lzy-abl-ver-");
  try {
    cycle(d);
    writeFileSync(join(d, "b.txt"), "b\n"); // 取证后代码再提交 → F1 证据过期
    commitAll(d, "change after evidence");
    const off = lzy(["loop", "finish"], d);
    assert.equal(off.code, 1);
    assert.match(off.out, /证据已过期/);
    assert.match(off.out, /F1/);
    const on = lzy(["loop", "finish"], d, { LZY_ABLATE_VERIFY: "1" });
    assert.equal(on.code, 0, on.out);
    assert.match(on.out, /✔✔ 目标完成：t/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("INTEGRITY：关=脏树拒 finish；开=脏树放行", () => {
  const d = repo("lzy-abl-int-");
  try {
    cycle(d);
    writeFileSync(join(d, "junk.txt"), "j\n"); // 未提交杂物 → host 根 dirty（HEAD 未动，证据仍新鲜）
    const off = lzy(["loop", "finish"], d);
    assert.equal(off.code, 1);
    assert.match(off.out, /finish 完整性闸门拒绝（dirty）/);
    assert.match(off.out, /junk\.txt/);
    const on = lzy(["loop", "finish"], d, { LZY_ABLATE_INTEGRITY: "1" });
    assert.equal(on.code, 0, on.out);
    assert.match(on.out, /✔✔ 目标完成：t/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("ATTEST：关=HEAVY finish 无对照记录拒；开=免门放行（终验证明记 null 不伪造）", () => {
  const d = repo("lzy-abl-att-");
  try {
    cycle(d, { heavy: true }); // 全部步骤 done、证据新鲜、树净，唯无 comparator attestation
    const off = lzy(["loop", "finish"], d);
    assert.equal(off.code, 1);
    assert.match(off.out, /HEAVY finish 需对照 attestation 且 MATCH/);
    const on = lzy(["loop", "finish"], d, { LZY_ABLATE_ATTEST: "1" });
    assert.equal(on.code, 0, on.out);
    assert.match(on.out, /✔✔ 目标完成：t/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("取值语义钉：恰 \"1\" 消融，缺席/空串/\"0\"/\"true\" 皆关（防脏配置半开半关）", () => {
  const d = repo("lzy-abl-sem-");
  try {
    assert.equal(lzy(["loop", "register", "t", "--title", "t"], d).code, 0);
    writeFileSync(join(d, ".lazyzcode", "plan.md"), "# 计划\n- [N1] 方案取舍 TBD\n- [F1] 终验\n");
    for (const [label, v] of [["空串", ""], ["0", "0"], ["true", "true"]]) {
      const r = lzy(["loop", "plan", ".lazyzcode/plan.md"], d, { LZY_ABLATE_PLAN_GATE: v });
      assert.equal(r.code, 1, `取值 ${label} 不得消融`);
      assert.match(r.out, /计划未决策完备/);
    }
    const on = lzy(["loop", "plan", ".lazyzcode/plan.md"], d, { LZY_ABLATE_PLAN_GATE: "1" });
    assert.equal(on.code, 0, on.out); // 恰 "1" 才是开
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ── 钩子层（N3）：五脚本 readStdinJson() 后短路，emit {} + exit 0 ───────────────
// 开半的「stdin 吃净」由 spawnSync 带 input 不 EPIPE + exit 0 共同证明（子进程不读 stdin
// 即早退，父端写侧必断）。写面死透（计数/认领/旗标零写）是消融语义的一部分，一并钉。

const HOOKS = join(ROOT, "plugin", "hooks");

function hookRun(name, input, env = {}) {
  const r = spawnSync(process.execPath, [join(HOOKS, name)], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, ...env },
  });
  return { code: r.status, out: (r.stdout ?? "").trim() };
}

function goalAt(dir, status = "executing", steps = [{ id: "N1", kind: "N", status: "pending" }]) {
  mkdirSync(join(dir, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(
    join(dir, ".lazyzcode", "loop", "goal.json"),
    JSON.stringify({ slug: "t", title: "t", status, steps }),
  );
}

function scratch(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  goalAt(d);
  return d;
}

test("HOOK_STOP：关=未完成目标拉回且计数；开={}放手零写面", () => {
  const d = scratch("lzy-abl-hs-");
  try {
    mkdirSync(join(d, ".lazyzcode", "loop", "sessions"), { recursive: true });
    // 资格制（ADR-0004 修正案四）：被拉会话夹具带新鲜认领
    const claimFile = () => JSON.stringify({ continues: 0, claimedAt: new Date().toISOString() });
    writeFileSync(join(d, ".lazyzcode", "loop", "sessions", "s.json"), claimFile());
    const inp = { sessionId: "s", cwd: d };
    const off = JSON.parse(hookRun("stop.js", inp).out);
    assert.equal(off.continue, true); // 拉回在役
    writeFileSync(join(d, ".lazyzcode", "loop", "sessions", "s.json"), claimFile());
    const on = hookRun("stop.js", inp, { LZY_ABLATE_HOOK_STOP: "1" });
    assert.equal(on.code, 0);
    assert.equal(on.out, "{}"); // 拉回全灭
    const counter = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "sessions", "s.json"), "utf8"));
    assert.equal(counter.continues, 0); // 计数零写=预算面也没动
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("HOOK_TRIGGER：关=触发词注入+认领落账；开={}零注入零认领", () => {
  const d = scratch("lzy-abl-ht-");
  try {
    const inp = { prompt: "zw fix the login bug", sessionId: "s", cwd: d };
    const off = JSON.parse(hookRun("trigger.js", inp).out);
    assert.match(off.additionalContext, /Trigger word detected/); // 注入在役
    assert.ok(existsSync(join(d, ".lazyzcode", "loop", "sessions", "s.json"))); // 认领落账
    const d2 = scratch("lzy-abl-ht2-");
    try {
      const on = hookRun("trigger.js", { ...inp, cwd: d2 }, { LZY_ABLATE_HOOK_TRIGGER: "1" });
      assert.equal(on.code, 0);
      assert.equal(on.out, "{}"); // 触发词层全灭
      assert.ok(!existsSync(join(d2, ".lazyzcode", "loop", "sessions", "s.json"))); // 认领零写
    } finally {
      rmSync(d2, { recursive: true, force: true });
    }
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("HOOK_SESSION_START：关=开场广播循环态；开={}静默", () => {
  const d = scratch("lzy-abl-hss-");
  try {
    const inp = { cwd: d };
    const off = JSON.parse(hookRun("session-start.js", inp).out);
    assert.match(off.additionalContext, /目标循环/); // 广播在役
    const on = hookRun("session-start.js", inp, { LZY_ABLATE_HOOK_SESSION_START: "1" });
    assert.equal(on.code, 0);
    assert.equal(on.out, "{}"); // 广播全灭
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("HOOK_TRIPWIRE：关=两连败告警；开={}连击计数零写", () => {
  const failIn = (d) => ({
    session_id: "s",
    cwd: d,
    tool_name: "mcp__codegraph__codegraph_explore",
    tool_input: { projectPath: "/x", query: "q" },
    error: "Tool execution timed out after 30000ms",
    is_interrupt: false,
  });
  const d = scratch("lzy-abl-htr-");
  try {
    assert.equal(hookRun("tripwire.js", failIn(d)).out, "{}"); // 首败只计数
    const off = JSON.parse(hookRun("tripwire.js", failIn(d)).out); // 二败达阈值
    assert.match(off.additionalContext, /连续失败 2 次/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  const d2 = scratch("lzy-abl-htr2-");
  try {
    for (const _ of [1, 2]) {
      const on = hookRun("tripwire.js", failIn(d2), { LZY_ABLATE_HOOK_TRIPWIRE: "1" });
      assert.equal(on.code, 0);
      assert.equal(on.out, "{}"); // 绊线全灭
    }
    assert.ok(!existsSync(join(d2, ".lazyzcode", "loop", "sessions", "s.json"))); // 计数零写
  } finally {
    rmSync(d2, { recursive: true, force: true });
  }
});

test("HOOK_COMMENT_CHECKER：关=TODO 注入提示；开={}静默", () => {
  const d = scratch("lzy-abl-hcc-");
  try {
    const inp = { cwd: d, tool_name: "Write", tool_input: { content: "// TODO fix me\n" } };
    const off = JSON.parse(hookRun("comment-checker.js", inp).out);
    assert.match(off.additionalContext, /comment-checker/); // 巡逻在役
    const on = hookRun("comment-checker.js", inp, { LZY_ABLATE_HOOK_COMMENT_CHECKER: "1" });
    assert.equal(on.code, 0);
    assert.equal(on.out, "{}"); // 巡逻全灭
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
