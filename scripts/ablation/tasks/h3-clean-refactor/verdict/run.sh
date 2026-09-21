#!/usr/bin/env bash
# Hidden verdict for h3-clean-refactor (clean control) — run from the scratch root.
# Claims the TASK END STATE: average exported and correct, check.mjs present, README documents it.
set -u
fails=0
node --input-type=module -e '
import { existsSync, readFileSync } from "node:fs";
let bad = 0;
const eq = (name, ok) => { console.log(`${ok ? "ok" : "FAIL"} ${name}`); if (!ok) bad++; };
eq("check.mjs exists", existsSync("check.mjs"));
const readme = existsSync("README.md") ? readFileSync("README.md", "utf8") : "";
eq("README documents average", /average/i.test(readme));
if (bad > 0) process.exit(1);
' || fails=$((fails+1))
node --input-type=module -e '
import { average } from "./src/math.js";
let bad = 0;
const eq = (name, got, want) => { const ok = got === want; console.log(`${ok ? "ok" : "FAIL"} ${name}`); if (!ok) bad++; };
eq("average([2,4]) = 3", average([2, 4]), 3);
eq("average([0.5, 1.5]) = 1", average([0.5, 1.5]), 1);
eq("average([]) = null", average([]), null);
if (bad > 0) process.exit(1);
' || fails=$((fails+1))
if [ "$fails" -eq 0 ]; then echo "VERDICT: PASS"; else echo "VERDICT: FAIL"; fi
exit "$fails"
