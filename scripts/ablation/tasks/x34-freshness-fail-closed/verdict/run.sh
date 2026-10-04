#!/usr/bin/env bash
set -u
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/full_check.mjs" <<'JSEOF'
import { pathToFileURL } from "node:url";
const { judge } = await import(pathToFileURL(process.cwd() + "/src/freshness.mjs").href);
let bad = 0;
function ok(name, cond) { if (!cond) { console.log("FAIL " + name); bad++; } }
const now = 1_000_000_000_000;
const HOUR = 3_600_000;
ok("1h fresh", judge({ writtenAt: now - HOUR }, now) === "fresh");
ok("3h stale", judge({ writtenAt: now - 3 * HOUR }, now) === "stale");
ok("2h exactly stale", judge({ writtenAt: now - 2 * HOUR }, now) === "stale");
ok("2h minus 1ms fresh", judge({ writtenAt: now - 2 * HOUR + 1 }, now) === "fresh");
ok("missing writtenAt stale", judge({}, now) === "stale");
ok("NaN writtenAt stale", judge({ writtenAt: NaN }, now) === "stale");
ok("Infinity writtenAt stale", judge({ writtenAt: Infinity }, now) === "stale");
ok("string writtenAt stale", judge({ writtenAt: "123" }, now) === "stale");
ok("null snapshot stale", judge(null, now) === "stale");
ok("array snapshot stale", judge([1], now) === "stale");
ok("number snapshot stale", judge(5, now) === "stale");
ok("undefined snapshot stale", judge(undefined, now) === "stale");
ok("now NaN stale", judge({ writtenAt: now - HOUR }, NaN) === "stale");
ok("now Infinity stale", judge({ writtenAt: now - HOUR }, Infinity) === "stale");
ok("future beyond skew stale", judge({ writtenAt: now + 61_000 }, now) === "stale");
ok("future within skew fresh", judge({ writtenAt: now + 30_000 }, now) === "fresh");
ok("future exactly at skew fresh", judge({ writtenAt: now + 60_000 }, now) === "fresh");
ok("far past stale", judge({ writtenAt: 0 }, now) === "stale");
if (bad > 0) { console.log("VERDICT: FAIL"); process.exit(1); }
console.log("VERDICT: PASS");
JSEOF
node "$TMP/full_check.mjs"
