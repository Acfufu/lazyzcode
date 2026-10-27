import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawnHeadless } from "../core/headless.js";

const evidenceRoot = resolve(process.env.LZY_LIFECYCLE_EVIDENCE_DIR ?? ".omo/evidence/headless-review-lifecycle");
mkdirSync(evidenceRoot, { recursive: true });
const evidence = mkdtempSync(join(evidenceRoot, "run-"));
writeFileSync(join(evidence, "manifest.json"), JSON.stringify({ pid: process.pid, evidence, test: "headless-review-lifecycle" }, null, 2));
console.log(`lifecycle evidence: ${evidence}`);
const options = { prompt: "offline fixture", mode: "plan", timeoutMs: 3000 };

test("baseEnv replaces inheritance; extraEnv and HOME overlay; default argv remains compatible", async () => {
  process.env.LZY_LIFECYCLE_SENTINEL = "secret";
  const savedNodeOptions = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = "--no-warnings";
  const engine = join(evidence, "environment.cjs");
  writeFileSync(engine, 'console.log(JSON.stringify({response:JSON.stringify({sentinel:process.env.LZY_LIFECYCLE_SENTINEL ?? null,nodeOptions:process.env.NODE_OPTIONS ?? null,home:process.env.HOME,userProfile:process.env.USERPROFILE,extra:process.env.EXTRA,argv:process.argv.slice(2)})}));');
  try {
    const result = await spawnHeadless({ ...options, enginePath: engine, baseEnv: {}, extraEnv: { EXTRA: "allowed" }, home: evidence });
    writeFileSync(join(evidence, "environment-result.json"), JSON.stringify(result, null, 2));
    assert.equal(result.ok, true, result.error);
    const seen = JSON.parse(result.response);
    assert.equal(seen.sentinel, null);
    assert.equal(seen.nodeOptions, null);
    assert.equal(seen.home, evidence);
    assert.equal(seen.userProfile, evidence);
    assert.equal(seen.extra, "allowed");
    assert.deepEqual(seen.argv, ["--prompt", "offline fixture", "--json", "--mode", "plan"]);
    let captured;
    await spawnHeadless({ ...options, enginePath: engine, deps: { run: x => { captured = x; return { exitCode: 0, stdout: "{}" }; } } });
    assert.equal(captured.env.LZY_LIFECYCLE_SENTINEL, "secret");
    assert.equal(captured.launcher, null);
    assert.equal(captured.processTree, false);
    assert.equal(captured.signal, null);
  } finally {
    delete process.env.LZY_LIFECYCLE_SENTINEL;
    if (savedNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = savedNodeOptions;
  }
});

test("launcher runs real executable with prefix arguments and node engine arguments", async () => {
  const wrapper = join(evidence, "launcher.cjs");
  const engine = join(evidence, "wrapped-engine.cjs");
  const marker = join(evidence, "launcher-marker.json");
  writeFileSync(engine, 'console.log(JSON.stringify({response:"wrapped"}));');
  writeFileSync(wrapper, 'const fs=require("node:fs"),cp=require("node:child_process"); fs.writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3))); const r=cp.spawnSync(process.argv[3],process.argv.slice(4),{stdio:"inherit",env:process.env}); process.exit(r.status ?? 1);');
  const result = await spawnHeadless({ ...options, enginePath: engine, launcher: { command: process.execPath, prefixArgs: [wrapper, marker] }, baseEnv: {} });
  writeFileSync(join(evidence, "launcher-result.json"), JSON.stringify(result, null, 2));
  assert.equal(result.ok, true, result.error);
  assert.equal(existsSync(marker), true);
  assert.deepEqual(JSON.parse(readFileSync(marker)), [process.execPath, engine, "--prompt", "offline fixture", "--json", "--mode", "plan"]);
});

for (const ending of ["normal", "timeout", "abort"]) {
  test(`POSIX process group reaps stdio-holding grandchild on ${ending}`, { skip: process.platform === "win32" }, async () => {
    const dir = join(evidence, ending);
    mkdirSync(dir, { recursive: true });
    const writes = join(dir, "writes.txt");
    const ready = join(dir, "ready.txt");
    const grandchild = join(dir, "grandchild.cjs");
    const middle = join(dir, "middle.cjs");
    const engine = join(dir, "engine.cjs");
    rmSync(ready, { force: true });
    writeFileSync(writes, "");
    writeFileSync(grandchild, `const fs=require("node:fs");fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>fs.appendFileSync(${JSON.stringify(writes)},"x"),25);setTimeout(()=>process.exit(0),1800);`);
    writeFileSync(middle, `require("node:child_process").spawn(process.execPath,[${JSON.stringify(grandchild)}],{stdio:"inherit"});`);
    writeFileSync(engine, `const fs=require("node:fs");require("node:child_process").spawn(process.execPath,[${JSON.stringify(middle)}],{stdio:"inherit"});const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(ready)})){clearInterval(t);${ending === "normal" ? 'console.log(JSON.stringify({response:"done"}));process.exit(0);' : 'setInterval(()=>{},1000);'}}},10);`);
    const controller = new AbortController();
    const running = spawnHeadless({ ...options, enginePath: engine, processTree: true, signal: controller.signal, timeoutMs: ending === "timeout" ? 350 : 3000, baseEnv: {} });
    try {
      if (ending === "abort") {
        const until = Date.now() + 2000;
        while (!existsSync(ready) && Date.now() < until) await delay(10);
        assert.equal(existsSync(ready), true);
        controller.abort();
      }
      const result = await running;
      const before = readFileSync(writes, "utf8");
      await delay(200);
      const after = readFileSync(writes, "utf8");
      writeFileSync(join(dir, "result.json"), JSON.stringify({ result, before, after }, null, 2));
      assert.equal(after, before, "descendant must stop writing after completion");
      if (ending === "normal") assert.equal(result.ok, true, result.error);
      if (ending === "timeout") assert.equal(result.timedOut, true);
      if (ending === "abort") { assert.equal(result.aborted, true); assert.equal(result.ok, false); assert.ok(result.durationMs < 1500); }
    } finally {
      if (existsSync(ready)) { try { process.kill(Number(readFileSync(ready)), "SIGKILL"); } catch {} }
    }
  });
}

test("already aborted signal returns without launching engine", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await spawnHeadless({ ...options, enginePath: "/does-not-exist.cjs", signal: controller.signal, processTree: process.platform !== "win32" });
  writeFileSync(join(evidence, "pre-aborted-result.json"), JSON.stringify(result, null, 2));
  assert.equal(result.aborted, true);
  assert.equal(result.ok, false);
  assert.match(result.error, /取消|中止/);
});

test("exit and close dispatch group cleanup only once", { skip: process.platform === "win32" }, async () => {
  const engine = join(evidence, "cleanup-once.cjs");
  writeFileSync(engine, 'console.log(JSON.stringify({response:"done"}));');
  const originalKill = process.kill;
  let calls = 0;
  process.kill = function(pid, signal) {
    if (pid < 0 && signal === "SIGKILL") {
      calls++;
      // Darwin returns EPERM for a zombie-only group. The real OS reproducer
      // lives in scripts/probes/r0-macos-zombie.mjs; this pins event idempotence.
      if (calls > 1) throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
    }
    return originalKill.call(process, pid, signal);
  };
  try {
    const result = await spawnHeadless({ ...options, enginePath: engine, processTree: true, baseEnv: {} });
    await delay(50);
    assert.equal(result.ok, true, result.error);
    assert.equal(calls, 1);
  } finally { process.kill = originalKill; }
});

test("first group cleanup permission failure is still reported", { skip: process.platform === "win32" }, async () => {
  const engine = join(evidence, "cleanup-denied.cjs");
  writeFileSync(engine, 'console.log(JSON.stringify({response:"done"}));');
  const originalKill = process.kill;
  process.kill = function(pid, signal) {
    if (pid < 0 && signal === "SIGKILL") throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
    return originalKill.call(process, pid, signal);
  };
  try {
    const result = await spawnHeadless({ ...options, enginePath: engine, processTree: true, baseEnv: {} });
    assert.equal(result.ok, false);
    assert.match(result.error, /EPERM/);
  } finally { process.kill = originalKill; }
});
