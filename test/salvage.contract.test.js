// 可回收工件契约测试（goal comparator-salvage N3）：reset/abandon 盘点入存根 + status 双分支读面。
// 存根是跨会话面——事件打印会随销毁会话的转录一起死，落盘才是本体；五钉固化生成与显示两分支。
import { test } from "node:test";
// 人权门非本文件被测面（门由 human-gate.contract.test.js 两面钉）——spawn 继承此 env 保采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");

function repo() {
  const d = mkdtempSync(join(tmpdir(), "lzy-salvage-"));
  const g = (args, opts = {}) =>
    spawnSync("git", args, { cwd: d, encoding: "utf8", ...opts });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  return d;
}

function lzy(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 60_000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function stubPath(dir, slug) {
  return join(dir, ".lazyzcode", "loop", "salvage", `${slug}.md`);
}

function register(dir, slug) {
  assert.equal(lzy(["loop", "register", slug, "--title", "t"], dir).code, 0);
}

// 构造残留：未提交改动 + 一条带本 slug 尾注的提交（trailer 独立成行）
function plantResidue(dir, slug) {
  writeFileSync(join(dir, "b.txt"), "half-done\n");
  const c = spawnSync("git", ["commit", "--allow-empty", "-m", "work on step", "-m", `Goal: ${slug}#N1`], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(c.status, 0);
}

test("钉1 reset 生成存根：未提交改动与尾注提交都入盘点", () => {
  const d = repo();
  try {
    register(d, "s1");
    plantResidue(d, "s1");
    const r = lzy(["loop", "reset"], d);
    assert.equal(r.code, 0);
    assert.match(r.out, /可回收工件已盘点/);
    assert.equal(existsSync(stubPath(d, "s1")), true);
    const stub = readFileSync(stubPath(d, "s1"), "utf8");
    assert.match(stub, /b\.txt/); // 未提交改动入清单
    assert.match(stub, /work on step/); // 尾注提交入清单
    assert.match(stub, /plans\/s1\.md/); // 资产指针在场
    assert.equal(existsSync(join(d, ".lazyzcode", "loop", "goal.json")), false); // goal 清了
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("钉2 abandon 生成存根：goal 保留但盘点已落", () => {
  const d = repo();
  try {
    register(d, "s2");
    plantResidue(d, "s2");
    const r = lzy(["loop", "abandon"], d);
    assert.equal(r.code, 0);
    assert.match(r.out, /可回收工件已盘点/);
    assert.equal(existsSync(stubPath(d, "s2")), true);
    const goal = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "goal.json"), "utf8"));
    assert.equal(goal.status, "abandoned");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("钉3 status 无 goal 分支显示存根（reset 后恰是回收主时刻）", () => {
  const d = repo();
  try {
    register(d, "s3");
    plantResidue(d, "s3");
    assert.equal(lzy(["loop", "reset"], d).code, 0);
    const s = lzy(["loop", "status"], d);
    assert.equal(s.code, 0);
    assert.match(s.out, /可回收存根 1：s3/);
    assert.match(s.out, /没有目标循环状态/); // no-goal 正文仍在
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("钉4 status 有 goal 分支显示存根（重立后接管者可见先前实例）", () => {
  const d = repo();
  try {
    register(d, "s4");
    plantResidue(d, "s4");
    assert.equal(lzy(["loop", "reset"], d).code, 0);
    register(d, "s5");
    const s = lzy(["loop", "status"], d);
    assert.equal(s.code, 0);
    assert.match(s.out, /可回收存根 1：s4/);
    assert.match(s.out, /目标 s5/); // 当前 goal 正文在场
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("钉5 无存根不显示：干净目录的 status 无可回收行", () => {
  const d = repo();
  try {
    register(d, "s6");
    const s = lzy(["loop", "status"], d);
    assert.equal(s.code, 0);
    assert.doesNotMatch(s.out, /可回收存根/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
