#!/usr/bin/env bash
set -u

fail() {
  echo "VERDICT: FAIL"
  echo "detail: $1" >&2
  exit 1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

node src/report.mjs data > "$TMP/run1.txt" 2>"$TMP/err1.txt" || fail "run on data/ exited nonzero"
node src/report.mjs data > "$TMP/run2.txt" 2>"$TMP/err2.txt" || fail "second run on data/ exited nonzero"
cmp -s "$TMP/run1.txt" "$TMP/run2.txt" || fail "repeated runs on data/ differ"

printf '%s\n' \
  'REPORT' \
  'runs: 2' \
  'latest: 2024-05-03T08:30:00Z' \
  'tests: 4' \
  '--' \
  'db/migrate 1 900.00 900.00' \
  'auth/login 2 200.00 100.00' \
  'auth/logout 1 40.25 40.25' \
  'cache/warm 1 12.75 12.75' > "$TMP/data-expected.txt"

cmp -s "$TMP/run1.txt" "$TMP/data-expected.txt" || fail "report for data/ does not match the contract"

TZ=Asia/Kolkata node src/report.mjs data > "$TMP/tz1.txt" 2>/dev/null || fail "run under a non-UTC timezone exited nonzero"
cmp -s "$TMP/run1.txt" "$TMP/tz1.txt" || fail "output changes with the timezone"

TZ=Pacific/Kiritimati node src/report.mjs data > "$TMP/tz2.txt" 2>/dev/null || fail "run under a second timezone exited nonzero"
cmp -s "$TMP/run1.txt" "$TMP/tz2.txt" || fail "output changes with a second timezone"

SHARD_ONE='{"run":"2024-06-01T12:00:00Z","results":[{"test":"suite/alpha","durationMs":1},{"test":"suite/alpha","durationMs":1.01},{"test":"suite/delta","durationMs":0.5},{"test":"suite/delta","durationMs":0.5},{"test":"suite/delta","durationMs":0.5},{"test":"suite/delta","durationMs":0.51}]}'
SHARD_TWO='{"run":"2024-06-02T12:00:00.750Z","results":[{"test":"suite/beta","durationMs":2.01},{"test":"suite/echo","durationMs":2},{"test":"suite/echo","durationMs":0.01},{"test":"suite/gamma","durationMs":5}]}'

mkdir -p "$TMP/tie-a" "$TMP/tie-b"
printf '%s' "$SHARD_ONE" > "$TMP/tie-a/shard-one.json"
printf '%s' "$SHARD_TWO" > "$TMP/tie-a/shard-two.json"
printf '%s' "$SHARD_TWO" > "$TMP/tie-b/shard-two.json"
printf '%s' "$SHARD_ONE" > "$TMP/tie-b/shard-one.json"

printf '%s\n' \
  'REPORT' \
  'runs: 2' \
  'latest: 2024-06-02T12:00:00Z' \
  'tests: 5' \
  '--' \
  'suite/gamma 1 5.00 5.00' \
  'suite/alpha 2 2.01 1.01' \
  'suite/beta 1 2.01 2.01' \
  'suite/delta 4 2.01 0.50' \
  'suite/echo 2 2.01 1.01' > "$TMP/tie-expected.txt"

i=1
while [ "$i" -le 4 ]; do
  node src/report.mjs "$TMP/tie-a" > "$TMP/tie-a-$i.txt" 2>/dev/null || fail "tie fixture run exited nonzero"
  cmp -s "$TMP/tie-a-$i.txt" "$TMP/tie-expected.txt" || fail "tie ordering or cent rounding is wrong"
  i=$((i + 1))
done

node src/report.mjs "$TMP/tie-b" > "$TMP/tie-b.txt" 2>/dev/null || fail "second tie fixture run exited nonzero"
cmp -s "$TMP/tie-b.txt" "$TMP/tie-expected.txt" || fail "output depends on directory entry order"

echo "VERDICT: PASS"
exit 0
