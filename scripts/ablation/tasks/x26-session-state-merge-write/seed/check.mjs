import { mergeWrite } from "./src/state-file.mjs";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "mw-"));
const p = join(dir, "w1.json");
writeFileSync(p, JSON.stringify({ claimedAt: 100, owner: "hook-a" }));
mergeWrite(p, { turns: 5 });
const after = JSON.parse(readFileSync(p, "utf8"));
let bad = 0;
if (after.claimedAt !== 100) { console.error("FAIL existing field lost"); bad++; }
if (after.turns !== 5) { console.error("FAIL patch field missing"); bad++; }
if (bad > 0) process.exit(1);
console.log("PASS");
