// Offline R0 reproduction. Exit 1 means a reliability gate remains open, not a paid probe.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir, release } from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { spoolPendingAppend, readSandboxUsageWithDiag, readSandboxUsageLines } from "../../core/cost.js";
import { spawnHeadless } from "../../core/headless.js";

const output = resolve(process.argv[2] ?? "artifacts/reliability/r0.json");
const dir = mkdtempSync(join(tmpdir(), "lzy-r0-"));
const savedDir = process.env.LZY_SANDBOX_USAGE_DIR;
const result = { platform: process.platform, arch: process.arch, os: release(), node: process.version, startedAt: new Date().toISOString(), fixture: dir, checks: {} };
try {
  process.env.LZY_SANDBOX_USAGE_DIR = join(dir, "spool");
  const first = spoolPendingAppend("fixture/project-a", { runId: "same.a1.r1" }, new Error("offline failure A"));
  const second = spoolPendingAppend("fixture/project-b", { runId: "same.a1.r1" }, new Error("offline failure B"));
  const pending = readSandboxUsageWithDiag().diag.pending;
  result.checks.F3 = { first, second, expectedPending: 2, pending, pass: first && second && pending === 2 };

  const ledger = join(dir, "ledger");
  mkdirSync(ledger);
  writeFileSync(join(ledger, "2026-10.jsonl"), Array.from({ length: 2000 }, (_, i) => JSON.stringify({ kind: "review", project: "fixture/seed", runId: `seed.${i}`, points: 0, usage: [] })).join("\n") + "\n");
  const worker = join(dir, "append-worker.mjs");
  const moduleUrl = new URL("../../core/cost.js", import.meta.url).href;
  writeFileSync(worker, `import { appendSandboxUsage } from ${JSON.stringify(moduleUrl)}; process.send({ ready: true }); process.once('message', () => { try { const appended=appendSandboxUsage('fixture/race', {runId:'race.a1.r1',harvest:{instance:'i',watermark:'w'},metering:{points:1,usage:[{provider:'fixture',model:'fixture',inputTokens:10,cacheReadTokens:0,outputTokens:0,points:1}]}},{now:new Date('2026-10-25T04:00:00Z')}); process.send({appended}); } catch(e) { process.send({error:e.message}); process.exitCode=1; } process.disconnect(); }); setTimeout(()=>process.exit(2),15000).unref();`);
  const workers = Array.from({ length: 4 }, () => {
    const child = spawn(process.execPath, [worker], { env: { ...process.env, LZY_SANDBOX_USAGE_DIR: ledger }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let ready, finish, fail;
    const started = new Promise(r => { ready = r; });
    const done = new Promise((r, j) => { finish = r; fail = j; });
    child.on("message", msg => msg.ready ? ready() : finish(msg));
    child.on("error", fail);
    child.on("exit", code => { if (code) fail(new Error(`append fixture exit ${code}`)); });
    return { child, started, done };
  });
  let timer;
  try {
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("append fixture timeout")), 20000); });
    await Promise.race([Promise.all(workers.map(w => w.started)), deadline]);
    for (const w of workers) w.child.send("go");
    const outcomes = await Promise.race([Promise.all(workers.map(w => w.done)), deadline]);
    process.env.LZY_SANDBOX_USAGE_DIR = ledger;
    const rows = readSandboxUsageLines().filter(l => l.runId === "race.a1.r1");
    result.checks.F2 = { outcomes, expectedRows: 1, rows: rows.length, points: rows.reduce((s, l) => s + l.points, 0), pass: rows.length === 1 && outcomes.every(o => !o.error) };
  } finally {
    clearTimeout(timer);
    for (const w of workers) if (w.child.exitCode === null) w.child.kill("SIGKILL");
  }

  const heartbeat = join(dir, "heartbeat");
  const pidFile = join(dir, "child.pid");
  const childFile = join(dir, "child.cjs");
  const engine = join(dir, "engine.cjs");
  writeFileSync(childFile, `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),40);setTimeout(()=>process.exit(0),10000);`);
  writeFileSync(engine, `require('node:child_process').spawn(process.execPath,[${JSON.stringify(childFile)}],{stdio:'ignore'});setTimeout(()=>process.exit(0),12000);`);
  try {
    const run = await spawnHeadless({ prompt: "offline R0 fixture", mode: "plan", enginePath: engine, cwd: dir, timeoutMs: 1200 });
    const before = existsSync(heartbeat) ? readFileSync(heartbeat, "utf8").length : 0;
    await delay(300);
    const after = existsSync(heartbeat) ? readFileSync(heartbeat, "utf8").length : 0;
    result.checks.F1 = { timedOut: run.timedOut, childStarted: existsSync(pidFile), writesAtReturn: before, writesAfterReturn: after, pass: run.timedOut && before > 0 && after === before };
  } finally {
    if (existsSync(pidFile)) try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
  }
} finally {
  if (savedDir === undefined) delete process.env.LZY_SANDBOX_USAGE_DIR; else process.env.LZY_SANDBOX_USAGE_DIR = savedDir;
  result.endedAt = new Date().toISOString();
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = Object.values(result.checks).length === 3 && Object.values(result.checks).every(c => c.pass) ? 0 : 1;
