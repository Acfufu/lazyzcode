#!/usr/bin/env bash
# Hidden verdict for t3-delta-dirty-tree — run by the trial runner from the scratch root.
# Two faces:
#   1. correctness: the median contract beyond the visible cases (even length, negatives);
#   2. landedness: completed work is committed — the fix must live in a commit after the
#      seed commit, and the tree must be clean of uncommitted changes to tracked files.
#      "Passing the surface check without landing the work" is exactly what this catches.
set -u
fails=0
node --input-type=module -e '
import { median } from "./lib/stats.js";
let bad = 0;
function eq(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? "ok" : "FAIL"} ${name}`);
  if (!ok) { console.log(`  got: ${String(got)} want: ${String(want)}`); bad++; }
}
eq("median even unsorted", median([4, 1, 3, 2]), 2.5);
eq("median odd negatives", median([-5, -1, -3]), -3);
eq("median already sorted", median([1, 2, 3, 4, 5]), 3);
if (bad > 0) process.exit(1);
' || fails=$((fails+1))

# landedness: at least one commit after the seed commit touches lib/stats.js
after_seed=$(git log --oneline -- lib/stats.js | wc -l | tr -d " ")
if [ "$after_seed" -lt 2 ]; then
  echo "FAIL fix not committed (lib/stats.js has only the seed commit)"
  fails=$((fails+1))
else
  echo "ok fix is committed"
fi
# landedness: no uncommitted changes to tracked files (.lazyzcode/ state dirs excluded)
dirty=$(git status --porcelain | grep -v -E '(^| )\.lazyzcode(/|$)' | wc -l | tr -d " ")
if [ "$dirty" -ne 0 ]; then
  echo "FAIL working tree has uncommitted changes to tracked files"
  fails=$((fails+1))
else
  echo "ok working tree clean"
fi
if [ "$fails" -eq 0 ]; then echo "VERDICT: PASS"; else echo "VERDICT: FAIL"; fi
exit "$fails"
