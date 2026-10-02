#!/usr/bin/env bash
set -u
# Full contract check for the task supervisor. Read-only: writes only inside a temp dir.
set -u

fail() {
  echo "VERDICT: FAIL"
  exit 1
}

TMP="$(mktemp -d "${TMPDIR:-/tmp}/task-supervisor.XXXXXX")" || fail
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

cat > "$TMP/ok.mjs" <<'EOF'
console.log('ok');
EOF

cat > "$TMP/bad.mjs" <<'EOF'
process.exit(3);
EOF

cat > "$TMP/hang.mjs" <<'EOF'
setInterval(() => {}, 50);
EOF

cat > "$TMP/stubborn.mjs" <<'EOF'
process.on('SIGTERM', () => {});
setInterval(() => {}, 50);
EOF

run_bounded() {
  local limit="$1"
  shift
  local out="$1"
  shift
  "$@" > "$out" 2> "$TMP/stderr.log" &
  local pid=$!
  ( sleep "$limit"; kill -9 "$pid" 2>/dev/null ) &
  local watchdog=$!
  local rc=0
  wait "$pid" || rc=$?
  kill "$watchdog" 2>/dev/null
  wait "$watchdog" 2>/dev/null
  return $rc
}

# --- all tasks succeed -------------------------------------------------------
cat > "$TMP/m_ok.json" <<EOF
{"defaultTimeoutMs":2000,"tasks":[{"name":"a","command":"node","args":["$TMP/ok.mjs"]},{"name":"b","command":"node","args":["$TMP/ok.mjs"]}]}
EOF
run_bounded 3 "$TMP/out_ok" node runner.mjs "$TMP/m_ok.json"
rc=$?
[ "$rc" -eq 0 ] || fail
[ "$(wc -l < "$TMP/out_ok" | tr -d ' ')" = "3" ] || fail
[ "$(sed -n '1p' "$TMP/out_ok")" = '{"name":"a","status":"ok","exitCode":0,"timedOut":false}' ] || fail
[ "$(sed -n '2p' "$TMP/out_ok")" = '{"name":"b","status":"ok","exitCode":0,"timedOut":false}' ] || fail
[ "$(tail -n 1 "$TMP/out_ok")" = 'SUMMARY ok=2 failed=0 timeout=0' ] || fail

# --- a task that never exits is bounded -------------------------------------
cat > "$TMP/m_hang.json" <<EOF
{"tasks":[{"name":"hang","command":"node","args":["$TMP/hang.mjs"],"timeoutMs":300}]}
EOF
t0=$(date +%s)
run_bounded 3 "$TMP/out_hang" node runner.mjs "$TMP/m_hang.json"
rc=$?
t1=$(date +%s)
[ "$rc" -eq 1 ] || fail
[ "$(sed -n '1p' "$TMP/out_hang")" = '{"name":"hang","status":"timeout","exitCode":null,"timedOut":true}' ] || fail
[ "$(tail -n 1 "$TMP/out_hang")" = 'SUMMARY ok=0 failed=0 timeout=1' ] || fail
[ $((t1 - t0)) -le 2 ] || fail

# --- a task that ignores a polite stop request is still bounded --------------
cat > "$TMP/m_stubborn.json" <<EOF
{"tasks":[{"name":"stubborn","command":"node","args":["$TMP/stubborn.mjs"],"timeoutMs":300}]}
EOF
t0=$(date +%s)
run_bounded 3 "$TMP/out_stubborn" node runner.mjs "$TMP/m_stubborn.json"
rc=$?
t1=$(date +%s)
[ "$rc" -eq 1 ] || fail
[ "$(sed -n '1p' "$TMP/out_stubborn")" = '{"name":"stubborn","status":"timeout","exitCode":null,"timedOut":true}' ] || fail
[ $(wc -l < "$TMP/out_stubborn" | tr -d ' ') = "2" ] || fail
[ $((t1 - t0)) -le 2 ] || fail

# --- mixed batch: order kept, later tasks still run --------------------------
cat > "$TMP/m_mixed.json" <<EOF
{"tasks":[{"name":"a","command":"node","args":["$TMP/ok.mjs"]},{"name":"b","command":"node","args":["$TMP/hang.mjs"],"timeoutMs":300},{"name":"c","command":"node","args":["$TMP/bad.mjs"]}]}
EOF
run_bounded 4 "$TMP/out_mixed" node runner.mjs "$TMP/m_mixed.json"
rc=$?
[ "$rc" -eq 1 ] || fail
[ "$(sed -n '1p' "$TMP/out_mixed")" = '{"name":"a","status":"ok","exitCode":0,"timedOut":false}' ] || fail
[ "$(sed -n '2p' "$TMP/out_mixed")" = '{"name":"b","status":"timeout","exitCode":null,"timedOut":true}' ] || fail
[ "$(sed -n '3p' "$TMP/out_mixed")" = '{"name":"c","status":"failed","exitCode":3,"timedOut":false}' ] || fail
[ "$(tail -n 1 "$TMP/out_mixed")" = 'SUMMARY ok=1 failed=1 timeout=1' ] || fail

# --- default budget, and invalid budgets fall back to the default ------------
cat > "$TMP/m_default.json" <<EOF
{"defaultTimeoutMs":400,"tasks":[{"name":"inherited","command":"node","args":["$TMP/hang.mjs"]},{"name":"zero","command":"node","args":["$TMP/hang.mjs"],"timeoutMs":0},{"name":"text","command":"node","args":["$TMP/hang.mjs"],"timeoutMs":"soon"}]}
EOF
run_bounded 4 "$TMP/out_default" node runner.mjs "$TMP/m_default.json"
rc=$?
[ "$rc" -eq 1 ] || fail
[ "$(sed -n '1p' "$TMP/out_default")" = '{"name":"inherited","status":"timeout","exitCode":null,"timedOut":true}' ] || fail
[ "$(sed -n '2p' "$TMP/out_default")" = '{"name":"zero","status":"timeout","exitCode":null,"timedOut":true}' ] || fail
[ "$(sed -n '3p' "$TMP/out_default")" = '{"name":"text","status":"timeout","exitCode":null,"timedOut":true}' ] || fail
[ "$(tail -n 1 "$TMP/out_default")" = 'SUMMARY ok=0 failed=0 timeout=3' ] || fail

# --- a command that cannot even start ---------------------------------------
cat > "$TMP/m_ghost.json" <<EOF
{"tasks":[{"name":"ghost","command":"definitely-not-a-real-binary-xyz","args":[]}]}
EOF
run_bounded 3 "$TMP/out_ghost" node runner.mjs "$TMP/m_ghost.json"
rc=$?
[ "$rc" -eq 1 ] || fail
[ "$(sed -n '1p' "$TMP/out_ghost")" = '{"name":"ghost","status":"failed","exitCode":null,"timedOut":false}' ] || fail
[ "$(tail -n 1 "$TMP/out_ghost")" = 'SUMMARY ok=0 failed=1 timeout=0' ] || fail

# --- empty task list ---------------------------------------------------------
printf '{"tasks":[]}' > "$TMP/m_empty.json"
run_bounded 3 "$TMP/out_empty" node runner.mjs "$TMP/m_empty.json"
rc=$?
[ "$rc" -eq 0 ] || fail
[ "$(tail -n 1 "$TMP/out_empty")" = 'SUMMARY ok=0 failed=0 timeout=0' ] || fail

# --- broken or missing manifests --------------------------------------------
run_bounded 3 "$TMP/out_noargs" node runner.mjs
rc=$?
[ "$rc" -eq 2 ] || fail
grep -Fq 'SUMMARY' "$TMP/out_noargs" && fail

run_bounded 3 "$TMP/out_missing" node runner.mjs "$TMP/does-not-exist.json"
rc=$?
[ "$rc" -eq 2 ] || fail

echo 'not json at all' > "$TMP/broken.json"
run_bounded 3 "$TMP/out_broken" node runner.mjs "$TMP/broken.json"
rc=$?
[ "$rc" -eq 2 ] || fail

printf '{"tasks":"nope"}' > "$TMP/shape.json"
run_bounded 3 "$TMP/out_shape" node runner.mjs "$TMP/shape.json"
rc=$?
[ "$rc" -eq 2 ] || fail

echo "VERDICT: PASS"
exit 0
