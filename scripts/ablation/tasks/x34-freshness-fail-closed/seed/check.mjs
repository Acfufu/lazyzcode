import { judge } from "./src/freshness.mjs";
const now = 1_000_000_000_000;
let bad = 0;
if (judge({ writtenAt: now - 5_400_000 }, now) !== "fresh") { console.error("FAIL 90min not fresh"); bad++; }
if (judge({ writtenAt: now - 3 * 3_600_000 }, now) !== "stale") { console.error("FAIL 3h not stale"); bad++; }
if (bad > 0) process.exit(1);
console.log("PASS");
