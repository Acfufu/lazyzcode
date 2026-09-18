// 提交账本契约测试（ADR-0005）：真实 git 夹具驱动 checkLedger 的四分支与 fail-soft 纪律。
import { test } from "node:test";
// 人权门非本文件被测面（门由 human-gate.contract.test.js 两面钉）——spawn 继承此 env 保采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const GIT = ["-c", "user.email=t@t.test", "-c", "user.name=t"];

function scratch() {
  return mkdtempSync(join(tmpdir(), "lzy-ledger-"));
}

function git(cwd, args) {
  const r = spawnSync("git", [...GIT, ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
}

function goalAt(dir, createdAt, status = "executing") {
  mkdirSync(join(dir, ".lazyzcode", "loop"), { recursive: true });
  writeFileSync(
    join(dir, ".lazyzcode", "loop", "goal.json"),
    JSON.stringify({ version: 1, slug: "t", status, createdAt }),
  );
}

function commit(dir, message) {
  writeFileSync(join(dir, `f${Math.random().toString(36).slice(2)}.txt`), "x\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", message]);
}

async function run(cwd) {
  const { checkLedger } = await import(pathToFileURL(join(ROOT, "core", "doctor.js")).href);
  const rows = [];
  checkLedger((name, state, detail) => rows.push({ name, state, detail }), cwd);
  return rows;
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test("ledger：goal 在场且提交全带 Goal 尾注 → ok X/X", async () => {
  const d = scratch();
  try {
    git(d, ["init"]);
    goalAt(d, new Date(Date.now() - 60_000).toISOString());
    commit(d, "feat: a\n\nGoal: t#N1");
    commit(d, "fix: b\n\nGoal: t#N2");
    const rows = await run(d);
    const row = rows.find((r) => r.name === "ledger");
    assert.equal(row.state, "ok");
    assert.match(row.detail, /2\/2/);
  } finally {
    cleanup(d);
  }
});

test("ledger：有提交缺尾注 → warn（不翻退出码的 fail 级不存在）", async () => {
  const d = scratch();
  try {
    git(d, ["init"]);
    goalAt(d, new Date(Date.now() - 60_000).toISOString());
    commit(d, "feat: a\n\nGoal: t#N1");
    commit(d, "fix: b");
    const rows = await run(d);
    const row = rows.find((r) => r.name === "ledger");
    assert.equal(row.state, "warn");
    assert.match(row.detail, /1 条缺/);
    assert.notEqual(row.state, "fail");
  } finally {
    cleanup(d);
  }
});

test("ledger：无 goal / 起点(未来)后无提交 / 非 git 目录 → 三种 skip", async () => {
  const noGoal = scratch();
  const noCommits = scratch();
  const nonGit = scratch();
  try {
    goalAt(noGoal, new Date().toISOString());
    git(noCommits, ["init"]);
    goalAt(noCommits, new Date(Date.now() + 3_600_000).toISOString()); // 未来起点 → 零提交
    goalAt(nonGit, new Date(Date.now() - 60_000).toISOString()); // 非 git 仓：log 失败 → skip
    const a = (await run(noGoal)).find((r) => r.name === "ledger");
    const b = (await run(noCommits)).find((r) => r.name === "ledger");
    const c = (await run(nonGit)).find((r) => r.name === "ledger");
    assert.equal(a.state, "skip");
    assert.equal(b.state, "skip");
    assert.equal(c.state, "skip");
  } finally {
    cleanup(noGoal, noCommits, nonGit);
  }
});
