// 目标循环 E2E：spawn 真实 CLI 于临时 git 仓，固化状态机与两道门的行为契约。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");

function repo({ git = true } = {}) {
  const d = mkdtempSync(join(tmpdir(), "lzy-e2e-"));
  if (git) {
    const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
    g(["init", "-q"]);
    g(["config", "user.email", "t@l"]);
    g(["config", "user.name", "t"]);
    writeFileSync(join(d, "a.txt"), "a\n");
    g(["add", "a.txt"]);
    g(["commit", "-qm", "init"]);
  }
  return d;
}

function lzy(args, cwd, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 60_000, ...opts });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const THREE_STEPS = "- [N1] x\n- [N2] y\n- [F1] v\n";

function setup(dir, body) {
  const p = join(dir, "plan.md");
  writeFileSync(p, body);
  return "plan.md";
}

test("全链：计划门→REVISE force 不越过→证据门→过期拦截→finish", () => {
  const d = repo();
  try {
    assert.equal(lzy(["loop", "register", "e2e", "--title", "t"], d).code, 0);
    const bad = setup(d, "- [N1] ok\n- 背景注：去留未定\n");
    const rBad = lzy(["loop", "plan", bad], d);
    assert.equal(rBad.code, 1);
    assert.match(rBad.out, /L2/); // 评审 R2-7：报行号
    const ok = setup(d, THREE_STEPS);
    assert.equal(lzy(["loop", "plan", ok, "--review", "plan-reviewer: VERDICT: REVISE — fix"], d).code, 1);
    assert.equal(
      lzy(["loop", "plan", ok, "--review", "plan-reviewer: VERDICT: REVISE — fix", "--force"], d).code,
      1,
    ); // --force 不越过（宪法 #15）
    // R2-3 回归：VERDICT: PASS 附言含 revise 不得误拒
    assert.equal(
      lzy(["loop", "plan", ok, "--review", "plan-reviewer: VERDICT: PASS — ok, revise wording later"], d).code,
      0,
    );
    assert.equal(lzy(["loop", "start"], d).code, 0);
    assert.equal(lzy(["step", "done", "F1"], d).code, 1); // F 项强制证据
    assert.equal(lzy(["step", "done", "N1", "--note", "n"], d).code, 0);
    assert.equal(lzy(["step", "done", "N2", "--note", "n"], d).code, 0);
    assert.equal(lzy(["step", "done", "F1", "--evidence", "saw stdout"], d).code, 0);
    assert.equal(lzy(["loop", "verify"], d).code, 0); // 新鲜
    writeFileSync(join(d, "a.txt"), "b\n");
    spawnSync("git", ["add", "a.txt"], { cwd: d });
    const commit = spawnSync("git", ["commit", "-qm", "c2"], { cwd: d, encoding: "utf8" });
    assert.equal(commit.status, 0);
    assert.equal(lzy(["loop", "verify"], d).code, 1); // 过期即 1（评审 R2-6）
    assert.equal(lzy(["loop", "finish"], d).code, 1); // 终验拦截
    assert.match(lzy(["loop", "finish"], d).out, /已过期/);
    assert.equal(lzy(["step", "done", "F1", "--evidence", "rebind"], d).code, 0);
    const fin = lzy(["loop", "finish"], d);
    assert.equal(fin.code, 0);
    assert.match(fin.out, /目标完成/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("abandon 两态可用（P1 回归）；abandoned 占用工作区直至 reset", () => {
  const d = repo();
  try {
    assert.equal(lzy(["loop", "register", "ab", "--title", "t"], d).code, 0);
    const a1 = lzy(["loop", "abandon"], d); // planning 态
    assert.equal(a1.code, 0);
    assert.match(a1.out, /已放弃/);
    assert.equal(lzy(["loop", "register", "ab2", "--title", "t"], d).code, 1); // abandoned 仍占用
    assert.equal(lzy(["loop", "reset"], d).code, 0);
    assert.equal(lzy(["loop", "register", "ab3", "--title", "t"], d).code, 0);
    writeFileSync(join(d, "p.md"), "- [N1] x\n");
    assert.equal(lzy(["loop", "plan", "p.md"], d).code, 0);
    assert.equal(lzy(["loop", "start"], d).code, 0);
    assert.equal(lzy(["loop", "abandon"], d).code, 0); // executing 态
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("并发 step done：锁串行化，全部落账且 goal.json 合法（R2-5 回归）", async () => {
  const d = repo();
  try {
    assert.equal(lzy(["loop", "register", "cc", "--title", "t"], d).code, 0);
    writeFileSync(join(d, "p.md"), "- [N1] x\n- [N2] y\n- [N3] z\n");
    assert.equal(lzy(["loop", "plan", "p.md"], d).code, 0);
    assert.equal(lzy(["loop", "start"], d).code, 0);
    const kids = ["N1", "N2", "N3"].map((id) =>
      spawn(process.execPath, [CLI, "step", "done", id, "--note", id], { cwd: d }),
    );
    const codes = await Promise.all(
      kids.map((k) => new Promise((res) => k.on("close", (c) => res(c)))),
    );
    assert.deepEqual(codes, [0, 0, 0]);
    const goal = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
    assert.deepEqual(
      goal.steps.filter((s) => s.status === "done").map((s) => s.id).sort(),
      ["N1", "N2", "N3"],
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("git-less 目录：证据未绑定与 finish 的分诊文案（R2-4 回归）", () => {
  const d = repo({ git: false });
  try {
    assert.equal(lzy(["loop", "register", "ng", "--title", "t"], d).code, 0);
    writeFileSync(join(d, "p.md"), "- [N1] x\n- [F1] v\n");
    assert.equal(lzy(["loop", "plan", "p.md"], d).code, 0);
    assert.equal(lzy(["loop", "start"], d).code, 0);
    assert.equal(lzy(["step", "done", "N1", "--note", "n"], d).code, 0);
    assert.equal(lzy(["step", "done", "F1", "--evidence", "saw"], d).code, 0);
    const fin = lzy(["loop", "finish"], d);
    assert.equal(fin.code, 1);
    assert.match(fin.out, /未绑定/);
    assert.match(fin.out, /不是 git 仓库/); // 药方可执行，不再误诊「过期」
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("fail-fast（ADR-0006）：空目录写命令报错且不留 .lazyzcode/ 疤痕", () => {
  const d = repo({ git: false });
  try {
    const r = lzy(["step", "done", "N1", "--note", "n"], d);
    assert.equal(r.code, 1);
    assert.match(r.out, /本目录没有目标/);
    assert.ok(r.out.includes(join(d, ".lazyzcode", "loop")), "报错应含实际检查的绝对路径");
    assert.equal(existsSync(join(d, ".lazyzcode")), false); // withLock 前判空，无空壳疤痕
    assert.equal(lzy(["loop", "finish"], d).code, 1);
    assert.equal(existsSync(join(d, ".lazyzcode")), false);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("恢复式报错（ADR-0006）：status 读面报实际检查路径 + 恢复指引，不报错", () => {
  const d = repo({ git: false });
  try {
    const r = lzy(["loop", "status"], d);
    assert.equal(r.code, 0); // 读面：打印指引而非抛错
    assert.match(r.out, /本目录没有目标循环状态/);
    assert.ok(r.out.includes(join(d, ".lazyzcode", "loop")));
    assert.match(r.out, /恢复/);
    assert.match(r.out, /宿主工作区|工作区根/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
