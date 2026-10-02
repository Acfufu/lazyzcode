#!/usr/bin/env bash
set -u

ROOT="$(pwd)"
CLI="$ROOT/src/cli.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "VERDICT: FAIL"; exit 1; }

[ -f "$CLI" ] || fail

mk_source() {
  : > "$1"
  i=0
  while [ "$i" -lt "$2" ]; do
    printf '{"key":"k%s","value":%s}\n' "$i" "$i" >> "$1"
    i=$((i + 1))
  done
}

expected_for() {
  SRC="$1" DST="$2" node --input-type=module -e '
import fs from "node:fs";
const items = fs.readFileSync(process.env.SRC, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
const lines = items.map((item) => {
  const value = Number(item.value);
  return JSON.stringify({ key: item.key, value: value, parity: value % 2 === 0 ? "even" : "odd", square: value * value });
});
fs.writeFileSync(process.env.DST, lines.length ? lines.join("\n") + "\n" : "");
' >/dev/null 2>&1
}

expect_equal() {
  expected_for "$1" "$TMP/expected.out" || fail
  cmp -s "$2" "$TMP/expected.out" || fail
}

run_ok() {
  node "$CLI" --source "$1" --out "$2" --state "$3" >/dev/null 2>&1
}

run_cancel() {
  CANCEL_AFTER="$4" node "$CLI" --source "$1" --out "$2" --state "$3" >/dev/null 2>&1
}

D="$TMP/s1"; mkdir -p "$D"
mk_source "$D/source.jsonl" 12
run_ok "$D/source.jsonl" "$D/out.jsonl" "$D/state.json"; [ $? -eq 0 ] || fail
expect_equal "$D/source.jsonl" "$D/out.jsonl"
run_ok "$D/source.jsonl" "$D/out.jsonl" "$D/state.json"; [ $? -eq 0 ] || fail
expect_equal "$D/source.jsonl" "$D/out.jsonl"

D="$TMP/s2"; mkdir -p "$D"
mk_source "$D/source.jsonl" 12
mk_source "$D/head.jsonl" 7
run_cancel "$D/source.jsonl" "$D/out.jsonl" "$D/state.json" 7; [ $? -eq 70 ] || fail
expect_equal "$D/head.jsonl" "$D/out.jsonl"
run_ok "$D/source.jsonl" "$D/out.jsonl" "$D/state.json"; [ $? -eq 0 ] || fail
expect_equal "$D/source.jsonl" "$D/out.jsonl"

D="$TMP/s3"; mkdir -p "$D"
mk_source "$D/source.jsonl" 12
run_cancel "$D/source.jsonl" "$D/out.jsonl" "$D/state.json" 1; [ $? -eq 70 ] || fail
run_ok "$D/source.jsonl" "$D/out.jsonl" "$D/state.json"; [ $? -eq 0 ] || fail
expect_equal "$D/source.jsonl" "$D/out.jsonl"

D="$TMP/s4"; mkdir -p "$D"
mk_source "$D/source.jsonl" 12
run_cancel "$D/source.jsonl" "$D/out.jsonl" "$D/state.json" 12; [ $? -eq 70 ] || fail
expect_equal "$D/source.jsonl" "$D/out.jsonl"
run_ok "$D/source.jsonl" "$D/out.jsonl" "$D/state.json"; [ $? -eq 0 ] || fail
expect_equal "$D/source.jsonl" "$D/out.jsonl"

D="$TMP/s5"; mkdir -p "$D"
mk_source "$D/source.jsonl" 12
run_cancel "$D/source.jsonl" "$D/out.jsonl" "$D/state.json" 3; [ $? -eq 70 ] || fail
run_cancel "$D/source.jsonl" "$D/out.jsonl" "$D/state.json" 3; [ $? -eq 70 ] || fail
run_cancel "$D/source.jsonl" "$D/out.jsonl" "$D/state.json" 4; [ $? -eq 70 ] || fail
run_ok "$D/source.jsonl" "$D/out.jsonl" "$D/state.json"; [ $? -eq 0 ] || fail
expect_equal "$D/source.jsonl" "$D/out.jsonl"

D="$TMP/s6"; mkdir -p "$D"
mk_source "$D/source.jsonl" 1
run_cancel "$D/source.jsonl" "$D/out.jsonl" "$D/state.json" 1; [ $? -eq 70 ] || fail
run_ok "$D/source.jsonl" "$D/out.jsonl" "$D/state.json"; [ $? -eq 0 ] || fail
expect_equal "$D/source.jsonl" "$D/out.jsonl"

D="$TMP/s7"; mkdir -p "$D"
: > "$D/source.jsonl"
run_ok "$D/source.jsonl" "$D/out.jsonl" "$D/state.json"; [ $? -eq 0 ] || fail
if [ -f "$D/out.jsonl" ]; then [ ! -s "$D/out.jsonl" ] || fail; fi
run_ok "$D/source.jsonl" "$D/out.jsonl" "$D/state.json"; [ $? -eq 0 ] || fail

D="$TMP/s8"; mkdir -p "$D"
mk_source "$D/source.jsonl" 12
run_cancel "$D/source.jsonl" "$D/out.jsonl" "$D/state.json" 5; [ $? -eq 70 ] || fail
rm -f "$D/state.json"
run_ok "$D/source.jsonl" "$D/out.jsonl" "$D/state.json"; [ $? -eq 0 ] || fail
expect_equal "$D/source.jsonl" "$D/out.jsonl"

D="$TMP/s9"; mkdir -p "$D"
mk_source "$D/source.jsonl" 12
run_ok "$D/source.jsonl" "$D/out.jsonl" "$D/state.json"; [ $? -eq 0 ] || fail
expect_equal "$D/source.jsonl" "$D/out.jsonl"
printf 'this is not valid bookkeeping\n' > "$D/state.json"
run_ok "$D/source.jsonl" "$D/out.jsonl" "$D/state.json"; [ $? -ne 0 ] || fail
expect_equal "$D/source.jsonl" "$D/out.jsonl"

D="$TMP/s10"; mkdir -p "$D"
mk_source "$D/source.jsonl" 12
run_ok "$D/source.jsonl" "$D/out.jsonl" "$D/state.json"; [ $? -eq 0 ] || fail
expect_equal "$D/source.jsonl" "$D/out.jsonl"
: > "$D/out.jsonl"
run_ok "$D/source.jsonl" "$D/out.jsonl" "$D/state.json"; [ $? -ne 0 ] || fail
[ ! -s "$D/out.jsonl" ] || fail

echo "VERDICT: PASS"
exit 0
