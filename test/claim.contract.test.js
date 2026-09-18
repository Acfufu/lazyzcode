// 认领制契约测试（ADR-0004）：UPS 触发词认领 / Stop 认领闸门 / 进度振数 / 兼容与卫生。
// fixture 模式与 hooks.contract.test.js 一致：合成 stdin 驱动真实钩子脚本，
// 全部经 process.execPath 拉起，不触碰真实 $HOME 与仓库 .lazyzcode/。
import { test } from "node:test";
// 人权门非本文件被测面（门由 human-gate.contract.test.js 两面钉）——spawn 继承此 env 保采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const HOOKS = join(ROOT, "plugin", "hooks");

function scratch() {
  return mkdtempSync(join(tmpdir(), "lzy-claim-"));
}

function goalAt(dir, status = "executing", steps = [{ id: "N1", kind: "N", status: "pending" }]) {
  mkdirSync(join(dir, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(
    join(dir, ".lazyzcode", "loop", "goal.json"),
    JSON.stringify({ version: 1, slug: "t", title: "t", status, steps }),
  );
}

function sessFile(dir, sid) {
  return join(dir, ".lazyzcode", "loop", "sessions", `${sid}.json`);
}

function claimAt(dir, sid, extra = {}) {
  mkdirSync(join(dir, ".lazyzcode", "loop", "sessions"), { recursive: true });
  writeFileSync(
    sessFile(dir, sid),
    // claimedAt 默认取当下（认领 TTL 48h 起效后，固定历史时间戳会被当死亡认领过滤）
    JSON.stringify({ continues: 0, claimedAt: new Date().toISOString(), ...extra }),
  );
}

// HOME 隔离（plan-v2-phase2）：stop 钩子读计费账本（水位警戒线），不隔离会打真账本。
const ISOLATED_HOME = mkdtempSync(join(tmpdir(), "lzy-claim-home-"));

function hook(name, input, cwd) {
  const r = spawnSync(process.execPath, [join(HOOKS, name)], {
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, HOME: ISOLATED_HOME, USERPROFILE: ISOLATED_HOME },
    ...(cwd ? { cwd } : {}),
  });
  return { code: r.status, out: (r.stdout ?? "").trim() };
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

// ── 认领写入（trigger.js） ─────────────────────────────────────────────────

test("trigger：三触发形态命中且 executing → 写 claimedAt 且注入不受损", () => {
  for (const prompt of ["zw 继续", "用 lazyzcode:zw 跑", "ulw push on"]) {
    const d = scratch();
    try {
      goalAt(d);
      const o = JSON.parse(hook("trigger.js", { prompt, cwd: d, session_id: `s-${prompt.length}` }).out);
      assert.match(o.additionalContext, /Trigger word detected/);
      const st = JSON.parse(readFileSync(sessFile(d, `s-${prompt.length}`), "utf8"));
      assert.equal(typeof st.claimedAt === "string" && st.claimedAt.length > 0, true);
    } finally {
      cleanup(d);
    }
  }
});

test("trigger：无 goal / planning 态 / 缺 sessionId → 注入照常、零认领残留", () => {
  const withGoal = scratch();
  const empty = scratch();
  try {
    goalAt(withGoal, "planning");
    for (const [dir, sid] of [
      [empty, "sE"],
      [withGoal, "sP"],
      [withGoal, undefined],
    ]) {
      const o = JSON.parse(hook("trigger.js", { prompt: "zw fix", cwd: dir, session_id: sid }).out);
      assert.match(o.additionalContext, /Trigger word detected/); // 注入无条件执行
    }
    let leftovers = 0;
    try {
      leftovers = readFileSync(sessFile(empty, "sE"), "utf8").length + readFileSync(sessFile(withGoal, "sP"), "utf8").length;
    } catch {
      leftovers = 0; // 文件不存在 = 预期
    }
    assert.equal(leftovers, 0);
  } finally {
    cleanup(withGoal, empty);
  }
});

test("trigger：非触发词（句中 zw）→ {} 静默且不写认领", () => {
  const d = scratch();
  try {
    goalAt(d);
    assert.equal(hook("trigger.js", { prompt: "what is zw anyway", cwd: d, session_id: "sM" }).out, "{}");
    assert.throws(() => readFileSync(sessFile(d, "sM"), "utf8"), { code: "ENOENT" });
  } finally {
    cleanup(d);
  }
});

test("trigger 分级（ADR-0004 修正案）：句中别名只注入不认领，句首 ultrawork 照写认领", () => {
  const d = scratch();
  try {
    goalAt(d);
    // specimen：正文「对比 /ulw 的写法」曾被全谱匹配误认领、Stop 拉回致盲真主会话——
    // 修正后注入照常（通知全谱不变），claimedAt 不写。
    const o = JSON.parse(hook("trigger.js", { prompt: "对比 /ulw 的写法", cwd: d, session_id: "sMid" }).out);
    assert.match(o.additionalContext, /Trigger word detected/);
    assert.throws(() => readFileSync(sessFile(d, "sMid"), "utf8"), { code: "ENOENT" });
    const o2 = JSON.parse(hook("trigger.js", { prompt: "ultrawork fix the bug", cwd: d, session_id: "sInit" }).out);
    assert.match(o2.additionalContext, /Trigger word detected/);
    const st = JSON.parse(readFileSync(sessFile(d, "sInit"), "utf8"));
    assert.equal(typeof st.claimedAt === "string" && st.claimedAt.length > 0, true);
  } finally {
    cleanup(d);
  }
});

// ── 认领闸门（stop.js） ────────────────────────────────────────────────────

test("stop：资格制空集（无 sessions 目录=无人可拉，旁路结构性免拉）", () => {
  const d = scratch();
  try {
    goalAt(d);
    // ADR-0004 修正案四（0.1.1）：空集回退废止——v0.1.0 前此处旁路会被拉（continue:true）
    assert.equal(hook("stop.js", { sessionId: "sX", cwd: d }).out, "{}");
  } finally {
    cleanup(d);
  }
});

test("stop：认领集非空——旁路会话放手、认领会话被拉、多认领并存皆可拉", () => {
  const d = scratch();
  try {
    goalAt(d);
    claimAt(d, "sA");
    claimAt(d, "sC");
    assert.equal(hook("stop.js", { sessionId: "sB", cwd: d }).out, "{}"); // 旁路静默
    assert.equal(JSON.parse(hook("stop.js", { sessionId: "sA", cwd: d }).out).continue, true);
    assert.equal(JSON.parse(hook("stop.js", { sessionId: "sC", cwd: d }).out).continue, true);
  } finally {
    cleanup(d);
  }
});

test("stop：仅振数文件（无 claimedAt）不算认领 → 空集=无人可拉", () => {
  const d = scratch();
  try {
    goalAt(d);
    mkdirSync(join(d, ".lazyzcode", "loop", "sessions"), { recursive: true });
    writeFileSync(sessFile(d, "sM"), JSON.stringify({ continues: 1, stallCount: 1, lastDoneCount: 0 }));
    // 资格制（修正案四）：振数文件不构成认领 → 认领集为空 → 旁路（含会话本体）一律放手
    assert.equal(hook("stop.js", { sessionId: "sOther", cwd: d }).out, "{}");
    assert.equal(hook("stop.js", { sessionId: "sM", cwd: d }).out, "{}");
  } finally {
    cleanup(d);
  }
});

// ── 进度振数（stop.js） ────────────────────────────────────────────────────

test("stop：首拉只记快照不计振；有推进 stall/stuck 自愈", () => {
  const d = scratch();
  try {
    goalAt(d, "executing", [
      { id: "N1", kind: "N", status: "pending" },
      { id: "N2", kind: "N", status: "pending" },
    ]);
    const inp = { sessionId: "s", cwd: d };
    claimAt(d, "s"); // 资格制（修正案四）：被拉会话先持认领
    JSON.parse(hook("stop.js", inp).out); // 首拉
    let st = JSON.parse(readFileSync(sessFile(d, "s"), "utf8"));
    assert.equal(st.lastDoneCount, 0);
    assert.equal(st.stallCount, 0);
    claimAt(d, "s"); // 模拟既有认领 + stuck 残留
    writeFileSync(sessFile(d, "s"), JSON.stringify({ continues: 1, claimedAt: "x", stallCount: 2, stuck: true, lastDoneCount: 0 }));
    goalAt(d, "executing", [
      { id: "N1", kind: "N", status: "done" },
      { id: "N2", kind: "N", status: "pending" },
    ]); // 推进：doneCount 0→1（仍留 pending 步骤，保持拉回主路径）
    JSON.parse(hook("stop.js", inp).out);
    st = JSON.parse(readFileSync(sessFile(d, "s"), "utf8"));
    assert.equal(st.stallCount, 0);
    assert.equal(st.stuck, false);
    assert.equal(st.lastDoneCount, 1);
    assert.equal(st.claimedAt, "x"); // 合并写不丢认领
  } finally {
    cleanup(d);
  }
});

// ── 兼容与卫生（hook-lib 直测 + 钩子串联） ─────────────────────────────────

test("hook-lib：损坏 JSON 计 0、listClaims 排除 .lock/.tmp 且目录缺失→空集", async () => {
  const lib = await import(pathToFileURL(join(HOOKS, "hook-lib.js")).href);
  const d = scratch();
  try {
    assert.deepEqual(lib.listClaims(d), []); // 目录不存在
    mkdirSync(join(d, ".lazyzcode", "loop", "sessions"), { recursive: true });
    writeFileSync(join(d, ".lazyzcode", "loop", "sessions", "broken.json"), "{oops");
    writeFileSync(join(d, ".lazyzcode", "loop", "sessions", "x.123.tmp"), "{}");
    mkdirSync(join(d, ".lazyzcode", "loop", "sessions", ".lock-x"));
    writeFileSync(sessFile(d, "ok"), JSON.stringify({ continues: -7, claimedAt: "z" }));
    assert.deepEqual(lib.listClaims(d), ["ok"]); // 损坏/非 .json 一律排除
    assert.equal(lib.readSessionCounter(d, "broken-x"), 0); // 损坏 → 0
    const st = lib.readSessionState(d, "broken-x");
    assert.equal(st.continues, 0);
    assert.equal(st.claimedAt, null);
    assert.equal(st.stuck, false);
  } finally {
    cleanup(d);
  }
});

test("兼容：旧格式 {continues} 文件经认领与预算写后字段双向保留", () => {
  const d = scratch();
  try {
    goalAt(d);
    mkdirSync(join(d, ".lazyzcode", "loop", "sessions"), { recursive: true });
    writeFileSync(sessFile(d, "s"), JSON.stringify({ continues: 1 })); // 认领制之前的旧文件
    hook("trigger.js", { prompt: "zw 继续", cwd: d, session_id: "s" });
    let st = JSON.parse(readFileSync(sessFile(d, "s"), "utf8"));
    assert.equal(typeof st.claimedAt === "string", true); // 认领写入
    assert.equal(st.continues, 1); // 旧计数不丢
    const o = JSON.parse(hook("stop.js", { sessionId: "s", cwd: d }).out);
    assert.equal(o.continue, true);
    assert.match(o.additionalContext, /2\/2/); // 旧计数被接续（1→2），非从 0 重来
    st = JSON.parse(readFileSync(sessFile(d, "s"), "utf8"));
    assert.equal(typeof st.claimedAt === "string", true); // 预算写后认领仍在
  } finally {
    cleanup(d);
  }
});

test("认领 TTL（plan-v2 Phase 2-5）：claimedAt 超 48h 不算认领——纯过期=无人可拉、混集旁路放手、scanSessionFlags 记过期", async () => {
  const { scanSessionFlags } = await import("../core/loop.js");
  const d = scratch();
  try {
    goalAt(d);
    const stale = new Date(Date.now() - 49 * 3_600_000).toISOString();
    // 纯过期：资格制（修正案四）下空集=无人可拉，过期会话自身也放手（死亡认领不续命）
    claimAt(d, "sOld", { claimedAt: stale });
    const o1 = hook("stop.js", { sessionId: "sOld", cwd: d }).out;
    assert.equal(o1, "{}");
    // 混集：新鲜认领在场——过期会话成旁路放手，新鲜会话照拉
    claimAt(d, "sNew", { claimedAt: new Date().toISOString() });
    const o2 = hook("stop.js", { sessionId: "sOld", cwd: d }).out;
    assert.equal(o2, "{}");
    const o3 = JSON.parse(hook("stop.js", { sessionId: "sNew", cwd: d }).out);
    assert.equal(o3.continue, true);
    // core 侧读面：expired 记名、claims 不计过期
    const flags = scanSessionFlags(d);
    assert.deepEqual(flags.claims, ["sNew"]);
    assert.deepEqual(flags.expired, ["sOld"]);
  } finally {
    cleanup(d);
  }
});

const WAKE_PROMPT = "zw 继续（无人值守：只推进 executing 目标；无目标或 planning 态则干净退出并说明；不做完不停）";

test("哨兵旗标（plan-v2 Phase 2-6）：无人值守写 unattended（无目标也写）、executing 照写认领、普通 prompt 不写", () => {
  const d1 = scratch();
  const d2 = scratch();
  const d3 = scratch();
  try {
    const o1 = JSON.parse(hook("trigger.js", { sessionId: "w1", cwd: d1, prompt: WAKE_PROMPT }).out);
    assert.ok(o1.additionalContext, "注入照常");
    const s1 = JSON.parse(readFileSync(sessFile(d1, "w1"), "utf8"));
    assert.equal(s1.unattended, true);
    assert.ok(s1.wakeAt);
    assert.equal(s1.claimedAt, undefined, "无 goal 不写认领");

    goalAt(d2);
    hook("trigger.js", { sessionId: "w2", cwd: d2, prompt: WAKE_PROMPT });
    const s2 = JSON.parse(readFileSync(sessFile(d2, "w2"), "utf8"));
    assert.equal(s2.unattended, true);
    assert.ok(s2.claimedAt, "executing 时旗标与认领双落");

    goalAt(d3);
    hook("trigger.js", { sessionId: "w3", cwd: d3, prompt: "zw 修一下登录 bug" });
    const s3 = JSON.parse(readFileSync(sessFile(d3, "w3"), "utf8"));
    assert.equal(s3.unattended, undefined, "交互触发词不落哨兵");
  } finally {
    cleanup(d1, d2, d3);
  }
});

// ── standdown（ADR-0009 修订节，0.1.1 goal2） ──────────────────────────────

test("standdown：句首「zw standdown」+goal 在场 → 写旗标+确认注入；重复声明幂等且双跑 stdout 逐字节一致", () => {
  const d = scratch();
  try {
    goalAt(d);
    const inp = { prompt: "zw standdown", cwd: d, session_id: "sd1" };
    const o1 = hook("trigger.js", inp);
    assert.match(o1.out, /standdown recorded/);
    assert.doesNotMatch(o1.out, /Trigger word detected/); // 整支接管，不落回 bootstrap
    let st = JSON.parse(readFileSync(sessFile(d, "sd1"), "utf8"));
    assert.equal(st.standdown, true);
    const o2 = hook("trigger.js", inp); // 重复声明：幂等同文（字节确定性契约，emit 零时间戳）
    assert.equal(o2.out, o1.out);
    st = JSON.parse(readFileSync(sessFile(d, "sd1"), "utf8"));
    assert.equal(st.standdown, true);
  } finally {
    cleanup(d);
  }
});

test("standdown：无 goal → 静态提示零写盘（不建 .lazyzcode）", () => {
  const d = scratch();
  try {
    const o = hook("trigger.js", { prompt: "zw standdown", cwd: d, session_id: "sd2" });
    assert.match(o.out, /nothing to opt out of/);
    assert.throws(() => readFileSync(join(d, ".lazyzcode", "loop", "sessions", "sd2.json"), "utf8"), {
      code: "ENOENT",
    });
  } finally {
    cleanup(d);
  }
});

test("standdown：旗标压过认领——Stop 只读放行、不耗预算、不清计数", () => {
  const d = scratch();
  try {
    goalAt(d);
    hook("trigger.js", { prompt: "zw standdown", cwd: d, session_id: "sd3" });
    assert.equal(hook("stop.js", { sessionId: "sd3", cwd: d }).out, "{}"); // 放手
    const st = JSON.parse(readFileSync(sessFile(d, "sd3"), "utf8"));
    assert.equal(st.continues, 0); // 预算零耗
    assert.equal(st.standdown, true); // 只读放行不写盘
  } finally {
    cleanup(d);
  }
});

test("standdown：参与即恢复——认领写清旗标，Stop 恢复拉回", () => {
  const d = scratch();
  try {
    goalAt(d);
    hook("trigger.js", { prompt: "zw standdown", cwd: d, session_id: "sd4" });
    assert.equal(hook("stop.js", { sessionId: "sd4", cwd: d }).out, "{}");
    hook("trigger.js", { prompt: "zw 继续", cwd: d, session_id: "sd4" }); // 参与触发
    const st = JSON.parse(readFileSync(sessFile(d, "sd4"), "utf8"));
    assert.equal(st.standdown, null); // 旗标清零（显式 null，非键删除）
    assert.equal(typeof st.claimedAt === "string" && st.claimedAt.length > 0, true);
    assert.equal(JSON.parse(hook("stop.js", { sessionId: "sd4", cwd: d }).out).continue, true);
  } finally {
    cleanup(d);
  }
});

test("standdown：TRIGGER 消融=1 → 零输出零写（归触发轴，无独立开关）", () => {
  const d = scratch();
  try {
    goalAt(d);
    const r = spawnSync(process.execPath, [join(HOOKS, "trigger.js")], {
      input: JSON.stringify({ prompt: "zw standdown", cwd: d, session_id: "sd5" }),
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, HOME: ISOLATED_HOME, USERPROFILE: ISOLATED_HOME, LZY_ABLATE_HOOK_TRIGGER: "1" },
    });
    assert.equal((r.stdout ?? "").trim(), "{}");
    assert.throws(() => readFileSync(sessFile(d, "sd5"), "utf8"), { code: "ENOENT" });
  } finally {
    cleanup(d);
  }
});

test("standdown：负形态——standdownish 走常规触发、句中提及静默，均零旗标", () => {
  const d = scratch();
  try {
    goalAt(d);
    const o1 = JSON.parse(hook("trigger.js", { prompt: "zw standdownish", cwd: d, session_id: "n1" }).out);
    assert.match(o1.additionalContext, /Trigger word detected/); // 词边界外=常规 zw 流程
    assert.notEqual(JSON.parse(readFileSync(sessFile(d, "n1"), "utf8")).standdown, true);
    assert.equal(hook("trigger.js", { prompt: "请 zw standdown 一下", cwd: d, session_id: "n2" }).out, "{}");
    assert.throws(() => readFileSync(sessFile(d, "n2"), "utf8"), { code: "ENOENT" });
  } finally {
    cleanup(d);
  }
});

test("standdown：旧格式会话文件（无 standdown 键）读为 null（零迁移）", async () => {
  const lib = await import(pathToFileURL(join(HOOKS, "hook-lib.js")).href);
  const d = scratch();
  try {
    goalAt(d);
    mkdirSync(join(d, ".lazyzcode", "loop", "sessions"), { recursive: true });
    writeFileSync(sessFile(d, "old"), JSON.stringify({ continues: 1 }));
    const st = lib.readSessionState(d, "old");
    assert.equal(st.standdown, null); // 缺键=null，不误判退出
    assert.equal(st.continues, 1); // 既有字段不受扰
    writeFileSync(sessFile(d, "bad"), JSON.stringify({ standdown: "yes" })); // 他值不认
    assert.equal(lib.readSessionState(d, "bad").standdown, null);
  } finally {
    cleanup(d);
  }
});
