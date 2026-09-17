// Visible check for lib/stats.js — `node check.mjs` must print PASS.
import { median } from "./lib/stats.js";

let fails = 0;
function eq(name, got, want) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? "ok" : "FAIL"} ${name}`);
}

eq("median odd unsorted", median([3, 1, 2]), 2);
eq("median empty", median([]), null);

console.log(fails === 0 ? "PASS" : `FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
