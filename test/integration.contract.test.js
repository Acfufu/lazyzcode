// 整合验证（0.3.0 M2，主方案 §4.3）契约：波末屏障对合并候选树经受控执行器跑 check 清单
// ——全绿不阻塞且回执落账；失败 windDownW(false) 阻塞交付 A（分支/worktree 不清理）；
// 清单在场时账本零新绿（重锚退役——回执与红绿账本分权）；零 pending+过期证据 ⇒ finish
// 拒（诚实路径，无重锚相救）。
// 家法沿 drive-workers.contract.test.js：deps.run 假引擎（CI 零触网）、HOME 隔离+引擎抑制、
// env-auth 显式注入、win32 雷回避。整合检查配方=process.execPath -e（跨平台真执行）。
import { test } from "node:test";
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDrive } from "../core/drive.js";
import { listReceipts } from "../core/verify.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const HOME = mkdtempSync(join(tmpdir(), "lzy-ig-home-"));
process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = (() => {
  const p = join(HOME, "provider-env-ok.json");
  writeFileSync(p, "{}\n");
  return p;
})();

function lzyIn(d, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: d,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "/nonexistent-lzy-suppressed", LZY_ABLATE_HUMAN_GATE: "1" },
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const goalJson = (d) => join(d, ".lazyzcode", "loop", "goal.json");
const siblingRoot = (d) => join(dirname(d), basename(d) + "-fast");

function repo(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@l"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "seed\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  lzyIn(d, ["loop", "register", "ig", "--title", "t"]);
  writeFileSync(join(d, "p.md"), ["- [N1] x", "- [N2] y", "- [F1] f"].join("\n") + "\n");
  const plan = lzyIn(d, ["loop", "plan", "p.md"]);
  if (plan.status !== 0) throw new Error(`plan 失败：${plan.out}`);
  lzyIn(d, ["loop", "start"]);
  return d;
}

function captureStdout(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  return Promise.resolve(fn()).finally(() => {
    console.log = orig;
  }).then((r) => ({ result: r, lines: lines.join("\n") }));
}

const passDeps = (run) => ({
  enginePath: "/fake/engine.cjs",
  detectAuth: () => ({ oauth: false, envAuth: true, ok: true }),
  run: run ?? (() => ({ exitCode: 0, stdout: "{}", stderr: "" })),
  querySessionPoints: () => ({ absent: false, unpriced: [], points: 0 }),
  cliPath: CLI,
});

function fakeWorker({ mutate = null } = {}) {
  return ({ argv, cwd }) => {
    const prompt = String(argv.includes("--prompt") ? argv[argv.indexOf("--prompt") + 1] : "");
    const wid = /工人 w(\d+)/.exec(prompt)?.[1] ?? "?";
    if (mutate) mutate(cwd, wid);
    return { exitCode: 0, stdout: `${JSON.stringify({ sessionId: `sess-w${wid}`, status: "idle" })}`, stderr: "" };
  };
}

function fakeAddFile(tag) {
  return (cwd) => {
    writeFileSync(join(cwd, `w${tag}.txt`), `${tag}\n`);
    spawnSync("git", ["-C", cwd, "-c", "user.email=t@l", "-c", "user.name=t", "add", `w${tag}.txt`], { encoding: "utf8" });
    spawnSync("git", ["-C", cwd, "-c", "user.email=t@l", "-c", "user.name=t", "commit", "-qm", `w${tag}`], { encoding: "utf8" });
  };
}

const manifestWith = (id, code) =>
  JSON.stringify(
    { schemaVersion: 1, capabilities: { check: [{ id, argv: [process.execPath, "-e", `process.exit(${code})`], timeoutMs: 30_000 }] } },
    null,
    2,
  );

test("屏障整合检查：清单在场→真执行+回执落账+账本零新绿（重锚退役）", async () => {
  const d = repo("lzy-ig-ok-");
  writeFileSync(join(d, "lzy.project.json"), manifestWith("int-ok", 0));
  try {
    const { result, lines } = await captureStdout(() =>
      runDrive(d, { workers: 2, maxSegments: 1 }, passDeps(fakeWorker({ mutate: fakeAddFile("1") }))),
    );
    assert.match(lines, /整合检查 int-ok → exit 0（回执 r-/, "屏障真执行并点名回执");
    const receipts = listReceipts(d).filter((r) => r.checkId === "int-ok");
    assert.equal(receipts.length, 1, "整合回执恰一条");
    assert.equal(receipts[0].exit.code, 0);
    assert.ok(!/wave-barrier rebind/.test(lines), "零重锚行（退役面）");
    const dag = JSON.parse(readFileSync(join(d, ".lazyzcode", "loop", "dag.json"), "utf8"));
    assert.equal(dag.nodes.filter((n) => n.kind === "evidence" && n.half === "green").length, 0, "屏障零新绿（账本零改写）");
    assert.equal(result.ok, true, `整合全绿不阻塞：${result.cause}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});

test("整合失败：windDownW(false) 阻塞交付 A（真因+分支保留+失败回执在案）", async () => {
  const d = repo("lzy-ig-fail-");
  writeFileSync(join(d, "lzy.project.json"), manifestWith("int-fail", 3));
  try {
    const { result, lines } = await captureStdout(() =>
      runDrive(d, { workers: 2, maxSegments: 2 }, passDeps(fakeWorker({ mutate: fakeAddFile("1") }))),
    );
    assert.equal(result.ok, false, "整合失败=非干净收束");
    assert.match(result.cause, /整合验证失败（int-fail，exit=\{"code":3\}/, `实得 ${result.cause}`);
    assert.match(lines, /整合候选不交付|两工人各自通过 ≠ 整合成功/);
    const receipts = listReceipts(d).filter((r) => r.checkId === "int-fail");
    assert.equal(receipts.length, 1, "失败回执在案（可 show 追因）");
    assert.equal(receipts[0].exit.code, 3);
    const branches = spawnSync("git", ["-C", d, "branch", "--format", "%(refname:short)"], { encoding: "utf8" }).stdout ?? "";
    assert.match(branches, /-w1/, "!ok 不清理（工人分支保留）");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});

test("零 pending+过期证据 ⇒ finish 拒（诚实路径，无重锚相救）", async () => {
  const d = repo("lzy-ig-stalefinish-");
  try {
    const done = lzyIn(d, ["step", "done", "N1", "--note", "probe"]);
    assert.equal(done.status, 0, done.out);
    const f1 = lzyIn(d, ["step", "done", "F1", "--evidence", "初版取证（夹具）"]);
    assert.equal(f1.status, 0, f1.out);
    // 取证后提交新文件→F1 证据过期；N2 仍 pending→先收口 N2，全部 done 后进波
    writeFileSync(join(d, "post.txt"), "post\n");
    spawnSync("git", ["-C", d, "-c", "user.email=t@l", "-c", "user.name=t", "add", "post.txt"], { encoding: "utf8" });
    spawnSync("git", ["-C", d, "-c", "user.email=t@l", "-c", "user.name=t", "commit", "-qm", "post"], { encoding: "utf8" });
    const n2 = lzyIn(d, ["step", "done", "N2", "--note", "probe"]);
    assert.equal(n2.status, 0, n2.out);
    const { result, lines } = await captureStdout(() =>
      runDrive(d, { workers: 2, maxSegments: 1 }, passDeps()),
    );
    assert.equal(result.ok, false, `过期证据下 finish 须拒：${result.cause}`);
    assert.match(result.cause, /finish 失败/, `实得 ${result.cause}`);
    const goal = JSON.parse(readFileSync(goalJson(d), "utf8"));
    assert.equal(goal.status, "executing", "目标不被洗成 done");
    assert.ok(!/✔ goal done/.test(lines), "无 done 宣告");
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(siblingRoot(d), { recursive: true, force: true });
  }
});
