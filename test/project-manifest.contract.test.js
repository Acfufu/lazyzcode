// 项目清单（0.3.0 M1，主方案 §3.2）契约：schema 拒绝面 + 就绪静态半 + 只读发现。
// 家法：真子进程、HOME 隔离（doctor/engine 面与本模块无关，但保持同款隔离纪律）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = join(ROOT, "cli", "lzy.js");

function scratch() {
  const d = mkdtempSync(join(tmpdir(), "lzy-pj-"));
  const HOME = mkdtempSync(join(tmpdir(), "lzy-pj-home-"));
  const g = (args) => spawnSync("git", args, { cwd: d, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "t@t"]);
  g(["config", "user.name", "t"]);
  writeFileSync(join(d, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["commit", "-qm", "init"]);
  return { d, HOME };
}

function lzy(args, s) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: s.d,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME: s.HOME, USERPROFILE: s.HOME, LZY_ZCODE_ENGINE: "lzy-test-suppress" },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const manifest = (s, obj) => writeFileSync(join(s.d, "lzy.project.json"), JSON.stringify(obj, null, 2));

test("拒绝面：argv 用 shell 串（字符串而非数组）", () => {
  const s = scratch();
  manifest(s, { schemaVersion: 1, capabilities: { check: [{ id: "x", argv: "rm -rf /tmp/x" }] } });
  const r = lzy(["project", "check"], s);
  assert.equal(r.code, 1);
  assert.match(r.out, /argv 须为字符串数组/);
});

test("拒绝面：env 项带值（清单只收变量名）", () => {
  const s = scratch();
  manifest(s, { schemaVersion: 1, capabilities: { check: [{ id: "x", argv: ["a"], env: ["TOKEN=abc"] }] } });
  const r = lzy(["project", "check"], s);
  assert.equal(r.code, 1);
  assert.match(r.out, /env 项带值/);
});

test("拒绝面：writePaths 绝对路径与越界路径", () => {
  const s = scratch();
  manifest(s, { schemaVersion: 1, capabilities: { check: [{ id: "x", argv: ["a"], writePaths: ["/etc"] }] } });
  assert.match(lzy(["project", "check"], s).out, /绝对路径/);
  manifest(s, { schemaVersion: 1, capabilities: { check: [{ id: "x", argv: ["a"], writePaths: ["../esc"] }] } });
  assert.match(lzy(["project", "check"], s).out, /逃逸项目根/);
});

test("拒绝面：重复 id 与未知能力类、坏 schemaVersion", () => {
  const s = scratch();
  manifest(s, { schemaVersion: 1, capabilities: { check: [{ id: "dup", argv: ["a"] }], start: [{ id: "dup", argv: ["b"] }] } });
  assert.match(lzy(["project", "check"], s).out, /id 重复/);
  manifest(s, { schemaVersion: 1, capabilities: { deploy: [{ id: "x", argv: ["a"] }] } });
  assert.match(lzy(["project", "check"], s).out, /能力类不认识/);
  manifest(s, { schemaVersion: 99, capabilities: {} });
  assert.match(lzy(["project", "check"], s).out, /schemaVersion 不识别/);
});

test("就绪静态半：健康清单 check 全 entry-present；缺脚本入口如实报 entry-missing", () => {
  const s = scratch();
  writeFileSync(join(s.d, "tool.mjs"), "console.log(1)\n");
  manifest(s, { schemaVersion: 1, capabilities: { check: [{ id: "unit", argv: ["node", "tool.mjs"] }] } });
  const r = lzy(["project", "check"], s);
  assert.equal(r.code, 0);
  assert.match(r.out, /entry|入口存在|全在|配方 1 条/);
  assert.match(r.out, /sha256/);
  manifest(s, { schemaVersion: 1, capabilities: { check: [{ id: "ghost", argv: [join(s.d, "nope.mjs")] }] } });
  const r2 = lzy(["project", "check"], s);
  assert.equal(r2.code, 0, "就绪是信息面不是门");
  assert.match(r2.out, /缺失/);
});

test("discover：缺席=六类全缺+起草指路；在场=缺项类与缺失入口清单", () => {
  const s = scratch();
  const r0 = lzy(["project", "discover"], s);
  assert.equal(r0.code, 0);
  assert.match(r0.out, /prepare/);
  assert.match(r0.out, /delivery/);
  manifest(s, { schemaVersion: 1, capabilities: { check: [{ id: "ghost", argv: [join(s.d, "nope.mjs")] }] } });
  const r = lzy(["project", "discover"], s);
  assert.equal(r.code, 0);
  assert.match(r.out, /prepare/); // 缺项类
  assert.match(r.out, /ghost/); // 缺失入口
  assert.match(r.out, /受信执行输入/); // 采纳流指路（契约引用哈希经批准）
});

test("契约-配方绑定联动：recipe 哈希取自文件字节（换行差即漂移）", () => {
  const s = scratch();
  writeFileSync(join(s.d, "lzy.project.json"), "v1\n");
  const h = createHash("sha256").update("v1\n").digest("hex").slice(0, 8);
  writeFileSync(join(s.d, "contract.md"), `task: t\nendpoint: A\nscope: .\nrecipe: ${h}\n\n- [A1] x\n`);
  writeFileSync(join(s.d, "plan.md"), "- [F1] x\naccepts: A1\n");
  lzy(["loop", "register", "pj", "--title", "t", "--contract", "contract.md"], s);
  const r = lzy(["loop", "plan", "plan.md"], s);
  assert.equal(r.code, 1); // 人权门（契约批准）先拦——配方一致时不因查 e 拒
  assert.match(r.out, /人权门未过（契约授权/);
  writeFileSync(join(s.d, "lzy.project.json"), "v2\n");
  const r2 = lzy(["loop", "plan", "plan.md"], s);
  assert.equal(r2.code, 1);
});

test("无清单：project check 如实报无清单（skip 语义）", () => {
  const s = scratch();
  const r = lzy(["project", "check"], s);
  assert.equal(r.code, 0);
  assert.match(r.out, /无 lzy\.project\.json/);
});
