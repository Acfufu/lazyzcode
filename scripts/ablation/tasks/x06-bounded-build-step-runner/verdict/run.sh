#!/usr/bin/env bash
set -u
# Full contract checks for the step runner. Only temporary files under a fresh
# directory are written, so the repository is left untouched.

set -u

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() {
  echo "VERDICT: FAIL"
  exit 1
}

# $1 steps file, $2 output file, $3 optional watchdog ticks (default 15 = ~3s)
run_bounded() {
  node run-steps.mjs "$1" > "$2" 2>&1 &
  pid=$!
  cap="${3:-15}"
  ticks=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 0.2
    ticks=$((ticks + 1))
    if [ "$ticks" -ge "$cap" ]; then
      kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 124
    fi
  done
  wait "$pid"
  return $?
}

# Case 1: two plain successful steps, exact line order, no leaked output.
cat > "$tmp/c1.json" <<'JSON'
[
  {"name": "alpha", "command": "echo one", "timeoutMs": 2000},
  {"name": "beta", "command": "echo leak", "timeoutMs": 2000}
]
JSON

run_bounded "$tmp/c1.json" "$tmp/c1.out"
[ $? -eq 0 ] || fail
[ "$(sed -n 1p "$tmp/c1.out")" = "STEP alpha ok" ] || fail
[ "$(sed -n 2p "$tmp/c1.out")" = "STEP beta ok" ] || fail
[ "$(tail -n 1 "$tmp/c1.out")" = "RESULT ok" ] || fail
nlines=$(wc -l < "$tmp/c1.out")
[ "$nlines" -eq 3 ] || fail
if grep -q 'leak' "$tmp/c1.out"; then fail; fi

# Case 2: a step that never exits is cut off at its own budget, run goes on.
cat > "$tmp/c2.json" <<'JSON'
[
  {"name": "slow", "command": "sleep 30", "timeoutMs": 400},
  {"name": "after", "command": "echo done", "timeoutMs": 2000}
]
JSON

run_bounded "$tmp/c2.json" "$tmp/c2.out"
[ $? -eq 1 ] || fail
[ "$(sed -n 1p "$tmp/c2.out")" = "STEP slow timeout" ] || fail
[ "$(sed -n 2p "$tmp/c2.out")" = "STEP after ok" ] || fail
[ "$(tail -n 1 "$tmp/c2.out")" = "RESULT failed" ] || fail

# Case 3: a failing command keeps its own status and does not stop the run.
cat > "$tmp/c3.json" <<'JSON'
[
  {"name": "boom", "command": "exit 3", "timeoutMs": 2000},
  {"name": "next", "command": "true", "timeoutMs": 2000}
]
JSON

run_bounded "$tmp/c3.json" "$tmp/c3.out"
[ $? -eq 1 ] || fail
[ "$(sed -n 1p "$tmp/c3.out")" = "STEP boom failed" ] || fail
[ "$(sed -n 2p "$tmp/c3.out")" = "STEP next ok" ] || fail
[ "$(tail -n 1 "$tmp/c3.out")" = "RESULT failed" ] || fail

# Case 4: a background helper keeps the pipe open; the whole tree must go.
cat > "$tmp/c4.json" <<'JSON'
[
  {"name": "tree", "command": "sleep 30 & sleep 30", "timeoutMs": 500},
  {"name": "last", "command": "true", "timeoutMs": 2000}
]
JSON

run_bounded "$tmp/c4.json" "$tmp/c4.out"
[ $? -eq 1 ] || fail
[ "$(sed -n 1p "$tmp/c4.out")" = "STEP tree timeout" ] || fail
[ "$(sed -n 2p "$tmp/c4.out")" = "STEP last ok" ] || fail
[ "$(tail -n 1 "$tmp/c4.out")" = "RESULT failed" ] || fail

# Case 5: no budget given, the default budget still bounds the step.
cat > "$tmp/c5.json" <<'JSON'
[
  {"name": "plain", "command": "sleep 30"},
  {"name": "final", "command": "true", "timeoutMs": 2000}
]
JSON

run_bounded "$tmp/c5.json" "$tmp/c5.out"
[ $? -eq 1 ] || fail
[ "$(sed -n 1p "$tmp/c5.out")" = "STEP plain timeout" ] || fail
[ "$(sed -n 2p "$tmp/c5.out")" = "STEP final ok" ] || fail

# Case 6: a generous budget is respected; the step is allowed to finish.
cat > "$tmp/c6.json" <<'JSON'
[
  {"name": "patient", "command": "sleep 2", "timeoutMs": 4000},
  {"name": "closing", "command": "true", "timeoutMs": 2000}
]
JSON

run_bounded "$tmp/c6.json" "$tmp/c6.out" 30
[ $? -eq 0 ] || fail
[ "$(sed -n 1p "$tmp/c6.out")" = "STEP patient ok" ] || fail
[ "$(sed -n 2p "$tmp/c6.out")" = "STEP closing ok" ] || fail
[ "$(tail -n 1 "$tmp/c6.out")" = "RESULT ok" ] || fail

echo "VERDICT: PASS"
exit 0
