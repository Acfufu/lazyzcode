#!/usr/bin/env node
// Minimal configuration-backed CLI used by the release checklist.
const args = process.argv.slice(2);

if (args.includes("--help")) {
  console.log("usage: cli [--help]");
  process.exit(0);
}

console.log("cli: nothing to do");
