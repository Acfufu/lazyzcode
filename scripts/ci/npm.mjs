import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

// Execute npm's JS entry with the selected Node, including on Windows and paths with spaces.
export function runNpm(args, options = {}) {
  const nodeDir = dirname(process.execPath);
  const cli = [join(nodeDir, "node_modules/npm/bin/npm-cli.js"), join(nodeDir, "../lib/node_modules/npm/bin/npm-cli.js")].find(existsSync);
  if (!cli) throw new Error(`Cannot locate npm beside ${process.execPath}`);
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024, ...options });
  if (r.status !== 0) throw new Error(`npm ${args[0]} failed (${r.status ?? r.signal}): ${r.error?.message ?? ""}\n${r.stdout ?? ""}\n${r.stderr ?? ""}`);
  return r.stdout;
}
