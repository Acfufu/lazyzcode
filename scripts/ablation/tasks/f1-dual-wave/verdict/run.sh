#!/usr/bin/env bash
# Hidden verdict for f1-dual-wave — run from the merged scratch root.
# Claims the MERGED END STATE: both modules exported correctly, both tests pass, tree clean.
set -u
fails=0
node --input-type=module -e '
import { existsSync } from "node:fs";
import { average } from "./src/math-a.js";
import { median } from "./src/math-b.js";
import { spawnSync } from "node:child_process";
let bad = 0;
const eq = (name, ok) => { console.log(`${ok ? "ok" : "FAIL"} ${name}`); if (!ok) bad++; };
eq("average([2,4]) = 3", average([2, 4]) === 3);
eq("average([]) = null", average([]) === null);
eq("median([1,3,2]) = 2", median([1, 3, 2]) === 2);
eq("median([1,2,3,4]) = 2.5", median([1, 2, 3, 4]) === 2.5);
eq("median([]) = null", median([]) === null);
const ta = spawnSync(process.execPath, ["test-a.mjs"]);
const tb = spawnSync(process.execPath, ["test-b.mjs"]);
eq("test-a.mjs exit 0", ta.status === 0);
eq("test-b.mjs exit 0", tb.status === 0);
process.exit(bad > 0 ? 1 : 0);
' || fails=$((fails+1))
if [ -n "$(git status --porcelain)" ]; then echo "FAIL tree dirty"; fails=$((fails+1)); else echo "ok tree clean"; fi
exit $fails
