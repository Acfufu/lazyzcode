// 钩子契约测试：合成 stdin 驱动真实钩子脚本，固化评审轮实证过的行为矩阵。
// 全部经 process.execPath 拉起（不依赖 PATH 上的 node）；不触碰真实 $HOME 与仓库 .lazyzcode/。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const HOOKS = join(ROOT, "plugin", "hooks");

function scratch() {
  return mkdtempSync(join(tmpdir(), "lzy-hooks-"));
}

function goalAt(dir, status = "executing", steps = [{ id: "N1", kind: "N", status: "pending" }]) {
  mkdirSync(join(dir, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(
    join(dir, ".lazyzcode", "loop", "goal.json"),
    JSON.stringify({ slug: "t", title: "t", status, steps }),
  );
}

function counterAt(dir, sid, continues) {
  mkdirSync(join(dir, ".lazyzcode", "loop", "sessions"), { recursive: true });
  writeFileSync(
    join(dir, ".lazyzcode", "loop", "sessions", `${sid}.json`),
    JSON.stringify({ continues }),
  );
}

// HOME 隔离（plan-v2-phase2）：stop 钩子会读真实 ~/.zcode 计费账本（水位警戒线）——
// 默认打隔离空 HOME，水位专测再显式传 fixture HOME。
const ISOLATED_HOME = mkdtempSync(join(tmpdir(), "lzy-hooks-home-"));

function hook(name, input, extraEnv = {}) {
  const r = spawnSync(process.execPath, [join(HOOKS, name)], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, HOME: ISOLATED_HOME, USERPROFILE: ISOLATED_HOME, ...extraEnv },
  });
  return { code: r.status, out: (r.stdout ?? "").trim() };
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test("stop：预算 0/1 次续跑并计数；零推进第 3 次 stuck 弃拉且不耗预算（ADR-0004）", () => {
  const d = scratch();
  try {
    goalAt(d);
    counterAt(d, "s", 0);
    const inp = { sessionId: "s", cwd: d };
    const o1 = JSON.parse(hook("stop.js", inp).out);
    assert.equal(o1.continue, true);
    assert.match(o1.additionalContext, /1\/2/);
    const o2 = JSON.parse(hook("stop.js", inp).out);
    assert.equal(o2.continue, true);
    assert.match(o2.additionalContext, /2\/2/);
    // 零推进第 3 次：stuck 判定先于预算消耗——continue:false 显式（评审 R1-1），
    // continues 保持 2（弃拉不耗预算，红线 #2 上限不变）
    const o3 = JSON.parse(hook("stop.js", inp).out);
    assert.equal(o3.continue, false);
    assert.match(o3.additionalContext, /stuck/);
    const counter = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "sessions", "s.json"), "utf8"));
    assert.equal(counter.continues, 2);
    assert.equal(counter.stuck, true);
  } finally {
    cleanup(d);
  }
});

test("stop：有推进时预算耗尽走「已用尽」路径（振数自愈，上限 2 不变）", () => {
  const d = scratch();
  try {
    const inp = { sessionId: "s", cwd: d };
    goalAt(d, "executing", [
      { id: "N1", kind: "N", status: "pending" },
      { id: "N2", kind: "N", status: "pending" },
      { id: "N3", kind: "N", status: "pending" },
    ]);
    counterAt(d, "s", 0);
    assert.equal(JSON.parse(hook("stop.js", inp).out).continue, true); // 首拉快照，c=1
    goalAt(d, "executing", [
      { id: "N1", kind: "N", status: "done" },
      { id: "N2", kind: "N", status: "pending" },
      { id: "N3", kind: "N", status: "pending" },
    ]);
    assert.equal(JSON.parse(hook("stop.js", inp).out).continue, true); // 有推进，c=2
    goalAt(d, "executing", [
      { id: "N1", kind: "N", status: "done" },
      { id: "N2", kind: "N", status: "done" },
      { id: "N3", kind: "N", status: "pending" },
    ]);
    const o3 = JSON.parse(hook("stop.js", inp).out); // 再推进但预算尽 → 已用尽
    assert.equal(o3.continue, false);
    assert.match(o3.additionalContext, /已用尽/);
    const counter = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "sessions", "s.json"), "utf8"));
    assert.equal(counter.continues, 2);
    assert.equal(counter.stuck, false); // 有推进：振数与 stuck 自愈
    assert.equal(counter.stallCount, 0);
  } finally {
    cleanup(d);
  }
});

test("stop：空/坏 stdin、缺 sessionId、无目标目录一律 {} 放手（fail-open）", () => {
  const d = scratch();
  const empty = scratch();
  try {
    goalAt(d); // 有在跑目标：坏输入也不得借道续跑（评审 R1-2 反例回归）
    assert.equal(hook("stop.js", "").out, "{}");
    assert.equal(hook("stop.js", "not json").out, "{}");
    assert.equal(hook("stop.js", { cwd: d }).out, "{}"); // 缺 sessionId=没有账本
    assert.equal(hook("stop.js", { sessionId: "x", cwd: empty }).out, "{}"); // 无目标不劫持
  } finally {
    cleanup(d, empty);
  }
});

test("stop：全收口未 finish——首次提醒占预算，预算尽后 {} 放手（缺口补，评审 E6）", () => {
  const d = scratch();
  try {
    goalAt(d, "executing", [{ id: "N1", kind: "N", status: "done" }]);
    counterAt(d, "s", 0);
    const o1 = JSON.parse(hook("stop.js", { sessionId: "s", cwd: d }).out);
    assert.equal(o1.continue, true);
    assert.match(o1.additionalContext, /loop finish/);
    counterAt(d, "s", 2); // 预算已尽
    const o2 = hook("stop.js", { sessionId: "s", cwd: d }).out;
    assert.equal(o2, "{}"); // 放手，引擎照常结束
  } finally {
    cleanup(d);
  }
});

function handoffMarkerAt(dir, body = JSON.stringify({ snapshot: "/tmp/snap.md" })) {
  writeFileSync(join(dir, ".lazyzcode", "loop", "handoff.json"), body);
}

test("stop：交接放行——消费即放行不耗预算、清振数、一次性（ADR-0009）", () => {
  const d = scratch();
  try {
    goalAt(d); // pending>0 分支
    counterAt(d, "s", 0);
    handoffMarkerAt(d);
    const o1 = JSON.parse(hook("stop.js", { sessionId: "s", cwd: d }).out);
    assert.equal(o1.continue, false); // 放行，不请求续跑
    assert.match(o1.additionalContext, /交接标记已消费/);
    assert.equal(existsSync(join(d, ".lazyzcode", "loop", "handoff.json")), false); // 已消费
    const st = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "sessions", "s.json"), "utf8"));
    assert.equal(st.continues, 0); // 不耗预算：保持 0（只增不发生在放行路径）
    assert.equal(st.stallCount, 0);
    assert.equal(st.stuck, false);
    assert.equal(st.lastDoneCount, null); // 重入防误振（评审 E2）
    // 一次性：标记已清，第二次 Stop 回到正常拉回纪律
    const o2 = JSON.parse(hook("stop.js", { sessionId: "s", cwd: d }).out);
    assert.equal(o2.continue, true);
    assert.match(o2.additionalContext, /1\/2/);
  } finally {
    cleanup(d);
  }
});

test("stop：交接放行覆盖全收口分支（消费块在 pending 分叉前，评审钉死落点）", () => {
  const d = scratch();
  try {
    goalAt(d, "executing", [{ id: "N1", kind: "N", status: "done" }]);
    counterAt(d, "s", 0);
    handoffMarkerAt(d);
    const o = JSON.parse(hook("stop.js", { sessionId: "s", cwd: d }).out);
    assert.equal(o.continue, false);
    assert.match(o.additionalContext, /交接标记已消费/); // 不是 finish 提醒
  } finally {
    cleanup(d);
  }
});

test("stop：坏 JSON 交接标记当垃圾清走，本轮照常拉回", () => {
  const d = scratch();
  try {
    goalAt(d);
    counterAt(d, "s", 0);
    handoffMarkerAt(d, "{{{bad");
    const o = JSON.parse(hook("stop.js", { sessionId: "s", cwd: d }).out);
    assert.equal(o.continue, true);
    assert.equal(existsSync(join(d, ".lazyzcode", "loop", "handoff.json")), false); // 垃圾已清
  } finally {
    cleanup(d);
  }
});

test("stop：旁路会话不消费交接标记（认领闸门先于消费块，ADR-0004×0009 组合）", () => {
  const d = scratch();
  try {
    goalAt(d);
    mkdirSync(join(d, ".lazyzcode", "loop", "sessions"), { recursive: true });
    writeFileSync(
      join(d, ".lazyzcode", "loop", "sessions", "claimed.json"),
      JSON.stringify({ claimedAt: new Date().toISOString() }),
    );
    handoffMarkerAt(d);
    const o = hook("stop.js", { sessionId: "bystander", cwd: d }); // 未认领会话
    assert.equal(o.out, "{}"); // 放手
    assert.equal(existsSync(join(d, ".lazyzcode", "loop", "handoff.json")), true); // 标记未被旁路消费
  } finally {
    cleanup(d);
  }
});

function metricsAt(dir, body) {
  writeFileSync(join(dir, ".lazyzcode", "loop", "metrics.json"), body);
}

function metricsOf(dir) {
  return JSON.parse(readFileSync(join(dir, ".lazyzcode", "loop", "metrics.json"), "utf8"));
}

test("stop：放行计数（可观测面）——释放路径 consumed +1、连续消费累加、registered 不归 Stop 管", () => {
  const d = scratch();
  try {
    goalAt(d);
    counterAt(d, "s", 0);
    handoffMarkerAt(d);
    assert.equal(hook("stop.js", { sessionId: "s", cwd: d }).code, 0); // 放行
    const m1 = metricsOf(d);
    assert.equal(m1.consumed, 1); // 无档从 0 建
    assert.equal(m1.registered, undefined); // Stop 侧只动 consumed（registered 归 CLI 登记路径）
    handoffMarkerAt(d);
    assert.equal(hook("stop.js", { sessionId: "s", cwd: d }).code, 0); // 第二次放行
    assert.equal(metricsOf(d).consumed, 2); // 连续消费累加
  } finally {
    cleanup(d);
  }
});

test("stop：放行计数读-合-写——预置档整档保留只增 consumed", () => {
  const d = scratch();
  try {
    goalAt(d);
    counterAt(d, "s", 0);
    metricsAt(d, JSON.stringify({ registered: 9, consumed: 5 }));
    handoffMarkerAt(d);
    hook("stop.js", { sessionId: "s", cwd: d });
    const m = metricsOf(d);
    assert.equal(m.consumed, 6);
    assert.equal(m.registered, 9); // 他方字段原样保留
    assert.equal(typeof m.updatedAt, "string");
  } finally {
    cleanup(d);
  }
});

test("stop：放行计数不加在非消费路径——坏 JSON 标记与旁路会话都不建档", () => {
  const d1 = scratch();
  const d2 = scratch();
  try {
    goalAt(d1);
    counterAt(d1, "s", 0);
    handoffMarkerAt(d1, "{{{bad"); // 坏标记：垃圾清走、视同无标记
    hook("stop.js", { sessionId: "s", cwd: d1 });
    assert.equal(existsSync(join(d1, ".lazyzcode", "loop", "metrics.json")), false); // 不计数

    goalAt(d2);
    mkdirSync(join(d2, ".lazyzcode", "loop", "sessions"), { recursive: true });
    writeFileSync(
      join(d2, ".lazyzcode", "loop", "sessions", "claimed.json"),
      JSON.stringify({ claimedAt: new Date().toISOString() }),
    );
    handoffMarkerAt(d2);
    hook("stop.js", { sessionId: "bystander", cwd: d2 }); // 旁路放手
    assert.equal(existsSync(join(d2, ".lazyzcode", "loop", "metrics.json")), false); // 不计数
  } finally {
    cleanup(d1, d2);
  }
});

test("session-start：在跑目标注入下一步，坏 stdin 静默", () => {
  const d = scratch();
  try {
    goalAt(d);
    const ok = hook("session-start.js", { cwd: d });
    assert.equal(ok.code, 0);
    assert.match(JSON.parse(ok.out).additionalContext, /下一步 N1/);
    assert.equal(hook("session-start.js", "{{{").out, "{}");
  } finally {
    cleanup(d);
  }
});

test("trigger：分层匹配注入矩阵（bare zw 句首锚定/显式全名任意/别名任意）", () => {
  const inject = [
    "zw 帮我审查", // bare zw 句首
    "  zw 前导空白仍算句首",
    "zw继续", // 后随 CJK 不拦（R4-4 口径，合意）
    "ZW 大写", // 大写句首
    "帮我查 lazyzcode:zw 的注入", // 显式全名，任意位置
    "lazyzcode：zw 全角冒号也算显式",
    "ulw 继续", // 别名任意位置
    "ultrawork now",
  ];
  const silent = [
    "wz zw", // 句中 bare zw：分层后不再触发（2026-09-07 行为变更）
    "伊zw语", // 同上——R4-4「CJK 相邻 INJECT」被分层取代，改记账为静默
    "zwift", // 后随拉丁标识符不触发
    "帮我 pwd 一下",
    "azw b",
    "ultraworks",
    "a_zw b",
    "",
    "hello world",
    "{bad json",
  ];
  for (const p of inject) {
    assert.match(JSON.parse(hook("trigger.js", { prompt: p }).out).additionalContext, /Trigger word/);
  }
  for (const p of silent) {
    assert.equal(hook("trigger.js", { prompt: p }).out, "{}");
  }
});

test("comment-checker：在跑目标提示、终态静默、无目标静默", () => {
  const d = scratch();
  try {
    goalAt(d, "executing", []);
    const inp = { cwd: d, tool_name: "Write", tool_input: { content: "// TODO fix" } };
    assert.match(JSON.parse(hook("comment-checker.js", inp).out).additionalContext, /标记:片段L1 TODO/);
    goalAt(d, "done", []); // 终态 goal.json 仍在盘上：不得永远提示（评审 R4-1）
    assert.equal(hook("comment-checker.js", inp).out, "{}");
    const noGoal = scratch();
    assert.equal(hook("comment-checker.js", { ...inp, cwd: noGoal }).out, "{}");
    cleanup(noGoal);
  } finally {
    cleanup(d);
  }
});

test("comment-checker：上限 5 处列出、总长 ≤300、调试残留、干净内容静默", () => {
  const d = scratch();
  try {
    goalAt(d, "executing", []);
    const ten = Array.from({ length: 10 }, (_, i) => `// line ${i} TODO`).join("\n");
    const out = JSON.parse(
      hook("comment-checker.js", { cwd: d, tool_name: "Write", tool_input: { content: ten } }).out,
    ).additionalContext;
    assert.match(out, /含 10 处/);
    assert.match(out, /及 5 处更多/);
    assert.ok(out.length <= 300);
    const dbg = JSON.parse(
      hook("comment-checker.js", {
        cwd: d,
        tool_name: "Write",
        tool_input: { content: "const v=1;\nconsole.log(v);\ndebugger;" },
      }).out,
    ).additionalContext;
    assert.match(dbg, /调试:片段L2 console\.log/);
    assert.match(dbg, /调试:片段L3 debugger/);
    const clean = hook("comment-checker.js", { cwd: d, tool_name: "Write", tool_input: { content: "const ok=1;" } });
    assert.equal(clean.out, "{}");
  } finally {
    cleanup(d);
  }
});

const HAS_SQLITE3 = spawnSync("sqlite3", ["--version"], { timeout: 5_000 }).status === 0;

test("水位警戒线（plan-v2 Phase 2-3）：超阈值注一次、窗内不重复、env 抬线、无账本静默", { skip: !HAS_SQLITE3 }, () => {
  const d = scratch();
  const home = mkdtempSync(join(tmpdir(), "lzy-hooks-wl-home-"));
  try {
    // fixture 账本：近 1h Flash 1e9 input ≈ 2300 积分 > 默认线 1600
    const dbDir = join(home, ".zcode", "cli", "db");
    mkdirSync(dbDir, { recursive: true });
    const create = spawnSync(
      "sqlite3",
      [
        join(dbDir, "db.sqlite"),
        "CREATE TABLE model_usage (session_id TEXT, model_id TEXT, started_at INTEGER, status TEXT, input_tokens INTEGER, cache_read_input_tokens INTEGER, output_tokens INTEGER);" +
          `INSERT INTO model_usage VALUES ('x','GLM-5.3-Flash',${Date.now()},'completed',1000000000,0,0);`,
      ],
      { timeout: 10_000 },
    );
    assert.equal(create.status, 0);
    goalAt(d, "executing", [{ id: "F1", kind: "F", status: "pending" }]);
    counterAt(d, "s", 0);
    const wlEnv = { HOME: home, USERPROFILE: home };
    const o1 = JSON.parse(hook("stop.js", { sessionId: "s", cwd: d }, wlEnv).out);
    assert.equal(o1.continue, true);
    assert.match(o1.additionalContext, /水位警戒/);
    const st1 = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "sessions", "s.json"), "utf8"));
    assert.ok(st1.lastWaterlineWarnAt > 0, "warn-once 状态落会话文件");
    // 同会话窗内二跑不重复
    const o2 = JSON.parse(hook("stop.js", { sessionId: "s", cwd: d }, wlEnv).out);
    assert.equal(o2.continue, true);
    assert.doesNotMatch(o2.additionalContext, /水位警戒/);
    // env 抬线：另一会话不触警
    counterAt(d, "s2", 0);
    const o3 = JSON.parse(
      hook("stop.js", { sessionId: "s2", cwd: d }, { HOME: home, USERPROFILE: home, LZY_WATERLINE_POINTS: "999999" }).out,
    );
    assert.equal(o3.continue, true);
    assert.doesNotMatch(o3.additionalContext, /水位警戒/);
    // 无账本 HOME（隔离默认）：fail-open 静默，续跑语义不受影响
    counterAt(d, "s3", 0);
    const o4 = JSON.parse(hook("stop.js", { sessionId: "s3", cwd: d }).out);
    assert.equal(o4.continue, true);
    assert.doesNotMatch(o4.additionalContext, /水位警戒/);
  } finally {
    cleanup(d, home);
  }
});

test("wake_noop 遥测（plan-v2 Phase 2-6）：零推进收场计数、有推进不算、交接放行不算", () => {
  // 容错读：无计数=文件根本不存在（undefined 语义即「从未计过」）
  const metricOr = (dir, key) => {
    try {
      return JSON.parse(readFileSync(join(dir, ".lazyzcode", "loop", "metrics.json"), "utf8"))[key];
    } catch {
      return undefined;
    }
  };
  const steps2 = [
    { id: "N1", kind: "N", status: "pending" },
    { id: "N2", kind: "N", status: "pending" },
  ];
  const d1 = scratch();
  const d2 = scratch();
  const d3 = scratch();
  try {
    // 零推进三连 → stuck 收场计 1
    goalAt(d1, "executing", steps2);
    mkdirSync(join(d1, ".lazyzcode", "loop", "sessions"), { recursive: true });
    writeFileSync(join(d1, ".lazyzcode", "loop", "sessions", "w.json"), JSON.stringify({ continues: 0, unattended: true }));
    hook("stop.js", { sessionId: "w", cwd: d1 });
    hook("stop.js", { sessionId: "w", cwd: d1 });
    hook("stop.js", { sessionId: "w", cwd: d1 });
    hook("stop.js", { sessionId: "w", cwd: d1 }); // stuck 后重复 stop：单次护栏不再累加
    assert.equal(metricsOf(d1).wake_noop, 1);
    // 有推进到预算耗尽：不算（会话全程基线比较，非末段振数）
    goalAt(d2, "executing", steps2);
    mkdirSync(join(d2, ".lazyzcode", "loop", "sessions"), { recursive: true });
    writeFileSync(join(d2, ".lazyzcode", "loop", "sessions", "w.json"), JSON.stringify({ continues: 0, unattended: true }));
    hook("stop.js", { sessionId: "w", cwd: d2 });
    goalAt(d2, "executing", [{ id: "N1", kind: "N", status: "done" }, { id: "N2", kind: "N", status: "pending" }]);
    hook("stop.js", { sessionId: "w", cwd: d2 });
    hook("stop.js", { sessionId: "w", cwd: d2 }); // 预算耗尽，但基线 0→1 有推进
    assert.equal(metricOr(d2, "wake_noop"), undefined);
    // 非无人值守会话零推进收场：不计数
    const d4 = scratch();
    try {
      goalAt(d4, "executing", steps2);
      counterAt(d4, "u", 0);
      hook("stop.js", { sessionId: "u", cwd: d4 });
      hook("stop.js", { sessionId: "u", cwd: d4 });
      hook("stop.js", { sessionId: "u", cwd: d4 });
      assert.equal(metricOr(d4, "wake_noop"), undefined);
    } finally {
      cleanup(d4);
    }
    // 交接放行路径：不经过计数
    goalAt(d3, "executing", steps2);
    mkdirSync(join(d3, ".lazyzcode", "loop", "sessions"), { recursive: true });
    writeFileSync(join(d3, ".lazyzcode", "loop", "sessions", "w.json"), JSON.stringify({ continues: 0, unattended: true }));
    handoffMarkerAt(d3);
    hook("stop.js", { sessionId: "w", cwd: d3 });
    assert.equal(metricOr(d3, "wake_noop"), undefined);
    assert.equal(metricOr(d3, "consumed"), 1);
  } finally {
    cleanup(d1, d2, d3);
  }
});

test("确定性钉：五钩子同状态双跑 stdout 逐字节一致（hook-lib 注入不变量）", () => {
  // 同一会话状态 → 同一字节输出（hook-lib.js 头注释不变量，GLM prompt cache 前缀比对敏感）。
  // 有状态钩子（trigger 认领写/tripwire warn-once/stop 计数）每轮重建同构状态目录——
  // 否则测到的是合法状态演进而非不确定性；五例都断言产出非空注入（防 {}=={} 空过）。
  const now = Date.now();
  const cases = [
    {
      name: "session-start.js",
      seed: (d) => goalAt(d, "executing"),
      drive: (d) => hook("session-start.js", { cwd: d }),
    },
    {
      name: "trigger.js",
      seed: (d) => {
        goalAt(d, "executing");
        counterAt(d, "s", 0);
      },
      drive: (d) => hook("trigger.js", { prompt: "zw 继续推进当前步骤", cwd: d, session_id: "s" }),
    },
    {
      name: "comment-checker.js",
      seed: (d) => goalAt(d, "executing"),
      drive: (d) =>
        hook("comment-checker.js", { cwd: d, tool_name: "Write", tool_input: { content: "// TODO 待办\nconst a=1;" } }),
    },
    {
      name: "tripwire.js",
      seed: (d) => {
        goalAt(d, "executing");
        mkdirSync(join(d, ".lazyzcode", "loop", "sessions"), { recursive: true });
        writeFileSync(
          join(d, ".lazyzcode", "loop", "sessions", "s.json"),
          JSON.stringify({ toolFail: { tool: "mcp__codegraph__codegraph_explore", count: 1, warned: false, lastAt: now } }),
        );
      },
      drive: (d) =>
        hook("tripwire.js", {
          session_id: "s",
          cwd: d,
          tool_name: "mcp__codegraph__codegraph_explore",
          error: "Tool execution timed out after 30000ms",
          is_interrupt: false,
        }),
    },
    {
      name: "stop.js",
      seed: (d) => {
        goalAt(d, "executing");
        counterAt(d, "s", 0);
      },
      drive: (d) => hook("stop.js", { sessionId: "s", cwd: d }),
    },
  ];
  for (const { name, seed, drive } of cases) {
    const dirs = [scratch(), scratch()];
    try {
      for (const d of dirs) seed(d);
      const o1 = drive(dirs[0]).out;
      const o2 = drive(dirs[1]).out;
      assert.ok(o1.length > 2 && o1 !== "{}", `${name} 双跑首趟应产出非空注入（防空过）`);
      assert.equal(o1, o2, `${name} 双跑输出不一致——注入文本必须确定性（hook-lib.js 头注释不变量）`);
    } finally {
      cleanup(...dirs);
    }
  }
});
