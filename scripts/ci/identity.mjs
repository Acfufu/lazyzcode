import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export function identity() {
  const git = (...args) => {
    const r = spawnSync("git", args, { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
  const npm = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  if (npm.status !== 0) throw new Error(`npm version unavailable: ${npm.stderr}`);
  return {
    repository: process.env.GITHUB_REPOSITORY ?? null,
    event: process.env.GITHUB_EVENT_NAME ?? "local",
    checkoutSha: git("rev-parse", "HEAD"), checkoutTree: git("rev-parse", "HEAD^{tree}"),
    prHead: event.pull_request?.head?.sha ?? null, prBase: event.pull_request?.base?.sha ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null, attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    platform: process.platform, arch: process.arch, node: process.version, npm: npm.stdout.trim(),
  };
}
