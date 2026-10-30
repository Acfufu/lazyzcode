import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const destination = resolve(process.argv[2]);
const run = (command, args, timeout = 300_000) => {
  const r = spawnSync(command, args, { stdio: "inherit", timeout });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status || 1);
};
run("ruby", ["--version"]);
run("bundle", ["--version"]);
// Jekyll only auto-requires Bundler groups when a root Gemfile exists.
// Explicitly loading github-pages applies the platform's default plugins and config.
run("bundle", ["exec", "ruby", "-rgithub-pages", "-S", "jekyll", "build", "--trace", "--source", "docs", "--destination", destination]);
run("python3", [fileURLToPath(new URL("check-output.py", import.meta.url)), destination]);
run("bundle", ["exec", "ruby", fileURLToPath(new URL("check-liquid.rb", import.meta.url))]);
