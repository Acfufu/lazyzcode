import { acquire } from "./src/lease.mjs";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const base = mkdtempSync(join(tmpdir(), "zl-"));
let bad = 0;
const first = acquire(join(base, "l1"));
if (!first.acquired) { console.error("FAIL fresh acquire"); bad++; }
const holder = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 5000)"], { stdio: "ignore" });
setTimeout(() => {
  const l2 = join(base, "l2");
  mkdirSync(l2, { recursive: true });
  writeFileSync(join(l2, "owner.json"), JSON.stringify({ pid: holder.pid, acquiredAt: Date.now() }));
  const r = acquire(l2);
  if (r.acquired !== false || r.holder !== holder.pid) { console.error("FAIL live holder not rejected"); bad++; }
  holder.kill("SIGKILL");
  if (bad > 0) process.exit(1);
  console.log("PASS");
}, 300);
