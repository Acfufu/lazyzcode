// tier-2 契约测试：证据附件（--evidence-file）+ 证据包导出（finish 归档 / loop export）
// + 带内调度建议（bandAdvisory 纯函数 / loop start 并发纪律行）。
// 每个 E2E 用例的 HOME 都指向 scratch（lzy() 统一注入 env），绝不读真实 ~/.zcode/cli/log
// ——测试不随宿主机日志量波动，也不被真实限流状态污染。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { bandAdvisory } from "../core/ratelimit.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");

function repo() {
  const d = mkdtempSync(join(tmpdir(), "lzy-t2-"));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  return d;
}

const freshHome = () => mkdtempSync(join(tmpdir(), "lzy-t2-home-"));

function mkLzy(home) {
  const env = { ...process.env, HOME: home };
  return (args, cwd, opts = {}) =>
    lzyRaw(args, cwd, { env, ...opts });
}

function lzyRaw(args, cwd, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 120_000, ...opts });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const THREE_STEPS = "- [N1] x\n- [F1] v\n";
const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000", "hex");

// 只跑到 plan 采纳（start 由各测试自控，便于断言 start 自身的输出）
function setupGoal(lzy, d, slug = "t2") {
  assert.equal(lzy(["loop", "register", slug, "--title", "t"], d).code, 0);
  const p = join(d, "plan.md");
  writeFileSync(p, THREE_STEPS);
  assert.equal(lzy(["loop", "plan", p, "--review", "plan-reviewer: VERDICT: PASS — ok"], d).code, 0);
}

test("证据附件：--evidence-file 复制入 evidence/ 并绑 sha256；report 归档含附件", () => {
  const d = repo();
  const home = freshHome();
  const lzy = mkLzy(home);
  try {
    setupGoal(lzy, d, "att");
    assert.equal(lzy(["loop", "start"], d).code, 0);
    const shot = join(d, "shot.png");
    writeFileSync(shot, PNG_BYTES);
    const r = lzy(["step", "done", "F1", "--evidence", "screenshot shows 200 page", "--evidence-file", shot], d);
    assert.equal(r.code, 0);
    assert.match(r.out, /附件/);
    const goal = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
    const ev = goal.steps.find((s) => s.id === "F1").evidence;
    assert.equal(ev.files.length, 1);
    const want = createHash("sha256").update(PNG_BYTES).digest("hex");
    assert.equal(ev.files[0].sha256, want);
    assert.equal(ev.files[0].bytes, PNG_BYTES.length);
    assert.match(ev.files[0].path, /^\.lazyzcode[/\\]evidence[/\\]att\.F1\.1\.png$/);
    // 副本自包含：字节数与 sha256 与原件一致
    const copy = readFileSync(join(d, ev.files[0].path));
    assert.equal(copy.length, PNG_BYTES.length);
    assert.equal(createHash("sha256").update(copy).digest("hex"), want);
    // N 项拒绝附件
    const rn = lzy(["step", "done", "N1", "--note", "n", "--evidence-file", shot], d);
    assert.equal(rn.code, 1);
    assert.match(rn.out, /仅 F 项/);
    // N 项正常收口（无附件）后才能 finish
    assert.equal(lzy(["step", "done", "N1", "--note", "n"], d).code, 0);
    // status 显示附件计数
    assert.match(lzy(["loop", "status"], d).out, /附件 1/);
    // finish 自动归档证据包 + memory 收尾提示
    const fin = lzy(["loop", "finish"], d);
    assert.equal(fin.code, 0);
    assert.match(fin.out, /证据包已归档/);
    assert.match(fin.out, /memory/);
    const reportPath = join(d, ".lazyzcode", "evidence", "att.report.md");
    assert.equal(existsSync(reportPath), true);
    const report = readFileSync(reportPath, "utf8");
    assert.match(report, /# 目标循环报告：att/);
    assert.match(report, /评审 PASS/);
    assert.match(report, /att\.F1\.1\.png/);
    assert.ok(report.includes(want.slice(0, 16)));
    // export 重导出（done 态可再导）
    const re = lzy(["loop", "export"], d);
    assert.equal(re.code, 0);
    assert.match(re.out, /att\.report\.md/);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("证据附件边界：文件缺失拒绝、多附件追加落位、超上限拒绝", () => {
  const d = repo();
  const home = freshHome();
  const lzy = mkLzy(home);
  try {
    setupGoal(lzy, d, "edge");
    assert.equal(lzy(["loop", "start"], d).code, 0);
    const miss = lzy(["step", "done", "F1", "--evidence", "x", "--evidence-file", join(d, "nope.png")], d);
    assert.equal(miss.code, 1);
    assert.match(miss.out, /证据文件不可读/);
    // 两个附件按序落位
    const a = join(d, "a.png");
    const b = join(d, "b.png");
    writeFileSync(a, PNG_BYTES);
    writeFileSync(b, Buffer.from("bb"));
    const two = lzy(
      ["step", "done", "F1", "--evidence", "two shots", "--evidence-file", a, "--evidence-file", b],
      d,
    );
    assert.equal(two.code, 0);
    const goal = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
    assert.deepEqual(
      goal.steps.find((s) => s.id === "F1").evidence.files.map((f) => f.path.split("/").pop()),
      ["edge.F1.1.png", "edge.F1.2.png"],
    );
    // >4 个附件拒绝
    const many = ["p1", "p2", "p3", "p4", "p5"].map((n) => {
      const p = join(d, `${n}.txt`);
      writeFileSync(p, n);
      return p;
    });
    const over = lzy(
      ["step", "done", "F1", "--evidence", "over", ...many.flatMap((p) => ["--evidence-file", p])],
      d,
    );
    assert.equal(over.code, 1);
    assert.match(over.out, /附件超上限/);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("bandAdvisory：无数据默认 2 / 刚撞线串行 / 集中段串行 / 连贯带 ≤2 / 带不连贯串行", () => {
  const now = new Date();
  // 无日志 / 无 429：默认 ≤2
  assert.equal(bandAdvisory(null).cap, 2);
  assert.equal(bandAdvisory({ available: false }).cap, 2);
  assert.equal(bandAdvisory({ available: true, rateLimited: 0 }).cap, 2);
  // 60min 内撞线 → 串行（lastAt 在未来也保守串行）
  const recent = (minsAgo) => new Date(now.getTime() - minsAgo * 60_000).toISOString();
  assert.equal(bandAdvisory({ available: true, rateLimited: 5, lastAt: recent(5) }).cap, 1);
  assert.equal(bandAdvisory({ available: true, rateLimited: 5, lastAt: recent(-3) }).cap, 1);
  // 集中段盖住当前本地小时 → 串行（lastAt 已过 3h，只剩集中段命中）
  const h = now.getHours();
  const conc = { startHour: h, endHour: (h + 3) % 24, sharePct: 70, turns: 50 };
  const inWindow = bandAdvisory({
    available: true, rateLimited: 5, lastAt: recent(180), concentration: conc,
  });
  assert.equal(inWindow.cap, 1);
  assert.match(inWindow.reason, /集中段/);
  // 连贯经验带且净桶安全界 ≥2 → ≤2
  const band = bandAdvisory({
    available: true, rateLimited: 5, lastAt: recent(180), concentration: null,
    band: { coherent: true, minDirty: 5, maxClean: 3 },
  });
  assert.equal(band.cap, 2);
  assert.match(band.reason, /经验带/);
  // 带不连贯 → 保守串行
  assert.equal(
    bandAdvisory({
      available: true, rateLimited: 5, lastAt: recent(180), concentration: null,
      band: { coherent: false, minDirty: 1, maxClean: 0 },
    }).cap,
    1,
  );
});

test("loop start 打印实测并发纪律行；无日志时缺省不打印（fail-open）", () => {
  const home = freshHome();
  const lzy = mkLzy(home);
  const d = repo();
  try {
    setupGoal(lzy, d, "adv");
    // scratch HOME 有近期撞线日志 → 上限 1
    const logDir = join(home, ".zcode", "cli", "log");
    mkdirSync(logDir, { recursive: true });
    const ts = new Date(Date.now() - 5 * 60_000).toISOString();
    writeFileSync(
      join(logDir, `zcode-${ts.slice(0, 10)}.jsonl`),
      `${JSON.stringify({
        timestamp: ts,
        sessionId: "s1",
        event: "model.request.failed",
        context: { reason: "rate_limited", attempt: 1, maxAttempts: 11 },
      })}\n`,
    );
    const r = lzy(["loop", "start"], d);
    assert.equal(r.code, 0);
    assert.match(r.out, /并发纪律：子代理并行上限 1/);
    assert.match(r.out, /分钟前仍在撞线/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  // 空 HOME（无日志）→ 无建议行，开跑不受影响
  const emptyHome = freshHome();
  const d2 = repo();
  try {
    const lzy2 = mkLzy(emptyHome);
    setupGoal(lzy2, d2, "adv2");
    const quiet = lzy2(["loop", "start"], d2);
    assert.equal(quiet.code, 0);
    assert.doesNotMatch(quiet.out, /并发纪律/);
  } finally {
    rmSync(d2, { recursive: true, force: true });
    rmSync(emptyHome, { recursive: true, force: true });
  }
});
