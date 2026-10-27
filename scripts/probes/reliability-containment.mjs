// R0: verify the actual boundary of the existing process-group mechanism.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir, release } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { spawnHeadless } from "../../core/headless.js";
const dir = mkdtempSync(join(tmpdir(), "lzy-containment-"));
const output = resolve(process.argv[2] ?? "artifacts/reliability/containment.json");
const report = { platform: process.platform, arch: process.arch, os: release(), node: process.version, fixture: dir, checks: [] };
for (const detached of [false, true]) {
  const heartbeat = join(dir, `writes-${detached}`), ready = join(dir, `pid-${detached}`);
  const descendant = join(dir, `descendant-${detached}.cjs`), engine = join(dir, `engine-${detached}.cjs`);
  writeFileSync(descendant, `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeat)},'x'),25);setTimeout(()=>process.exit(),8000);`);
  writeFileSync(engine, `const fs=require('node:fs');require('node:child_process').spawn(process.execPath,[${JSON.stringify(descendant)}],{detached:${detached},stdio:'ignore'}).unref();const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(ready)})){clearInterval(t);console.log(JSON.stringify({response:'segment complete'}));process.exit(0)}},10);setTimeout(()=>process.exit(2),5000);`);
  try {
    const run = await spawnHeadless({ prompt: "offline containment probe", mode: "plan", enginePath: engine, processTree: true, timeoutMs: 6000 });
    const before = existsSync(heartbeat) ? readFileSync(heartbeat, "utf8").length : 0;
    await delay(250);
    const after = existsSync(heartbeat) ? readFileSync(heartbeat, "utf8").length : 0;
    report.checks.push({ detached, engineOk: run.ok, childStarted: existsSync(ready), before, after, stopped: existsSync(ready) && before === after });
  } catch (e) { report.checks.push({ detached, supported: false, error: e.message }); }
  finally { if (existsSync(ready)) try { process.kill(Number(readFileSync(ready, "utf8")), "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; } }
}
report.gatePassed = report.checks.every(c => c.stopped);
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.gatePassed ? 0 : 1;
