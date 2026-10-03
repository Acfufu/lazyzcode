#!/usr/bin/env bash
set -u
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/full_check.mjs" <<'JSEOF'
import { pathToFileURL } from "node:url";
const { acquire } = await import(pathToFileURL(process.cwd() + "/src/lease.mjs").href);
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const base = mkdtempSync(join(tmpdir(), "zl-full-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
function ok(name, cond) { if (!cond) { console.log("FAIL " + name); bad++; } }
// fresh acquire
const l1 = join(base, "fresh");
ok("fresh acquired", acquire(l1).acquired === true);
const own = JSON.parse(readFileSync(join(l1, "owner.json"), "utf8"));
ok("owner.json has own pid + acquiredAt", own.pid === process.pid && typeof own.acquiredAt === "number");

// live holder -> rejected with holder pid
const l2 = join(base, "live");
const holder = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 8000)"], { stdio: "ignore" });
await sleep(300);
mkdirSync(l2, { recursive: true });
writeFileSync(join(l2, "owner.json"), JSON.stringify({ pid: holder.pid, acquiredAt: Date.now() }));
const r2 = acquire(l2);
ok("live holder rejected", r2.acquired === false && r2.holder === holder.pid);
const dead = new Promise((r) => holder.on("exit", r));
holder.kill("SIGKILL");
await dead; // zombie 未收尸时 kill(pid,0) 仍算活——等 reap 再判
await sleep(100);

// dead holder -> steal
const r3 = acquire(l2);
ok("dead holder stolen", r3.acquired === true && r3.stolen === true);
const own3 = JSON.parse(readFileSync(join(l2, "owner.json"), "utf8"));
ok("stolen owner rewritten", own3.pid === process.pid);

// own pid is alive -> re-acquiring own lock rejected
const r4 = acquire(l2);
ok("own live lock rejected", r4.acquired === false && r4.holder === process.pid);

// missing owner.json -> busy, fail-closed
const l3 = join(base, "noowner");
mkdirSync(l3, { recursive: true });
const r5 = acquire(l3);
ok("missing owner.json busy", r5.acquired === false && !("stolen" in r5));

// corrupt owner.json -> busy
const l4 = join(base, "corrupt");
mkdirSync(l4, { recursive: true });
writeFileSync(join(l4, "owner.json"), "{oops");
const r6 = acquire(l4);
ok("corrupt owner.json busy", r6.acquired === false && !("stolen" in r6));

// stale acquiredAt field does not matter — only pid liveness does
const l5 = join(base, "oldts");
mkdirSync(l5, { recursive: true });
writeFileSync(join(l5, "owner.json"), JSON.stringify({ pid: process.pid, acquiredAt: 0 }));
const r7 = acquire(l5);
ok("old timestamp still busy (pid alive)", r7.acquired === false && r7.holder === process.pid);
if (bad > 0) { console.log("VERDICT: FAIL"); process.exit(1); }
console.log("VERDICT: PASS");
JSEOF
node "$TMP/full_check.mjs"
