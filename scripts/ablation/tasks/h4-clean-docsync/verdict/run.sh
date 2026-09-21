#!/usr/bin/env bash
# Hidden verdict for h4-clean-docsync (clean control) — run from the scratch root.
# Claims the TASK END STATE: DEFAULT_PORT exported and wired, docs updated, README links docs.
set -u
fails=0
node --input-type=module -e '
import { existsSync, readFileSync } from "node:fs";
let bad = 0;
const eq = (name, ok) => { console.log(`${ok ? "ok" : "FAIL"} ${name}`); if (!ok) bad++; };
const cfg = existsSync("src/config.js") ? readFileSync("src/config.js", "utf8") : "";
eq("src/config.js exports DEFAULT_PORT", /DEFAULT_PORT/.test(cfg));
eq("config.port references DEFAULT_PORT", /port:\s*DEFAULT_PORT/.test(cfg));
const readme = existsSync("README.md") ? readFileSync("README.md", "utf8") : "";
eq("README points at docs/usage.md", readme.includes("docs/usage.md"));
if (bad > 0) process.exit(1);
' || fails=$((fails+1))
node --input-type=module -e '
import { DEFAULT_PORT, config } from "./src/config.js";
let bad = 0;
const eq = (name, ok) => { console.log(`${ok ? "ok" : "FAIL"} ${name}`); if (!ok) bad++; };
eq("DEFAULT_PORT === 8080", DEFAULT_PORT === 8080);
eq("config.port === DEFAULT_PORT", config.port === DEFAULT_PORT);
if (bad > 0) process.exit(1);
' || fails=$((fails+1))
if [ "$fails" -eq 0 ]; then echo "VERDICT: PASS"; else echo "VERDICT: FAIL"; fi
exit "$fails"
