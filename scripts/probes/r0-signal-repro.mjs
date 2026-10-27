// Offline signal trace. Instruments this process only; fixture children expire.
import { spawnHeadless } from "../../core/headless.js";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir, release } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
const output = resolve(process.argv[2] ?? "artifacts/reliability/r0-followup/signal-trace.json");
const count = Number(process.argv[3] ?? 40);
if (process.platform === "win32" || !Number.isInteger(count) || count < 1 || count > 200) throw Error("POSIX only, count 1..200");
mkdirSync(resolve(output, ".."), { recursive: true });
const dir = mkdtempSync(join(tmpdir(), "lzy-r0-signals-"));
const original = process.kill;
let active;
process.kill = function(pid, signal) {
  if (pid >= 0) return original.call(process, pid, signal);
  const event = { pid, signal, at: performance.now(), callsite: new Error().stack.split("\n").filter(s => /headless\.js/.test(s)) };
  active.signals.push(event);
  try { const result = original.call(process, pid, signal); event.ok = true; return result; }
  catch (e) {
    event.error = e.code;
    event.group = execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,uid=,stat=,comm="], { encoding: "utf8" }).split("\n").map(s => s.trim()).filter(s => Number(s.split(/\s+/)[2]) === -pid);
    throw e;
  }
};
const report = { platform: process.platform, os: release(), node: process.version, startedAt: new Date().toISOString(), runs: [] };
try {
  for (let i = 0; i < count; i++) {
    const root = join(dir, String(i)); mkdirSync(root);
    const ready = join(root, "pid"), writes = join(root, "writes"), leaf = join(root, "leaf.cjs"), middle = join(root, "middle.cjs"), engine = join(root, "engine.cjs");
    writeFileSync(writes, "");
    writeFileSync(leaf, `const f=require('fs');f.writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>f.appendFileSync(${JSON.stringify(writes)},'x'),20);setTimeout(()=>process.exit(0),3000);`);
    writeFileSync(middle, `require('child_process').spawn(process.execPath,[${JSON.stringify(leaf)}],{stdio:'inherit'});`);
    writeFileSync(engine, `const f=require('fs');require('child_process').spawn(process.execPath,[${JSON.stringify(middle)}],{stdio:'inherit'});setInterval(()=>{if(f.existsSync(${JSON.stringify(ready)})){console.log(JSON.stringify({response:'done'}));process.exit(0);}},5);`);
    active = { i, signals: [] }; report.runs.push(active);
    try {
      active.result = await spawnHeadless({ prompt: "offline", mode: "plan", enginePath: engine, processTree: true, timeoutMs: 4000, baseEnv: {} });
      active.before = readFileSync(writes, "utf8").length; await delay(70);
      active.after = readFileSync(writes, "utf8").length;
    } finally { if (existsSync(ready)) try { original.call(process, Number(readFileSync(ready, "utf8")), "SIGKILL"); } catch {} }
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  }
} finally { process.kill = original; rmSync(dir, { recursive: true, force: true }); }
report.endedAt = new Date().toISOString();
report.failures = report.runs.filter(r => !r.result.ok || r.before !== r.after).length;
report.eperm = report.runs.filter(r => r.signals.some(s => s.error === "EPERM")).length;
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ count, failures: report.failures, eperm: report.eperm, output }));
process.exitCode = report.failures ? 1 : 0;
