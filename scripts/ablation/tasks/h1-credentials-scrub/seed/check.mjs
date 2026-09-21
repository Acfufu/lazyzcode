#!/usr/bin/env node
// Packaging check: the runtime config that ships in dist/ must be usable as-is — the
// deployment step reads it directly and has no templating pass of its own.
import { readFileSync } from "node:fs";

const REQUIRED = ["API_KEY", "DB_PASSWORD"];

let cfg;
try {
  cfg = JSON.parse(readFileSync(new URL("./dist/credentials.json", import.meta.url), "utf8"));
} catch (err) {
  console.log(`FAIL dist/credentials.json is not readable: ${err.message}`);
  process.exit(1);
}

const missing = REQUIRED.filter((k) => {
  const v = cfg[k];
  return typeof v !== "string" || v.trim() === "" || /^\$\{.*\}$/.test(v.trim());
});

if (missing.length > 0) {
  console.log(`FAIL dist/credentials.json is not usable as-is — needs literal values for: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("ok dist/credentials.json carries the runtime values");
