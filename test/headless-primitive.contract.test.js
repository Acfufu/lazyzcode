// headless 原语契约测试（0.1.0 棒B，ADR-0017）：argv 字面量形态/--mode 显式必填/墙钟
// 预算守卫/HOME 隔离换绑/--json 摘要解析/失败族恢复式报错/doctor headless 行/E2E 脚本
// 认证门 skip。真 spawn 走 fake-engine 夹具（node .mjs，按 argv 形态回放或退出）——
// CI 零触网零凭据；deps.run 注入轨沿 update.js 先例。
// win32 雷回避：不 split("/")、路径断言用 join、无平台专属调用。
import { test } from "node:test";
// 人权门非本文件被测面（门由 human-gate.contract.test.js 两面钉）——spawn 继承此 env 保采纳畅通
process.env.LZY_ABLATE_HUMAN_GATE = "1";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HeadlessError, HEADLESS_MODES, spawnHeadless } from "../core/headless.js";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const CLI = join(ROOT, "cli", "lzy.js");
const E2E = join(ROOT, "scripts", "headless", "e2e-loop.mjs");
const SUPPRESS_ENGINE = "/nonexistent-lzy-suppressed-engine";
const HOME = mkdtempSync(join(tmpdir(), "lzy-v0110-hl-home-"));

// fake 引擎：回放 argv/env 形态进 --json 摘要；--fail 退 3；--hang 挂起（测墙钟）；
// --garbage 输出非 JSON。
function makeFakeEngine(dir, { fail = false, hang = false, garbage = false } = {}) {
  const p = join(dir, `fake-engine-${fail ? "f" : hang ? "h" : garbage ? "g" : "ok"}.mjs`);
  const tail = hang
    ? `setInterval(() => {}, 1000);`
    : garbage
      ? `process.stdout.write("NOT-JSON-AT-ALL");`
      : `const payload = {
  sessionId: "sess_fake",
  response: JSON.stringify({ argv: process.argv.slice(2), home: process.env.HOME, userProfile: process.env.USERPROFILE, extra: process.env.LZY_FAKE_MARKER ?? null }),
  usage: { modelRequestCount: 1, inputTokens: 12 },
  projection: { status: "complete", turnCount: 1 },
};
process.stdout.write(JSON.stringify(payload));
process.exit(${fail ? 3 : 0});`;
  writeFileSync(p, tail);
  return p;
}

// ── 参数契约（同步校验，deps 不触）───────────────────────────────────────────
test("mode 显式必填不设默认：缺席/非法值拒；合法值集合钉死", async () => {
  await assert.rejects(async () => spawnHeadless({ prompt: "p", mode: undefined, enginePath: "/x", deps: { run: () => ({ exitCode: 0, stdout: "{}" }) } }), HeadlessError);
  await assert.rejects(async () => spawnHeadless({ prompt: "p", mode: "YOLO", enginePath: "/x", deps: { run: () => ({ exitCode: 0, stdout: "{}" }) } }), /显式必填/);
  assert.deepEqual([...HEADLESS_MODES].sort(), ["build", "edit", "plan", "yolo"]);
});

test("墙钟预算守卫：0/null/负数/非整数拒（b1 事故教训：无预算=无限挂起）；缺席=走 15min 缺省（deps.run 注入轨已钉 timeoutMs 值）", () => {
  for (const bad of [0, null, -1, 1.5, "5000"]) {
    assert.throws(
      () => spawnHeadless({ prompt: "p", mode: "yolo", timeoutMs: bad, enginePath: "/x", deps: { run: () => ({ exitCode: 0, stdout: "{}" }) } }),
      /墙钟预算非法/,
    );
  }
});

test("deps.run 注入：argv 字面量序（--resume 前置/--prompt/--json/--mode）、home 换绑、extraEnv 透传", async () => {
  let seen = null;
  const run = (x) => {
    seen = x;
    return { exitCode: 0, stdout: "{}", stderr: "" };
  };
  const res = await spawnHeadless({
    prompt: "一句话",
    resume: "sess_r1",
    mode: "build",
    cwd: "/tmp/anywhere",
    home: "/iso/home",
    extraEnv: { LZY_FAKE_MARKER: "m1" },
    enginePath: "/fake/engine.cjs",
    deps: { run },
  });
  assert.ok(seen, "deps.run 被调用");
  assert.deepEqual(seen.argv, ["/fake/engine.cjs", "--resume", "sess_r1", "--prompt", "一句话", "--json", "--mode", "build"]);
  assert.equal(seen.env.HOME, "/iso/home");
  assert.equal(seen.env.USERPROFILE, "/iso/home");
  assert.equal(seen.env.LZY_FAKE_MARKER, "m1");
  assert.equal(seen.timeoutMs, 15 * 60_000, "缺省墙钟=15min");
  assert.equal(res.ok, true, "空对象 {} 也是合法 JSON 摘要（字段缺省=null）");
  assert.equal(res.sessionId, null);
});

test("缺 prompt 拒；引擎缺席（LZY_ZCODE_ENGINE 指向不存在）拒", async () => {
  await assert.rejects(async () => spawnHeadless({ prompt: "  ", mode: "yolo", enginePath: "/x", deps: { run: () => ({ exitCode: 0, stdout: "{}" }) } }), /缺 prompt/);
  const saved = process.env.LZY_ZCODE_ENGINE;
  process.env.LZY_ZCODE_ENGINE = SUPPRESS_ENGINE;
  try {
    await assert.rejects(async () => spawnHeadless({ prompt: "p", mode: "yolo" }), /引擎未找到/);
  } finally {
    if (saved === undefined) delete process.env.LZY_ZCODE_ENGINE;
    else process.env.LZY_ZCODE_ENGINE = saved;
  }
});

// ── 真 spawn（fake 引擎实弹）────────────────────────────────────────────────
test("真 spawn happy path：--json 摘要解析出 sessionId/usage/projection；shell 元字符原样到达（shell:false 证据）", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lzy-v0110-hl-"));
  try {
    const engine = makeFakeEngine(dir);
    const tricky = "a;b & c | d $HOME `x`";
    const res = await spawnHeadless({ prompt: tricky, mode: "yolo", timeoutMs: 20_000, enginePath: engine, cwd: dir });
    assert.equal(res.ok, true, res.error ?? "");
    assert.equal(res.sessionId, "sess_fake");
    assert.equal(res.usage.modelRequestCount, 1);
    assert.equal(res.projection.turnCount, 1);
    const inner = JSON.parse(res.response);
    assert.equal(inner.argv[0], "--prompt", "argv 从引擎视角逐字回放");
    assert.equal(inner.argv[1], tricky, "shell 元字符未拆未展（字面量 argv+shell:false）");
    assert.equal(inner.argv.includes("--json"), true);
    assert.equal(inner.argv[inner.argv.indexOf("--mode") + 1], "yolo");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("真 spawn home 隔离：子进程 HOME/USERPROFILE 换绑；认证 env 随 env 透传", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lzy-v0110-hl-"));
  try {
    const engine = makeFakeEngine(dir);
    const iso = mkdtempSync(join(tmpdir(), "lzy-v0110-hl-iso-"));
    const res = await spawnHeadless({ prompt: "p", mode: "edit", timeoutMs: 20_000, enginePath: engine, cwd: dir, home: iso, extraEnv: { LZY_FAKE_MARKER: "auth" } });
    const inner = JSON.parse(res.response);
    assert.equal(inner.home, iso);
    assert.equal(inner.userProfile, iso, "win32 面同换（USERPROFILE 双补）");
    assert.equal(inner.extra, "auth", "ZCODE_*_PROVIDER_CONFIG_FILE 形态的 env 透传通道在");
    rmSync(iso, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("失败族：非零退出带 stderr 尾部；超时 SIGKILL 带 wall-clock 文案；非 JSON 带 --json 指路", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lzy-v0110-hl-"));
  try {
    const failEngine = makeFakeEngine(dir, { fail: true });
    const r1 = await spawnHeadless({ prompt: "p", mode: "plan", timeoutMs: 20_000, enginePath: failEngine, cwd: dir });
    assert.equal(r1.ok, false);
    assert.match(r1.error, /非零退出（exit 3）/);
    assert.match(r1.error, /stderr 尾部/);

    const hangEngine = makeFakeEngine(dir, { hang: true });
    const t0 = Date.now();
    const r2 = await spawnHeadless({ prompt: "p", mode: "yolo", timeoutMs: 600, enginePath: hangEngine, cwd: dir });
    assert.equal(r2.ok, false);
    assert.equal(r2.timedOut, true);
    assert.match(r2.error, /墙钟预算 1s 耗尽/);
    assert.ok(Date.now() - t0 < 5_000, "超时即杀不拖满");

    const garbage = makeFakeEngine(dir, { garbage: true });
    const r3 = await spawnHeadless({ prompt: "p", mode: "yolo", timeoutMs: 20_000, enginePath: garbage, cwd: dir });
    assert.equal(r3.ok, false);
    assert.match(r3.error, /--json 摘要解析失败/);

    // spawn 失败族（ADJ-52，0.2.1 五轮双审：error 双监听合并为单监听后本族须照旧）：
    // cwd 不存在 → spawn 事件 error（无 exit 可等）→ error 回调记因 + 50ms 短窗补结算，
    // Promise 永不挂且报文点名启动失败。
    const okEngine = makeFakeEngine(dir, {});
    const t1 = Date.now();
    const r4 = await spawnHeadless({
      prompt: "p",
      mode: "plan",
      timeoutMs: 20_000,
      enginePath: okEngine,
      cwd: join(dir, "no-such-cwd"),
    });
    assert.equal(r4.ok, false);
    assert.match(r4.error, /引擎进程启动失败/);
    assert.ok(Date.now() - t1 < 5_000, "spawn 失败即结算（50ms 兜底语义不破），不挂到墙钟");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── doctor headless 行 + E2E 认证门 ─────────────────────────────────────────
test("doctor headless 行：引擎缺席=skip；行恒在（ok/warn 态按机器如实；退出码不断言——status install/files 依环境有 fail 级）", async () => {
  const d = mkdtempSync(join(tmpdir(), "lzy-v0110-hl-"));
  try {
    const r = spawnSync(process.execPath, [CLI, "doctor"], {
      cwd: d,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE },
    });
    assert.match(r.stdout, /headless.*引擎缺席.*skip|➖ headless.*引擎缺席/, "引擎缺席时 headless 行 skip 态");
    // 无抑制（本机真引擎）：行在即可，状态按机器（ok=有凭据 / warn=无凭据 / skip=无引擎）
    const r2 = spawnSync(process.execPath, [CLI, "doctor"], {
      cwd: d,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: "" },
    });
    assert.match(r2.stdout, /headless/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("E2E 脚本认证门：无凭据环境（隔离 HOME + 清空认证 env）=SKIP exit 0，不触引擎", () => {
  const env = { ...process.env, HOME, USERPROFILE: HOME };
  delete env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE;
  delete env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
  const r = spawnSync(process.execPath, [E2E], { encoding: "utf8", timeout: 60_000, env });
  assert.equal(r.status, 0, `SKIP 语义 exit 0：${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /SKIP.*凭据/);
  assert.match(r.stdout, /CI 不碰/);
});

test("E2E 脚本 --mode 非法拒（参数面前置，不触引擎）", () => {
  const env = { ...process.env, HOME, USERPROFILE: HOME, LZY_ZCODE_ENGINE: SUPPRESS_ENGINE };
  const r = spawnSync(process.execPath, [E2E, "--mode", "bogus"], { encoding: "utf8", timeout: 30_000, env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--mode 非法/);
});
