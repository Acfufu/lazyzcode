import { judge } from "./src/freshness.mjs";
const now = 1_000_000_000_000;
let bad = 0;
if (judge({ writtenAt: now - 3_600_000 }, now) !== "fresh") { console.error("FAIL 1h not fresh"); bad++; }
if (judge({ writtenAt: now - 10_800_000 }, now) !== "stale") { console.error("FAIL 3h not stale"); bad++; }
if (judge({}, now) !== "stale") { console.error("FAIL missing writtenAt must fail closed"); bad++; }
if (bad > 0) process.exit(1);
console.log("PASS");
