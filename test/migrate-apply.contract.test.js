// 迁移机器（0.3.0 M5，主方案 §8）契约：apply 四阶段全链（备份 manifest sha256/在途→
// drafts authorization=NONE/按 slug+planHash 幂等 no-op/executing-死-holder 可转换/
// preserve 族源字节不变）、执法面（活体 lease 拒/goal.json 损坏写前停/未知版本停/state
// 损坏停）、崩溃恢复（未收尾 journal 续跑+草案已写不覆盖+state 提交点补齐）、doctor
// migrate 行版本入口读面。家法：真子进程+隔离 HOME（同 migrate-preview.contract.test.js）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { saveRuntime } from "../core/runtime.js";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = join(ROOT, "cli", "lzy.js");

function lzyAt(args, cwd, HOME) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "lzy-test-suppress" },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function sha256(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function snapshotTree(dir) {
  const out = new Map();
  const walk = (p) => {
    let names;
    try {
      names = readdirSync(p);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(p, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else out.set(full, sha256(full));
    }
  };
  walk(dir);
  return out;
}

// 已死 pid（跨平台确定性）：spawnSync 起一个立即退出的 node，其 pid 在返回后必不存在。
function deadPid() {
  const r = spawnSync(process.execPath, ["-e", ""]);
  return r.pid ?? 1;
}

// 旧树夹具：在途 goal（status 可选 planning/executing）+六记录族样例。
function legacyRoot({ status = "planning", runtime = null, goalRaw = null } = {}) {
  const d = mkdtempSync(join(tmpdir(), "lzy-mga-"));
  const HOME = mkdtempSync(join(tmpdir(), "lzy-mga-home-"));
  const lz = join(d, ".lazyzcode");
  mkdirSync(join(lz, "loop", "snapshots"), { recursive: true });
  mkdirSync(join(lz, "loop", "approvals"), { recursive: true });
  mkdirSync(join(lz, "loop", "salvage"), { recursive: true });
  mkdirSync(join(lz, "attestations"), { recursive: true });
  mkdirSync(join(lz, "evidence"), { recursive: true });
  mkdirSync(join(lz, "plans"), { recursive: true });
  if (goalRaw === null) {
    goalRaw = JSON.stringify({ version: 1, slug: "old-goal", status, planHash: "a".repeat(64), title: "old" });
  }
  writeFileSync(join(lz, "loop", "goal.json"), goalRaw);
  writeFileSync(join(lz, "loop", "snapshots", "old-goal.md"), "# 计划\n\n- [F1] real surface checked\n- [F2] recovery holds\n");
  writeFileSync(join(lz, "loop", "snapshots", "old-goal.attempt1.md"), "# 旧代次\n\n- [F1] superseded draft\n");
  writeFileSync(join(lz, "loop", "approvals", "aaaa-sess_old.json"), JSON.stringify({ version: 1, slug: "old-goal", planHash: "a".repeat(64), at: "2026-01-01T00:00:00.000Z" }));
  writeFileSync(join(lz, "loop", "salvage", "old-goal.md"), "# salvage stub\n");
  writeFileSync(join(lz, "attestations", "old-goal-att.json"), JSON.stringify({ slug: "old-goal", planHash: "a".repeat(64), at: 1700000000000 }));
  writeFileSync(join(lz, "evidence", "old-goal.report.md"), "# evidence bundle\n");
  writeFileSync(join(lz, "plans", "old-goal.md"), "# plan file\n");
  if (runtime) writeFileSync(join(lz, "loop", "runtime.json"), JSON.stringify(runtime));
  return { d, HOME, lz };
}

test("迁移 apply：在途→草案 authorization NONE+state 版本入口+journal 收尾", () => {
  const { d, HOME, lz } = legacyRoot({ status: "planning" });
  const r = lzyAt(["migrate", "apply", d], d, HOME);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /迁移 apply 完成/);
  const draft = readFileSync(join(lz, "drafts", "old-goal.draft-contract.md"), "utf8");
  assert.match(draft, /authorization: NONE/);
  assert.match(draft, /F1: real surface checked/);
  assert.match(draft, /planHash=a{64}/);
  const state = JSON.parse(readFileSync(join(lz, "state.json"), "utf8"));
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.stateVersion, "0.3.0");
  assert.equal(state.tasks["old-goal"].planHash, "a".repeat(64));
  assert.match(state.tasks["old-goal"].draftFile, /drafts\/old-goal\.draft-contract\.md$/);
  const jdir = join(lz, "migration", "journal");
  const jf = readdirSync(jdir).find((f) => f.endsWith(".jsonl"));
  const phases = readFileSync(join(jdir, jf), "utf8").trim().split("\n").map((l) => JSON.parse(l).phase);
  assert.deepEqual(phases, ["start", "backup", "stage", "validate", "switch", "done"]);
  // 备份 manifest 逐文件 sha256 且副本与源一致
  const runId = state.lastRunId;
  const backupDir = join(lz, "migration", "backup", runId);
  const manifest = JSON.parse(readFileSync(join(backupDir, "manifest.json"), "utf8"));
  assert.ok(manifest.files.length >= 7, `manifest files=${manifest.files.length}`);
  for (const m of manifest.files) {
    assert.equal(sha256(join(backupDir, m.rel)), m.sha256);
    assert.equal(sha256(join(lz, m.rel)), m.sha256, `源与副本不一致：${m.rel}`);
  }
});

test("迁移 apply：幂等重跑 no-op（不重复草案/不新增备份/state 不变）", () => {
  const { d, HOME, lz } = legacyRoot({ status: "executing" });
  assert.equal(lzyAt(["migrate", "apply", d], d, HOME).code, 0);
  const state1 = readFileSync(join(lz, "state.json"), "utf8");
  const draftHash = sha256(join(lz, "drafts", "old-goal.draft-contract.md"));
  const backups1 = readdirSync(join(lz, "migration", "backup")).length;
  const r = lzyAt(["migrate", "apply", d], d, HOME);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /幂等 no-op/);
  assert.match(r.out, /已按任务身份/);
  assert.equal(readFileSync(join(lz, "state.json"), "utf8"), state1, "state 被改写");
  assert.equal(sha256(join(lz, "drafts", "old-goal.draft-contract.md")), draftHash, "草案被覆盖");
  assert.equal(readdirSync(join(lz, "migration", "backup")).length, backups1, "新增备份 run");
});

test("迁移 apply：executing 死 holder=在途可转换；preserve 族源字节不变", () => {
  const { d, HOME, lz } = legacyRoot({ status: "executing" });
  // 手写 runtime.json 缺 checksum 会被 loadRuntime 判不可读（保守侧拒绝）——
  // 经 saveRuntime 语义合法形态不可在测试外构造；此处用「无 runtime.json」死 holder 形态，
  // 活体形态在下一测试以进程存活 pid 钉。
  const before = snapshotTree(lz);
  const r = lzyAt(["migrate", "apply", d], d, HOME);
  assert.equal(r.code, 0, r.out);
  const after = snapshotTree(lz);
  for (const [p, h] of before) {
    if (p.startsWith(join(lz, "migration")) || p.startsWith(join(lz, "drafts")) || p === join(lz, "state.json")) continue;
    assert.equal(after.get(p), h, `源被改写：${p}`);
  }
  assert.equal(after.get(join(lz, "loop", "goal.json")), before.get(join(lz, "loop", "goal.json")));
});

test("迁移 apply：executing 僵尸租约（租约在场但持有进程已死）=在途可转换", () => {
  const { d, HOME, lz } = legacyRoot({ status: "executing" });
  saveRuntime(d, { runtimeVersion: 1, fenceCounter: 1, activeLease: { fence: 9, acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), hostPid: deadPid(), expiresAtMs: Date.now() + 600000, slug: "x" } });
  const r = lzyAt(["migrate", "apply", d], d, HOME);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /迁移 apply 完成/);
  assert.equal(JSON.parse(readFileSync(join(lz, "state.json"), "utf8")).stateVersion, "0.3.0");
});

test("迁移 apply：活体 lease 拒（写前停止，零副作用）", () => {
  const { d, HOME, lz } = legacyRoot({ status: "executing" });
  // 经真实 saveRuntime 写活体租约（checksum 合法）：hostPid=本测试进程（必活）。
  saveRuntime(d, { runtimeVersion: 1, fenceCounter: 1, activeLease: { fence: 7, acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), hostPid: process.pid, expiresAtMs: Date.now() + 600000, slug: "x" } });
  const r = lzyAt(["migrate", "apply", d], d, HOME);
  assert.equal(r.code, 1);
  assert.match(r.out, /迁移拒绝/);
  assert.match(r.out, /活体租约/);
  assert.equal(existsSync(join(lz, "migration")), false, "拒后仍写了 migration/");
  assert.equal(existsSync(join(lz, "state.json")), false, "拒后仍写了 state.json");
  assert.equal(existsSync(join(lz, "drafts")), false, "拒后仍写了 drafts/");
});

test("迁移 apply：goal.json 损坏/未知版本=写前停（零副作用）", () => {
  for (const goalRaw of ["{broken", JSON.stringify({ version: 2, slug: "x", status: "done" })]) {
    const { d, HOME, lz } = legacyRoot({ goalRaw });
    const r = lzyAt(["migrate", "apply", d], d, HOME);
    assert.equal(r.code, 1, goalRaw);
    assert.match(r.out, /迁移拒绝/);
    assert.equal(existsSync(join(lz, "migration")), false);
    assert.equal(existsSync(join(lz, "state.json")), false);
  }
});

test("迁移 apply：state.json 损坏/未知 schema=停止且不覆盖", () => {
  const { d, HOME, lz } = legacyRoot({ status: "done" });
  const corrupt = "{not json";
  writeFileSync(join(lz, "state.json"), corrupt);
  let r = lzyAt(["migrate", "apply", d], d, HOME);
  assert.equal(r.code, 1);
  assert.match(r.out, /不可解析/);
  assert.equal(readFileSync(join(lz, "state.json"), "utf8"), corrupt, "state 被覆盖");
  writeFileSync(join(lz, "state.json"), JSON.stringify({ schemaVersion: 2, stateVersion: "9.9.9" }));
  r = lzyAt(["migrate", "apply", d], d, HOME);
  assert.equal(r.code, 1);
  assert.match(r.out, /schemaVersion 不识别/);
  assert.equal(readFileSync(join(lz, "state.json"), "utf8"), JSON.stringify({ schemaVersion: 2, stateVersion: "9.9.9" }));
});

test("迁移 apply：终态/无 goal=幂等 no-op（原样保留）", () => {
  const { d, HOME, lz } = legacyRoot({ status: "done" });
  const r = lzyAt(["migrate", "apply", d], d, HOME);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /幂等 no-op/);
  assert.equal(existsSync(join(lz, "state.json")), false, "无在途也写了 state");
  const empty = legacyRoot({ goalRaw: undefined });
  try {
    rmSync(join(empty.lz, "loop", "goal.json"), { force: true });
    const r2 = lzyAt(["migrate", "apply", empty.d], empty.d, empty.HOME);
    assert.equal(r2.code, 0, r2.out);
    assert.match(r2.out, /幂等 no-op|无可转换/);
  } finally {
    rmSync(empty.d, { recursive: true, force: true });
    rmSync(empty.HOME, { recursive: true, force: true });
  }
});

test("迁移 apply：崩溃恢复——草案已写 state 缺位重跑补齐且不覆盖草案；未收尾 journal 显形", () => {
  const { d, HOME, lz } = legacyRoot({ status: "planning" });
  assert.equal(lzyAt(["migrate", "apply", d], d, HOME).code, 0);
  const draftHash = sha256(join(lz, "drafts", "old-goal.draft-contract.md"));
  rmSync(join(lz, "state.json")); // 模拟：草案落盘后、state 提交点前崩溃
  const jdir = join(lz, "migration", "journal");
  const jf = readdirSync(jdir).find((f) => f.endsWith(".jsonl"));
  writeFileSync(
    join(jdir, jf),
    readFileSync(join(jdir, jf), "utf8").split("\n").filter((l) => !/"phase":"(done|switch)"/.test(l)).join("\n"),
  ); // 退化为未收尾（剥 switch+done 相位）
  const r = lzyAt(["migrate", "apply", d], d, HOME);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /未收尾 run/);
  assert.equal(sha256(join(lz, "drafts", "old-goal.draft-contract.md")), draftHash, "恢复重跑覆盖了既有草案");
  const state = JSON.parse(readFileSync(join(lz, "state.json"), "utf8"));
  assert.equal(state.stateVersion, "0.3.0");
  const r2 = lzyAt(["migrate", "status", d], d, HOME);
  assert.match(r2.out, /stateVersion=0\.3\.0/);
});

test("doctor migrate 行：版本入口读数与缺位提示（纯信息面）", () => {
  const { d, HOME, lz } = legacyRoot({ status: "planning" });
  // doctor 在隔离 HOME 夹具上 install/files 行必 ✖（整体退出码 1）——本测试只钉 migrate
  // 行内容（该行自身纯信息面，不翻退出码）。
  let r = lzyAt(["doctor"], d, HOME);
  let line = r.out.split("\n").find((l) => l.includes("migrate"));
  assert.match(line, /版本入口缺位/);
  assert.equal(lzyAt(["migrate", "apply", d], d, HOME).code, 0);
  r = lzyAt(["doctor"], d, HOME);
  line = r.out.split("\n").find((l) => l.includes("migrate"));
  assert.match(line, /stateVersion=0\.3\.0/);
});

test("迁移 preview：零写回回归维持（M1 契约测试同面复跑）", () => {
  const { d, HOME, lz } = legacyRoot({ status: "done" });
  const before = snapshotTree(lz);
  const r = lzyAt(["migrate", "preview", d], d, HOME);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /authorization：NONE/);
  const after = snapshotTree(lz);
  assert.equal(before.size, after.size);
  for (const [p, h] of before) assert.equal(after.get(p), h, `preview 写回了 ${p}`);
});

test("迁移 apply：runtime.json 不可读=保守拒（写前停止，报文转发恢复配方）", () => {
  const { d, HOME, lz } = legacyRoot({ status: "executing" });
  writeFileSync(join(lz, "loop", "runtime.json"), "{corrupt");
  const r = lzyAt(["migrate", "apply", d], d, HOME);
  assert.equal(r.code, 1);
  assert.match(r.out, /保守侧拒绝/);
  assert.match(r.out, /runtime\.json 不可读/);
  assert.match(r.out, /恢复|RECOVERY|重建/);
  assert.equal(existsSync(join(lz, "migration")), false, "拒后仍写了 migration/");
  assert.equal(existsSync(join(lz, "state.json")), false, "拒后仍写了 state.json");
});

test("迁移 apply：slug 缺失形态幂等收敛（兜底同值回归钉）", () => {
  const { d, HOME, lz } = legacyRoot({ goalRaw: JSON.stringify({ version: 1, status: "planning", planHash: "c".repeat(64) }) });
  const r1 = lzyAt(["migrate", "apply", d], d, HOME);
  assert.equal(r1.code, 0, r1.out);
  assert.match(r1.out, /迁移 apply 完成/);
  assert.ok(existsSync(join(lz, "drafts", "unknown.draft-contract.md")));
  const backups1 = readdirSync(join(lz, "migration", "backup")).length;
  const r2 = lzyAt(["migrate", "apply", d], d, HOME);
  assert.equal(r2.code, 0, r2.out);
  assert.match(r2.out, /幂等 no-op/);
  assert.equal(readdirSync(join(lz, "migration", "backup")).length, backups1, "幂等重跑新增备份 run");
});
