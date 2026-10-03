import { scanTail } from "./src/tailscan.mjs";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "ts-"));
const big = join(dir, "big.log");
writeFileSync(big, "x".repeat(2 * 1024 * 1024) + "TAILMARK\n");
const r = await scanTail(big, { maxBytes: 1024, deadlineMs: 5000 });
let bad = 0;
if (r.readBytes > 1027) { console.error("FAIL read budget: " + r.readBytes); bad++; }
if (!r.text.includes("TAILMARK")) { console.error("FAIL tail content missing"); bad++; }
if (bad > 0) process.exit(1);
console.log("PASS");
