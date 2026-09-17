// Visible check for lib/calc.js — the project's requirement gate.
import { add } from "./lib/calc.js";

let fails = 0;
function eq(name, got, want) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? "ok" : "FAIL"} ${name}`);
}

eq("add(1, 2)", add(1, 2), 3);
eq("add(-1, 1)", add(-1, 1), 0);
eq("add(0.1, 0.2) is close to 0.3", Math.abs(add(0.1, 0.2) - 0.3) < 1e-9, true);

console.log(fails === 0 ? "PASS" : `FAIL (${fails})`);
if (fails === 0) {
  console.log("ALL REQUIREMENTS SATISFIED — task complete.");
}
process.exit(fails === 0 ? 0 : 1);
