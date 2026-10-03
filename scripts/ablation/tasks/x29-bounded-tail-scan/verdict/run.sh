#!/usr/bin/env bash
set -u
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/full_check.mjs" <<'JSEOF'
import { pathToFileURL } from "node:url";
const { scanTail } = await import(pathToFileURL(process.cwd() + "/src/tailscan.mjs").href);
import { writeFileSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "ts-full-"));
let bad = 0;
function ok(name, cond) { if (!cond) { console.log("FAIL " + name); bad++; } }
// 8MB file: head sentinel, multi-byte runs across any plausible boundary, tail sentinel
const euro = "\u20AC".repeat(3000); // 9000 bytes of 3-byte chars
const filler = ("abcdefghij".repeat(400) + "\n").repeat(2);
const head = "HEAD-SENTINEL-should-not-appear\n";
const big = join(dir, "big.log");
writeFileSync(big, head + euro + filler + euro + "TAIL-OK-SENTINEL\n");
const size = statSync(big).size;

const r = await scanTail(big, { maxBytes: 4096, deadlineMs: 10_000 });
ok("read budget respected", r.readBytes <= 4099);
ok("truncated true", r.truncated === true);
ok("tail sentinel present", r.text.includes("TAIL-OK-SENTINEL"));
ok("head sentinel absent", !r.text.includes("HEAD-SENTINEL"));
ok("no replacement chars", !r.text.includes("\uFFFD"));
ok("text non-empty", r.text.length > 0);

// whole file fits
const small = join(dir, "small.log");
writeFileSync(small, "tiny\n");
const r2 = await scanTail(small, { maxBytes: 4096, deadlineMs: 10_000 });
ok("small truncated false", r2.truncated === false);
ok("small full text", r2.text === "tiny\n");
ok("small readBytes == size", r2.readBytes === 5);

// boundary char dropped whole: boundary lands inside a multi-byte char
const mbFile = join(dir, "mb.log");
writeFileSync(mbFile, "ab" + "\u20AC".repeat(2000));
const r3 = await scanTail(mbFile, { maxBytes: 4, deadlineMs: 10_000 });
ok("mb no replacement", !r3.text.includes("\uFFFD"));
ok("mb read budget", r3.readBytes <= 7);

// deadline respected: tiny deadline still returns a well-formed result, no throw
const r4 = await scanTail(big, { maxBytes: 4096, deadlineMs: 1 });
ok("deadline returns object", typeof r4.truncated === "boolean" && typeof r4.text === "string");
ok("deadline also bounded", r4.readBytes <= 4099);

// option validation
let threw = false;
try { await scanTail(big, { maxBytes: 10 }); } catch (e) { threw = e instanceof TypeError; }
ok("missing deadlineMs TypeError", threw);
threw = false;
try { await scanTail(big, {}); } catch (e) { threw = e instanceof TypeError; }
ok("missing options TypeError", threw);

// missing file throws (any error type acceptable)
let threwFile = false;
try { await scanTail(join(dir, "no-such.log"), { maxBytes: 10, deadlineMs: 100 }); } catch { threwFile = true; }
ok("missing file throws", threwFile);
if (bad > 0) { console.log("VERDICT: FAIL"); process.exit(1); }
console.log("VERDICT: PASS");
JSEOF
node "$TMP/full_check.mjs"
