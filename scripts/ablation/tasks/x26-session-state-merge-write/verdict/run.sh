#!/usr/bin/env bash
set -u
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/full_check.mjs" <<'JSEOF'
import { pathToFileURL } from "node:url";
const { mergeWrite } = await import(pathToFileURL(process.cwd() + "/src/state-file.mjs").href);
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "mw-full-"));
let bad = 0;
function ok(name, cond) { if (!cond) { console.log("FAIL " + name); bad++; } }
// existing fields preserved across sequential writes from "different workers"
const p1 = join(dir, "a.json");
mergeWrite(p1, { claimedAt: 100, owner: "w-a" });
mergeWrite(p1, { turns: 5 });
mergeWrite(p1, { note: "hi" });
const s1 = JSON.parse(readFileSync(p1, "utf8"));
ok("claimedAt survives", s1.claimedAt === 100);
ok("owner survives", s1.owner === "w-a");
ok("turns lands", s1.turns === 5);
ok("note lands", s1.note === "hi");

// corrupt file replaced, not merged, no throw
const p2 = join(dir, "b.json");
writeFileSync(p2, "{not json");
const s2 = mergeWrite(p2, { x: 1 });
ok("corrupt base replaced", s2.x === 1 && Object.keys(s2).length === 1);
ok("corrupt file now valid json", (() => { try { JSON.parse(readFileSync(p2, "utf8")); return true; } catch { return false; } })());

// missing file starts from {}
const p3 = join(dir, "c.json");
const s3 = mergeWrite(p3, { y: 2 });
ok("missing base empty", s3.y === 2 && Object.keys(s3).length === 1);

// undefined-valued keys skipped
const p4 = join(dir, "d.json");
mergeWrite(p4, { keep: "me" });
const s4 = mergeWrite(p4, { keep: undefined, add: 1 });
ok("undefined skipped", s4.keep === "me" && s4.add === 1);

// patch must be a plain object; file untouched on TypeError
const p5 = join(dir, "e.json");
mergeWrite(p5, { safe: true });
let threw = false;
try { mergeWrite(p5, [1, 2]); } catch (e) { threw = e instanceof TypeError; }
ok("array patch throws TypeError", threw);
ok("file untouched after throw", JSON.parse(readFileSync(p5, "utf8")).safe === true);
threw = false;
try { mergeWrite(p5, null); } catch (e) { threw = e instanceof TypeError; }
ok("null patch throws TypeError", threw);

// return value is the merged object
const p6 = join(dir, "f.json");
writeFileSync(p6, JSON.stringify({ a: 1 }));
const s6 = mergeWrite(p6, { b: 2 });
ok("returns merged object", s6.a === 1 && s6.b === 2);

// no temp leftovers
const p7 = join(dir, "sub", "g.json");
mkdirSync(join(dir, "sub"), { recursive: true });
mergeWrite(p7, { z: 9 });
const left = readdirSync(join(dir, "sub")).filter((f) => f !== "g.json");
ok("no temp file leftovers", left.length === 0 && existsSync(p7));
if (bad > 0) { console.log("VERDICT: FAIL"); process.exit(1); }
console.log("VERDICT: PASS");
JSEOF
node "$TMP/full_check.mjs"
