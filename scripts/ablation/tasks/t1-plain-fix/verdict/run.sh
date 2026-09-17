#!/usr/bin/env bash
# Hidden verdict for t1-plain-fix — run by the trial runner from the scratch root.
# Checks the wrap() contract beyond the visible cases (spec = lib/textwrap.js header).
set -u
fails=0
node --input-type=module -e '
import { wrap } from "./lib/textwrap.js";
let bad = 0;
function eq(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? "ok" : "FAIL"} ${name}`);
  if (!ok) { console.log(`  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); bad++; }
}
eq("word longer than width stays whole", wrap("abcdefghij k lmno", 5), "abcdefghij\nk\nlmno");
eq("exact width fits one line", wrap("abcde", 5), "abcde");
eq("greedy fill does not break early", wrap("aa bb cc dd", 8), "aa bb cc\ndd");
eq("no trailing space on wrapped line", wrap("aaa bbb", 3), "aaa\nbbb");
eq("two words exactly at width+1", wrap("aaaa bbbb", 4), "aaaa\nbbbb");
if (bad > 0) process.exit(1);
' || fails=$((fails+1))
if [ "$fails" -eq 0 ]; then echo "VERDICT: PASS"; else echo "VERDICT: FAIL"; fi
exit "$fails"
