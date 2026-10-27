// Offline Darwin regression probe. The C helper holds an owned child as a
// zombie briefly so exit/close deterministically encounter different states.
// Probe only: nothing here is packaged or used by the runtime.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawnHeadless } from "../../core/headless.js";
if (process.platform !== "darwin") throw Error("Darwin probe only");
const output = resolve(process.argv[2] ?? "artifacts/reliability/r0-followup/macos-zombie.json");
mkdirSync(resolve(output, ".."), { recursive: true });
const dir = mkdtempSync(join(tmpdir(), "lzy-r0-zombie-"));
const originalKill = process.kill;
const signals = [];
try {
  const source = join(dir, "guardian.c"), guardian = join(dir, "guardian"), ready = join(dir, "ready"), observed = join(dir, "observed"), engine = join(dir, "engine.cjs");
  writeFileSync(source, String.raw`#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
  if (argc != 3) return 1;
  alarm(6);
  pid_t leaf = fork();
  if (leaf == -1) return 2;
  if (leaf == 0) {
    FILE *f = fopen(argv[1], "w"); if (!f) _exit(3);
    fprintf(f, "%d", getpid()); fclose(f);
    sleep(4); _exit(0);
  }
  if (setpgid(0, 0) == -1) return 4;
  siginfo_t info = {0};
  if (waitid(P_PID, leaf, &info, WEXITED | WNOWAIT) == -1) return 5;
  FILE *f = fopen(argv[2], "w"); if (!f) return 6;
  fprintf(f, "{\"leaf\":%d,\"guardian\":%d,\"exitCode\":%d,\"signal\":%d}", leaf, getpid(), info.si_code, info.si_status); fclose(f);
  close(0); close(1); close(2);
  usleep(400000);
  waitpid(leaf, 0, 0);
  return 0;
}
`);
  execFileSync("clang", ["-Wall", "-Wextra", source, "-o", guardian]);
  writeFileSync(engine, `const f=require('fs');require('child_process').spawn(${JSON.stringify(guardian)},[${JSON.stringify(ready)},${JSON.stringify(observed)}],{stdio:'inherit'});setInterval(()=>{if(f.existsSync(${JSON.stringify(ready)})){console.log(JSON.stringify({response:'done'}));process.exit(0)}},10);setTimeout(()=>process.exit(2),3000);`);
  process.kill = function(pid, signal) {
    if (pid >= 0) return originalKill.call(process, pid, signal);
    const event = { pid, signal, at: performance.now() }; signals.push(event);
    try { const result = originalKill.call(process, pid, signal); event.ok = true; return result; }
    catch (e) { event.error = e.code; throw e; }
  };
  const result = await spawnHeadless({ prompt: "offline", mode: "plan", enginePath: engine, processTree: true, timeoutMs: 4000, baseEnv: {} });
  await delay(500);
  const observation = JSON.parse(readFileSync(observed, "utf8"));
  writeFileSync(output, JSON.stringify({ platform: process.platform, node: process.version, result, signals, observation }, null, 2) + "\n");
  console.log(JSON.stringify({ ok: result.ok, error: result.error, signals, observation, output }));
  process.exitCode = result.ok ? 0 : 1;
} finally {
  process.kill = originalKill;
  await delay(1000);
  rmSync(dir, { recursive: true, force: true });
}
