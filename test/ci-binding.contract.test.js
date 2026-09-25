// CI 身份绑定（0.3.0 M2）契约：回执形状/全绿判读/非 success 判读/远端无此提交（如实无 CI
// 结果）/gh 缺席 blocked 面/非现行对照（记录 sha≠现行 HEAD）/origin 非 GitHub 拒。
// gh 依赖经 LZY_GH_BIN 注入缝直指假可执行（镜像 LZY_ZCODE_ENGINE 家法；unix shebang 脚本）——
// 不动 PATH（空 PATH 会连 git 一起饿死）。win32 的执行语义未核——win32 跳过该组并如实注记
//（计划 Known unknowns 3：CI 矩阵轮真值补核，本地只钉机制语义）。blocked 面指不存在路径，跨平台成立。
import { test } from "node:test";
process.env.LZY_ABLATE_HUMAN_GATE = "1"; // 人权门非本文件被测面
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listReceipts } from "../core/verify.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const HOME = mkdtempSync(join(tmpdir(), "lzy-ci-home-"));
const itNotWin = process.platform === "win32" ? test.skip : test;

function lzyIn(d, args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: d,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "/nonexistent-lzy-suppressed", LZY_ABLATE_HUMAN_GATE: "1", ...env },
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function fakeGh(binDir, { checks = null, fail = null } = {}) {
  mkdirSync(binDir, { recursive: true });
  const body = fail
    ? `process.stderr.write(${JSON.stringify(fail)});\nprocess.exit(1);\n`
    : `process.stdout.write(JSON.stringify(${JSON.stringify(checks ?? [])}));\n`;
  const p = join(binDir, "gh");
  writeFileSync(p, `#!/usr/bin/env node\n${body}`);
  chmodSync(p, 0o755);
  return p;
}

function repo(prefix, { origin = "https://github.com/Acfufu/lazyzcode.git" } = {}) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "seed\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  if (origin) g(["remote", "add", "origin", origin]);
  lzyIn(d, ["loop", "register", "ci", "--title", "t"]);
  writeFileSync(join(d, "p.md"), "- [N1] x\n");
  const plan = lzyIn(d, ["loop", "plan", "p.md"]);
  if (plan.status !== 0) throw new Error(`plan 失败：${plan.out}`);
  lzyIn(d, ["loop", "start"]);
  return d;
}

const headSha = (d) =>
  (spawnSync("git", ["-C", d, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout ?? "").trim();

const CI_CHECKS = [
  { name: "test (22, ubuntu-latest)", conclusion: "success", details_url: "https://ci/a" },
  { name: "test (24, windows-latest)", conclusion: "success", details_url: "https://ci/b" },
];

itNotWin("全绿判读：回执 kind=ci 绑 {repo, sha, checks}，记录 sha=现行 HEAD", () => {
  const bin = mkdtempSync(join(tmpdir(), "lzy-ci-bin1-"));
  const ghPath = fakeGh(bin, { checks: CI_CHECKS });
  const d = repo("lzy-ci-ok-");
  try {
    const r = lzyIn(d, ["verify", "ci"], { LZY_GH_BIN: ghPath });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /CI 检查 · Acfufu\/lazyzcode@/);
    assert.match(r.out, /全绿（绑定该提交身份）/);
    assert.match(r.out, /记录 sha=现行 HEAD（现行）/);
    const rc = listReceipts(d).find((x) => x.kind === "ci");
    assert.equal(rc.ci.repo, "Acfufu/lazyzcode");
    assert.equal(rc.ci.sha, headSha(d));
    assert.equal(rc.ci.checks.length, 2);
    assert.equal(rc.exit.ci, "recorded");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

itNotWin("非 success 判读：非零退出+点名结论", () => {
  const bin = mkdtempSync(join(tmpdir(), "lzy-ci-bin2-"));
  const ghPath = fakeGh(bin, { checks: [{ name: "test", conclusion: "failure", details_url: "https://ci/x" }] });
  const d = repo("lzy-ci-fail-");
  try {
    const r = lzyIn(d, ["verify", "ci"], { LZY_GH_BIN: ghPath });
    assert.equal(r.status, 1);
    assert.match(r.out, /存在非 success 结论/);
    assert.match(r.out, /failure/);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

itNotWin("远端无此提交：如实「无 CI 结果」，不冒充现行绿", () => {
  const bin = mkdtempSync(join(tmpdir(), "lzy-ci-bin3-"));
  const ghPath = fakeGh(bin, { fail: "HTTP 404: No commit found on the remote\n" });
  const d = repo("lzy-ci-404-");
  try {
    const r = lzyIn(d, ["verify", "ci"], { LZY_GH_BIN: ghPath });
    assert.equal(r.status, 1);
    assert.match(r.out, /无 CI 结果/);
    assert.match(r.out, /未推送或历史已改写/);
    const rc = listReceipts(d).find((x) => x.kind === "ci");
    assert.equal(rc.exit.noRemoteCommit, true, "blocked 形态如实落账");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

test("gh 缺席：blocked 原文+恢复指路+非零退出（跨平台成立）", () => {
  const d = repo("lzy-ci-blocked-");
  try {
    const r = lzyIn(d, ["verify", "ci"], { LZY_GH_BIN: "/nonexistent-lzy-gh" });
    assert.equal(r.status, 1);
    assert.match(r.out, /gh CLI 缺席/);
    assert.match(r.out, /cli\.github\.com/);
    const rc = listReceipts(d).find((x) => x.kind === "ci");
    assert.match(rc.exit.blocked, /缺席/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

itNotWin("非现行对照：候选前进后记录 sha≠现行 HEAD，读面如实标注", () => {
  const bin = mkdtempSync(join(tmpdir(), "lzy-ci-bin4-"));
  const ghPath = fakeGh(bin, { checks: CI_CHECKS });
  const d = repo("lzy-ci-stale-");
  try {
    const first = lzyIn(d, ["verify", "ci"], { LZY_GH_BIN: ghPath });
    assert.equal(first.status, 0, first.out);
    // 候选前进（新提交）→ 此前记录的 sha 不再是现行 HEAD
    writeFileSync(join(d, "b.txt"), "b\n");
    spawnSync("git", ["-C", d, "-c", "user.email=t@l", "-c", "user.name=t", "add", "b.txt"], { encoding: "utf8" });
    spawnSync("git", ["-C", d, "-c", "user.email=t@l", "-c", "user.name=t", "commit", "-qm", "next"], { encoding: "utf8" });
    const rc = listReceipts(d).find((x) => x.kind === "ci");
    const show = lzyIn(d, ["verify", "show", rc.runId]);
    assert.match(show.out, /非现行/, `show 读面须标注非现行：${show.out.slice(-200)}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

test("origin 非 GitHub：拒并指路 --repo（不猜）", () => {
  const d = repo("lzy-ci-origin-", { origin: "https://gitlab.com/x/y.git" });
  try {
    const r = lzyIn(d, ["verify", "ci"]);
    assert.equal(r.status, 1);
    assert.match(r.out, /--repo/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
