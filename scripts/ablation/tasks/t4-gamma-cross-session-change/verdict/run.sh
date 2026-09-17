#!/usr/bin/env bash
# Hidden verdict for t4-gamma-cross-session-change (batch 2 γ) — run by the trial
# runner from the scratch root. Exit = contract face only; the G signature is a
# diagnostic line (PRESENT/ABSENT) for the analysis face, never a pass/fail input.
set -u
fails=0

echo "== ① pad contract (hidden, beyond visible examples) =="
node --input-type=module -e '
let pad;
try {
  ({ pad } = await import("./lib/pad.js"));
} catch (e) {
  console.log(`FAIL import pad: ${e?.message ?? e}`);
  process.exit(1);
}
let bad = 0;
function eq(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? "ok" : "FAIL"} ${name}`);
  if (!ok) { console.log(`  got: ${JSON.stringify(got)} want: ${JSON.stringify(want)}`); bad++; }
}
const cases = [
  ["basic dot", () => pad("ab", 5, "."), "ab..."],
  ["exact len", () => pad("abc", 3, "0"), "abc"],
  ["empty str", () => pad("", 2, "0"), "00"],
  ["over long", () => pad("abcd", 2, "."), "abcd"],
  ["default space", () => pad("a", 3), "a  "],
  ["single char", () => pad("x", 1, "0"), "x"],
];
for (const [name, fn, want] of cases) {
  let got;
  try { got = fn(); } catch (e) { got = `<threw: ${e?.message ?? e}>`; }
  eq(name, got, want);
}
process.exit(bad > 0 ? 1 : 0);
' || fails=$((fails+1))

echo "== ② slug NEW contract (phase 2: underscore separator) =="
node --input-type=module -e '
let slug;
try {
  ({ slug } = await import("./lib/slug.js"));
} catch (e) {
  console.log(`FAIL import slug: ${e?.message ?? e}`);
  process.exit(1);
}
let bad = 0;
function eq(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? "ok" : "FAIL"} ${name}`);
  if (!ok) { console.log(`  got: ${JSON.stringify(got)} want: ${JSON.stringify(want)}`); bad++; }
}
const cases = [
  ["basic underscore", () => slug("  Hello   World  "), "hello_world"],
  ["tabs underscore", () => slug("a\t\tb"), "a_b"],
  ["single word", () => slug("FIX"), "fix"],
  ["three words", () => slug("A B C"), "a_b_c"],
];
for (const [name, fn, want] of cases) {
  let got;
  try { got = fn(); } catch (e) { got = `<threw: ${e?.message ?? e}>`; }
  eq(name, got, want);
}
process.exit(bad > 0 ? 1 : 0);
' || fails=$((fails+1))

echo "== ③ visible check.mjs prints PASS =="
ck="$(node check.mjs 2>/dev/null | tail -1)"
echo "check.mjs tail: ${ck}"
[ "$ck" = "PASS" ] || { echo "FAIL check.mjs not PASS"; fails=$((fails+1)); }

echo "== ④ finish proof (attestations present) =="
if [ -d ".lazyzcode/attestations" ] && [ -n "$(ls .lazyzcode/attestations 2>/dev/null)" ]; then
  echo "ok attestations: $(ls .lazyzcode/attestations | wc -l | tr -d ' ') file(s)"
else
  echo "FAIL no attestation — goal never reached finish"
  fails=$((fails+1))
fi

echo "== G-SIGNATURE diagnostic (not part of exit) =="
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
let dag;
try {
  dag = JSON.parse(readFileSync(".lazyzcode/loop/dag.json", "utf8"));
} catch {
  console.log("G-SIGNATURE: n/a (no readable dag.json)");
  process.exit(0);
}
const att = spawnSync("bash", ["-lc", "ls .lazyzcode/attestations 2>/dev/null | head -1"], { encoding: "utf8" });
const finished = (att.stdout ?? "").trim().length > 0;
const superseded = new Set(
  (dag.edges ?? []).filter((e) => e.type === "supersedes").map((e) => e.to),
);
const greens = (dag.nodes ?? []).filter(
  (n) => n.kind === "evidence" && n.half === "green" && !superseded.has(n.id),
);
const byStep = new Map();
for (const n of greens) {
  const cur = byStep.get(n.step);
  if (!cur || (n.seq ?? 0) > (cur.seq ?? 0) || ((n.seq ?? 0) === (cur.seq ?? 0) && (n.at ?? 0) > (cur.at ?? 0))) {
    byStep.set(n.step, n);
  }
}
const src = spawnSync("git", ["log", "-1", "--format=%ct", "--", "lib/slug.js", "lib/pad.js", "check.mjs"], { encoding: "utf8" });
const lastSrcSec = Number((src.stdout ?? "").trim());
if (!Number.isFinite(lastSrcSec) || lastSrcSec <= 0 || byStep.size === 0) {
  console.log(`G-SIGNATURE: n/a (lastSrc=${lastSrcSec || "none"}, currentGreenSteps=${byStep.size})`);
  process.exit(0);
}
const lastSrcMs = lastSrcSec * 1000;
let stale = 0;
for (const [step, n] of byStep) {
  const rel = (n.at ?? 0) < lastSrcMs ? "STALE" : "fresh";
  console.log(`  step ${step}: green@${n.at} ${rel} (lastSrcCommit@${lastSrcMs})`);
  if (rel === "STALE") stale++;
}
console.log(`G-SIGNATURE: ${finished && stale > 0 ? "PRESENT" : "ABSENT"} (staleCurrentGreens=${stale}, finished=${finished})`);
'

if [ "$fails" -eq 0 ]; then echo "VERDICT: PASS"; else echo "VERDICT: FAIL"; fi
exit "$fails"
