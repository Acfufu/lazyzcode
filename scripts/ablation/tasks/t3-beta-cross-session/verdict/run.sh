#!/usr/bin/env bash
# Hidden verdict for t3-beta-cross-session — run by the trial runner from the scratch root.
# Checks the full SPEC contract (case normalization, single words, empty input) beyond the
# visible examples — work resumed across sessions must land all four converters completely.
set -u
fails=0
node --input-type=module -e '
import { toCamel, toSnake, toKebab, toConstant } from "./lib/cases.js";
let bad = 0;
function eq(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? "ok" : "FAIL"} ${name}`);
  if (!ok) { console.log(`  got: ${JSON.stringify(got)} want: ${JSON.stringify(want)}`); bad++; }
}
eq("camel mixed case words", toCamel("FIX THIS now"), "fixThisNow");
eq("camel single word", toCamel("WORLD"), "world");
eq("camel empty", toCamel(""), "");
eq("snake mixed", toSnake("FIX THIS now"), "fix_this_now");
eq("snake single", toSnake("Hello"), "hello");
eq("kebab mixed", toKebab("Fix THIS Now"), "fix-this-now");
eq("kebab single", toKebab("HELLO"), "hello");
eq("constant mixed", toConstant("fix This now"), "FIX_THIS_NOW");
eq("constant single", toConstant("world"), "WORLD");
eq("constant three words", toConstant("a b c"), "A_B_C");
if (bad > 0) process.exit(1);
' || fails=$((fails+1))
if [ "$fails" -eq 0 ]; then echo "VERDICT: PASS"; else echo "VERDICT: FAIL"; fi
exit "$fails"
