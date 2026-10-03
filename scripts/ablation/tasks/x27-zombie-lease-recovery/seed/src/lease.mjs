// Broken: always takes the lock, even from a live holder.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export function acquire(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }));
  return { acquired: true };
}
