// lzy update 契约测试：全 fake 注入不触网（run/readGlobalVersion 注入面）。
// 核心语义断言=ADR-0012：npm 升包成功后必须 spawn 全新子进程跑 sync（child argv 指
// 向 npm root -g 新装路径），绝无进程内 sync 调用。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions, createUpdater } from "../core/update.js";

function makeFakeGlobalRoot(t, { withCli = true, pkgVersion = "0.0.5" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "lzy-update-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkgDir = join(root, "lazyzcode");
  if (pkgVersion !== null) {
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ version: pkgVersion }));
  }
  if (withCli) {
    mkdirSync(join(pkgDir, "cli"), { recursive: true });
    writeFileSync(join(pkgDir, "cli", "lzy.js"), "// fixture\n");
  }
  return root;
}

// 顺序消费的 fake runner：记录每次请求，按脚本逐个回放（缺省=成功空响应）。
function fakeRun(script = []) {
  const calls = [];
  const run = async (req) => {
    calls.push(req);
    return script[calls.length - 1] ?? { status: 0, stdout: "", stderr: "" };
  };
  run.calls = calls;
  return run;
}

const viewReq = { kind: "npm", argv: ["view", "lazyzcode", "version"] };

test("① compareVersions 数值序与非数字段退化（钉死规则：数字段按数值、非数字段字典序、缺段补 0）", (t) => {
  assert.equal(compareVersions("0.0.10", "0.0.9"), 1); // 数值序，非字典序
  assert.equal(compareVersions("0.0.6", "0.0.6"), 0);
  assert.equal(compareVersions("0.0.5", "0.0.6"), -1);
  assert.equal(compareVersions("1.2", "1.2.0"), 0); // 缺段补 0
  // ADJ-91（0.2.1）：-prerelease/+build 段先剥离再比——旧实现拿 "0.0.7-beta" 的末段与
  // "0.0.7" 末段走字典序（"7-beta" > "7"）判出「本地高于已发布」的误导方向警告。
  assert.equal(compareVersions("0.0.7-beta", "0.0.7"), 0); // 预发布不高于同号正式版
  assert.equal(compareVersions("0.0.10-beta", "0.0.9"), 1); // 剥离后数值序（旧实现字典序判 -1）
  assert.equal(compareVersions("0.0.10+build.5", "0.0.10"), 0); // build 段同样剥离
});

test("② 全局==published → 已是最新，install 与 child 均不触发，exit 0", async (t) => {
  const root = makeFakeGlobalRoot(t, { pkgVersion: "0.0.6" });
  const run = fakeRun([
    { status: 0, stdout: "0.0.6\n", stderr: "" }, // npm view
    { status: 0, stdout: `${root}\n`, stderr: "" }, // npm root -g
  ]);
  const r = await createUpdater({ run, readGlobalVersion: () => "0.0.6" }).update();
  assert.equal(r.code, 0);
  assert.equal(r.action, "up-to-date");
  assert.ok(r.lines.join("\n").includes("已是最新"));
  assert.equal(run.calls.length, 2); // view + root，无 install、无 child
  assert.deepEqual(run.calls[0].argv, viewReq.argv);
});

test("③ 全局旧 → 全链次序 view→root→install→child，child 由默认 readGlobalVersion 配合触发", async (t) => {
  const root = makeFakeGlobalRoot(t, { pkgVersion: "0.0.5" }); // 默认 readGlobalVersion 读 fixture
  const run = fakeRun([
    { status: 0, stdout: "0.0.6\n", stderr: "" },
    { status: 0, stdout: `${root}\n`, stderr: "" },
    { status: 0, stdout: "", stderr: "" }, // npm install
  ]);
  const r = await createUpdater({ run }).update();
  assert.equal(r.code, 0);
  assert.equal(r.action, "updated");
  assert.deepEqual(
    run.calls.map((c) => c.kind),
    ["npm", "npm", "npm", "node"],
  );
  assert.deepEqual(run.calls[2].argv, ["install", "-g", "lazyzcode@latest"]);
  assert.deepEqual(run.calls[3].argv, ["sync"]);
});

test("④ ADR-0012 核心断言：child argv=[process.execPath, <新根>/lazyzcode/cli/lzy.js, \"sync\"]", async (t) => {
  const root = makeFakeGlobalRoot(t, { pkgVersion: "0.0.5" });
  const run = fakeRun([
    { status: 0, stdout: "0.0.6\n", stderr: "" },
    { status: 0, stdout: `${root}\n`, stderr: "" },
    { status: 0, stdout: "", stderr: "" },
  ]);
  await createUpdater({ run, readGlobalVersion: () => "0.0.5" }).update();
  const child = run.calls.find((c) => c.kind === "node");
  assert.ok(child, "必须存在 child spawn 请求");
  assert.equal(child.file, join(root, "lazyzcode", "cli", "lzy.js"));
  assert.deepEqual(child.argv, ["sync"]);
  assert.equal(run.calls.filter((c) => c.kind === "npm").length, 3); // view/root/install
});

test("⑤ npm ENOENT → 恢复式文案含手动两步，exit 1，无后续调用", async (t) => {
  const run = fakeRun([{ status: null, error: { code: "ENOENT", message: "spawn npm ENOENT" } }]);
  const r = await createUpdater({ run, readGlobalVersion: () => null }).update();
  assert.equal(r.code, 1);
  const text = r.lines.join("\n");
  assert.ok(text.includes("npm 未找到"));
  assert.ok(text.includes("npm install -g lazyzcode@latest"));
  assert.ok(text.includes("lzy sync"));
  assert.equal(run.calls.length, 1);
});

test("⑥ install 失败 → stderr 原文透传，exit 1，无 child（无中间态：什么都没换掉）", async (t) => {
  const root = makeFakeGlobalRoot(t, { pkgVersion: "0.0.5" });
  const run = fakeRun([
    { status: 0, stdout: "0.0.6\n", stderr: "" },
    { status: 0, stdout: `${root}\n`, stderr: "" },
    { status: 1, stdout: "", stderr: "npm ERR! code EACCES\nnpm ERR! syscall mkdir" },
  ]);
  const r = await createUpdater({ run, readGlobalVersion: () => "0.0.5" }).update();
  assert.equal(r.code, 1);
  const text = r.lines.join("\n");
  assert.ok(text.includes("npm ERR! code EACCES"));
  assert.ok(!run.calls.some((c) => c.kind === "node"));
});

test("⑦ child sync 失败 → 中间态文案（npm 已升 X→Y、sync 未跑、手动 lzy sync），exit 1", async (t) => {
  const root = makeFakeGlobalRoot(t, { pkgVersion: "0.0.5" });
  const run = fakeRun([
    { status: 0, stdout: "0.0.6\n", stderr: "" },
    { status: 0, stdout: `${root}\n`, stderr: "" },
    { status: 0, stdout: "", stderr: "" },
    { status: 1, stdout: "", stderr: "[lzy] 同步失败: boom" },
  ]);
  const r = await createUpdater({ run, readGlobalVersion: () => "0.0.5" }).update();
  assert.equal(r.code, 1);
  assert.equal(r.action, "midstate");
  const text = r.lines.join("\n");
  assert.ok(text.includes("0.0.5"));
  assert.ok(text.includes("0.0.6"));
  assert.ok(text.includes("sync 未跑"));
  assert.ok(text.includes("lzy sync"));
});

test("⑧ 全局包缺席（默认 readGlobalVersion 返 null）→ 视作新装继续全链", async (t) => {
  const root = makeFakeGlobalRoot(t, { pkgVersion: null }); // 无 package.json
  const run = fakeRun([
    { status: 0, stdout: "0.0.6\n", stderr: "" },
    { status: 0, stdout: `${root}\n`, stderr: "" },
    { status: 0, stdout: "", stderr: "" },
  ]);
  const r = await createUpdater({ run }).update();
  assert.equal(r.code, 0);
  assert.equal(r.action, "updated");
  assert.equal(run.calls.length, 4);
});

test("⑨ 本地>published → warn 行在场且继续安装 latest", async (t) => {
  const root = makeFakeGlobalRoot(t, { pkgVersion: "0.0.7" });
  const run = fakeRun([
    { status: 0, stdout: "0.0.6\n", stderr: "" },
    { status: 0, stdout: `${root}\n`, stderr: "" },
    { status: 0, stdout: "", stderr: "" },
  ]);
  const r = await createUpdater({ run, readGlobalVersion: () => "0.0.7" }).update();
  assert.equal(r.code, 0);
  assert.ok(r.lines.join("\n").includes("高于"));
  assert.ok(run.calls.some((c) => c.kind === "npm" && c.argv[0] === "install"));
});

test("⑩ npm view 非零（npm 在而网络/registry 败）→ 无法探测文案+stderr 原文+本地未动，exit 1", async (t) => {
  const run = fakeRun([{ status: 1, stdout: "", stderr: "npm ERR! network request failed" }]);
  const r = await createUpdater({ run, readGlobalVersion: () => "0.0.6" }).update();
  assert.equal(r.code, 1);
  const text = r.lines.join("\n");
  assert.ok(text.includes("无法探测已发布版本"));
  assert.ok(text.includes("npm ERR! network request failed"));
  assert.ok(text.includes("本地未做任何改动"));
  assert.equal(run.calls.length, 1); // view 即止，root/install/child 全不触
});
