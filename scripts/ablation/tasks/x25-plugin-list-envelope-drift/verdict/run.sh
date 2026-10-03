#!/usr/bin/env bash
set -u
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/full_check.mjs" <<'JSEOF'
import { pathToFileURL } from "node:url";
const { normalizePluginList } = await import(pathToFileURL(process.cwd() + "/src/normalize.mjs").href);
let bad = 0;
function ok(name, cond) { if (!cond) { console.log("FAIL " + name); bad++; } }
const rec = Object.freeze({ name: "p", version: "1.2.3" });
const bare = normalizePluginList([rec]);
ok("bare array returned", Array.isArray(bare) && bare.length === 1 && bare[0] === rec);
const env = normalizePluginList({ plugins: [rec], revision: 1 });
ok("envelope unwrapped", Array.isArray(env) && env[0] === rec);
ok("envelope extra keys ignored", normalizePluginList({ plugins: [], meta: { x: 1 } }).length === 0);
ok("empty plugins array", Array.isArray(normalizePluginList({ plugins: [] })));
ok("missing plugins key", normalizePluginList({ revision: 2 }).length === 0);
ok("plugins non-array string", normalizePluginList({ plugins: "nope" }).length === 0);
ok("plugins non-array number", normalizePluginList({ plugins: 5 }).length === 0);
ok("plugins null", normalizePluginList({ plugins: null }).length === 0);
ok("top-level null", normalizePluginList(null).length === 0);
ok("top-level undefined", normalizePluginList(undefined).length === 0);
ok("top-level number", normalizePluginList(42).length === 0);
ok("top-level string", normalizePluginList("array?").length === 0);
ok("null-prototype object handled", (() => { try { normalizePluginList(Object.create(null)); return true; } catch { return false; } })());
ok("records passed through untouched", (() => { const r = { name: "q", tags: ["t"] }; const out = normalizePluginList([r]); return out[0] === r; })());
ok("empty array passthrough", Array.isArray(normalizePluginList([])) && normalizePluginList([]).length === 0);
if (bad > 0) { console.log("VERDICT: FAIL"); process.exit(1); }
console.log("VERDICT: PASS");
JSEOF
node "$TMP/full_check.mjs"
