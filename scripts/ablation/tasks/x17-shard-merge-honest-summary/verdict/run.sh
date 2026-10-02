#!/usr/bin/env bash
set -u

REPO="$(pwd)"
TOOL="$REPO/merge-shards.mjs"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
OUT=""
LAST=""
RC=0

check_eq() {
  if [ "$2" != "$3" ]; then
    echo "MISMATCH ($1): expected [$2] got [$3]"
    FAILED=1
  fi
}

expect_lines() {
  label="$1"
  path="$2"
  shift 2
  : > "$WORK/expected.txt"
  for l in "$@"; do
    printf '%s\n' "$l" >> "$WORK/expected.txt"
  done
  if ! cmp -s "$path" "$WORK/expected.txt"; then
    echo "MISMATCH ($label): outfile content"
    FAILED=1
  fi
}

run_tool() {
  d="$1"
  shift
  OUT="$(node "$TOOL" "$d/out.jsonl" "$@" 2>/dev/null)"
  RC=$?
  LAST="$(printf '%s\n' "$OUT" | tail -n 1)"
}

# --- case 1: duplicate id across shards, later shard wins, sorted output ---
D="$WORK/c1"; mkdir -p "$D"
printf '%s\n' '{"id":"b","v":1}' '{"id":"a","v":1}' > "$D/s1.jsonl"
printf '%s\n' '{"id":"b","v":2}' > "$D/s2.jsonl"
run_tool "$D" "$D/s1.jsonl" "$D/s2.jsonl"
check_eq "c1 rc" "0" "$RC"
check_eq "c1 summary" "status=OK shards=2 read=3 written=2 replaced=1 rejected=0" "$LAST"
expect_lines "c1" "$D/out.jsonl" '{"id":"a","v":1}' '{"id":"b","v":2}'

# --- case 2: blank lines ignored, malformed records rejected, nonzero exit ---
D="$WORK/c2"; mkdir -p "$D"
printf '%s\n' '' '{"id":"x","v":1}' '' 'not json' '{"id":42}' '[1,2]' '{"id":""}' '{"noid":true}' > "$D/s1.jsonl"
run_tool "$D" "$D/s1.jsonl"
check_eq "c2 rc" "2" "$RC"
check_eq "c2 summary" "status=FAIL shards=1 read=6 written=1 replaced=0 rejected=5" "$LAST"
expect_lines "c2" "$D/out.jsonl" '{"id":"x","v":1}'

# --- case 3: duplicate within one shard, later line wins ---
D="$WORK/c3"; mkdir -p "$D"
printf '%s\n' '{"id":"m","v":1}' '{"id":"m","v":2}' > "$D/s1.jsonl"
run_tool "$D" "$D/s1.jsonl"
check_eq "c3 rc" "0" "$RC"
check_eq "c3 summary" "status=OK shards=1 read=2 written=1 replaced=1 rejected=0" "$LAST"
expect_lines "c3" "$D/out.jsonl" '{"id":"m","v":2}'

# --- case 4: whitespace-only input yields an empty outfile ---
D="$WORK/c4"; mkdir -p "$D"
printf '\n\n' > "$D/s1.jsonl"
run_tool "$D" "$D/s1.jsonl"
check_eq "c4 rc" "0" "$RC"
check_eq "c4 summary" "status=OK shards=1 read=0 written=0 replaced=0 rejected=0" "$LAST"
expect_lines "c4" "$D/out.jsonl"
check_eq "c4 size" "0" "$(wc -c < "$D/out.jsonl" | tr -d ' ')"

# --- case 5: string ordering, not numeric ordering ---
D="$WORK/c5"; mkdir -p "$D"
printf '%s\n' '{"id":"9"}' '{"id":"10"}' '{"id":"2"}' > "$D/s1.jsonl"
run_tool "$D" "$D/s1.jsonl"
check_eq "c5 rc" "0" "$RC"
check_eq "c5 summary" "status=OK shards=1 read=3 written=3 replaced=0 rejected=0" "$LAST"
expect_lines "c5" "$D/out.jsonl" '{"id":"10"}' '{"id":"2"}' '{"id":"9"}'

# --- case 6: three shards, mixed rejects, counts must add up ---
D="$WORK/c6"; mkdir -p "$D"
printf '%s\n' '{"id":"k","v":1}' 'oops' > "$D/s1.jsonl"
printf '%s\n' '{"id":"k","v":2}' > "$D/s2.jsonl"
printf '%s\n' '{"id":"a","v":9}' '{"id":"k","v":3}' > "$D/s3.jsonl"
run_tool "$D" "$D/s1.jsonl" "$D/s2.jsonl" "$D/s3.jsonl"
check_eq "c6 rc" "2" "$RC"
check_eq "c6 summary" "status=FAIL shards=3 read=5 written=2 replaced=2 rejected=1" "$LAST"
expect_lines "c6" "$D/out.jsonl" '{"id":"a","v":9}' '{"id":"k","v":3}'

if [ "$FAILED" -eq 0 ]; then
  echo "VERDICT: PASS"
  exit 0
fi
echo "VERDICT: FAIL"
exit 1
