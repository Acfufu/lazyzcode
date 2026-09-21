// 消融管线 spawn 语义契约（0.2.2 棒1#N10）：scripts/ablation/spawn-engine.mjs 对齐
// core/headless.js 的 ADJ-38 语义——墙钟是真硬顶、且 durationMs 回报使「预算到点却拖很久」
// 可被量到（旧实现既不 destroy 管道也不回报耗时，ADJ-38 在核心侧修完，这条路径却原样留着，
// 而棒2 的 24 trials 全跑在它上面）。
//
// 断言面：假引擎派生一个**继承 stdio 的孙进程**再挂死——SIGKILL 只及直接子进程，孙进程
// 持有管道会把 close 拖到墙钟之外。修复后应在 timeout+ε 内返回；若语义回退，本用例在孙
// 进程自尽（15s）后才通过 close 结算，断言随即失败。
// 单独成文件而不并入 test/ablation-pipeline.contract.test.js：后者文件头明示「引擎面不在
// 本文件伪造」，把引擎替身塞进去会破它自己的范围声明。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnEngine } from "../scripts/ablation/spawn-engine.mjs";

const HOME = mkdtempSync(join(tmpdir(), "lzy-abspawn-home-"));

/** 造一个假引擎：node 直跑它（spawn-engine 的 argv[0]=引擎路径）。 */
function fakeEngine(body) {
  const d = mkdtempSync(join(tmpdir(), "lzy-abspawn-eng-"));
  const p = join(d, "fake-engine.mjs");
  writeFileSync(p, body);
  return p;
}

const ENGINE_HANGS_WITH_PIPE_HOLDING_GRANDCHILD = `
console.log(JSON.stringify({ sessionId: "fake", note: "starting" }));
// 孙进程继承 stdio → 持有本进程的 stdout/stderr 管道；15s 后自尽，免得测试跑飞。
const { spawn } = await import("node:child_process");
spawn(process.execPath, ["-e", "setTimeout(()=>{},15000)"], { stdio: "inherit" });
setInterval(() => {}, 1000);
`;

const ENGINE_EXITS_OK = `
console.log(JSON.stringify({ sessionId: "fake-ok", summary: "done" }));
process.exit(0);
`;

test("N10 · 假引擎正常退出：回报 durationMs 且判 ok", async () => {
  const engine = fakeEngine(ENGINE_EXITS_OK);
  const r = await spawnEngine({
    prompt: "t",
    cwd: HOME,
    home: HOME,
    mode: "yolo",
    timeoutMs: 10_000,
    engine,
  });
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  assert.ok(typeof r.durationMs === "number" && r.durationMs >= 0, "必须回报 durationMs");
  assert.match(r.stdout, /fake-ok/, "stdout 照常回收");
  assert.equal(r.timedOut, false);
});

test("N10 · 孙进程持管道也不拖过墙钟：durationMs ≈ 预算 + ε，不是预算的若干倍", async () => {
  const engine = fakeEngine(ENGINE_HANGS_WITH_PIPE_HOLDING_GRANDCHILD);
  const budget = 1_000;
  const r = await spawnEngine({
    prompt: "t",
    cwd: HOME,
    home: HOME,
    mode: "yolo",
    timeoutMs: budget,
    engine,
  });
  assert.equal(r.timedOut, true, "应判超时");
  assert.equal(r.signal, "SIGKILL");
  assert.equal(r.killed, true);
  // ADJ-38 修复前实测 25×（25,042ms / 1000ms）。这里给足余量：只要没被拖到孙进程的
  // 15s 自尽之后就算过——真正的判据是「与预算同量级」，不是某个精确毫秒数。
  assert.ok(
    r.durationMs < 5_000,
    `墙钟必须是硬顶：预算 ${budget}ms 实测 ${r.durationMs}ms（孙进程持管道把 close 拖住了）`,
  );
});
