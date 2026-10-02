#!/usr/bin/env bash
set -u
# Full contract check for the batch ingest CLI. Read-only; run from the repository root.
set -u

CLI="bin/ingest-batch.mjs"
failures=0

note() { echo "FAIL: $1"; failures=$((failures + 1)); }

if [ ! -f "$CLI" ]; then
  note "missing $CLI"
  echo "VERDICT: FAIL"
  exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/ingest-full.XXXXXX")" || { echo "VERDICT: FAIL"; exit 1; }
trap 'rm -rf "$WORK"' EXIT

OUT=""
CODE=0

run_cli() {
  node "$CLI" "$1" "$2" >"$WORK/stdout.txt" 2>"$WORK/stderr.txt"
  CODE=$?
  OUT="$(cat "$WORK/stdout.txt")"
}

summary_fields() {
  node -e 'const o = JSON.parse(process.argv[1]); process.stdout.write([o.ok, o.written, o.rejected].join("|"));' "$1" 2>/dev/null || printf 'PARSE_ERROR'
}

check_summary() { # label, expected "ok|written|rejected", expected exit code
  if [ "$CODE" -ne "$3" ]; then
    note "$1: exit code $CODE, expected $3"
    return
  fi
  local got
  got="$(summary_fields "$OUT")"
  if [ "$got" != "$2" ]; then
    note "$1: summary $got, expected $2"
  fi
}

check_single_line() {
  local n
  n="$(awk 'END { print NR }' "$WORK/stdout.txt")"
  if [ "$n" -ne 1 ]; then
    note "$1: stdout has $n line(s), expected exactly 1"
  fi
}

count_files() {
  find "$1" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' '
}

check_no_files() { # label, dir
  if [ -d "$2" ]; then
    local n
    n="$(count_files "$2")"
    if [ "$n" -ne 0 ]; then
      note "$1: output directory holds $n entr(ies), expected none"
    fi
  fi
}

# --- 1. valid LF batch: blank record ignored, colon inside a name kept
printf 'id: a1\nname: Hello: world\nqty: 0\n---\n---\nid: b-2\nname: Two\nqty: 1000000\n' > "$WORK/in1.txt"
rm -rf "$WORK/out1"
run_cli "$WORK/in1.txt" "$WORK/out1"
check_summary "valid-lf" "true|2|0" 0
check_single_line "valid-lf"
printf '{"id":"a1","name":"Hello: world","qty":0}\n' > "$WORK/exp1a"
printf '{"id":"b-2","name":"Two","qty":1000000}\n' > "$WORK/exp1b"
if [ -f "$WORK/out1/a1.json" ]; then
  cmp -s "$WORK/exp1a" "$WORK/out1/a1.json" || note "valid-lf: a1.json content is wrong"
else
  note "valid-lf: a1.json is missing"
fi
if [ -f "$WORK/out1/b-2.json" ]; then
  cmp -s "$WORK/exp1b" "$WORK/out1/b-2.json" || note "valid-lf: b-2.json content is wrong"
else
  note "valid-lf: b-2.json is missing"
fi
if [ "$(count_files "$WORK/out1")" != "2" ]; then
  note "valid-lf: expected exactly 2 output files"
fi

# --- 2. CRLF line endings
printf 'id: c1\r\nname: CR line\r\nqty: 7\r\n---\r\nid: d1\r\nname: Other\r\nqty: 8\r\n' > "$WORK/in2.txt"
rm -rf "$WORK/out2"
run_cli "$WORK/in2.txt" "$WORK/out2"
check_summary "crlf" "true|2|0" 0
printf '{"id":"c1","name":"CR line","qty":7}\n' > "$WORK/exp2"
if [ -f "$WORK/out2/c1.json" ]; then
  cmp -s "$WORK/exp2" "$WORK/out2/c1.json" || note "crlf: c1.json content is wrong"
else
  note "crlf: c1.json is missing"
fi

# --- 3. unknown key
printf 'id: e1\nname: E\nqty: 1\nweight: 5\n' > "$WORK/in3.txt"
rm -rf "$WORK/out3"
run_cli "$WORK/in3.txt" "$WORK/out3"
check_summary "unknown-key" "false|0|1" 1
check_no_files "unknown-key" "$WORK/out3"

# --- 4. duplicate ids: no partial output at all
printf 'id: dup\nname: One\nqty: 1\n---\nid: dup\nname: Two\nqty: 2\n' > "$WORK/in4.txt"
rm -rf "$WORK/out4"
run_cli "$WORK/in4.txt" "$WORK/out4"
check_summary "duplicate-id" "false|0|1" 1
check_no_files "duplicate-id" "$WORK/out4"

# --- 5. name edges
printf 'id: f1\nname: padded \nqty: 1\n' > "$WORK/in5a.txt"
rm -rf "$WORK/out5a"
run_cli "$WORK/in5a.txt" "$WORK/out5a"
check_summary "name-trailing-space" "false|0|1" 1
node -e 'process.stdout.write("id: f2\nname: " + "z".repeat(65) + "\nqty: 1\n")' > "$WORK/in5b.txt"
rm -rf "$WORK/out5b"
run_cli "$WORK/in5b.txt" "$WORK/out5b"
check_summary "name-too-long" "false|0|1" 1

# --- 6. qty range
printf 'id: g1\nname: G\nqty: 1000001\n' > "$WORK/in6a.txt"
rm -rf "$WORK/out6a"
run_cli "$WORK/in6a.txt" "$WORK/out6a"
check_summary "qty-too-large" "false|0|1" 1
printf 'id: g2\nname: G\nqty: 12345678\n' > "$WORK/in6b.txt"
rm -rf "$WORK/out6b"
run_cli "$WORK/in6b.txt" "$WORK/out6b"
check_summary "qty-eight-digits" "false|0|1" 1

# --- 7. three broken records, all of them counted
printf 'id: h1\nname: H\n---\nid i1\nname: I\nqty: 1\n---\nid: j1\nid: j2\nname: J\nqty: 1\n' > "$WORK/in7.txt"
rm -rf "$WORK/out7"
run_cli "$WORK/in7.txt" "$WORK/out7"
check_summary "three-broken" "false|0|3" 1
check_no_files "three-broken" "$WORK/out7"

# --- 8. uppercase id
printf 'id: ABC\nname: Upper\nqty: 1\n' > "$WORK/in8.txt"
rm -rf "$WORK/out8"
run_cli "$WORK/in8.txt" "$WORK/out8"
check_summary "uppercase-id" "false|0|1" 1

# --- 9. an existing output directory is left untouched by a failed run
mkdir -p "$WORK/out9"
printf 'old\n' > "$WORK/out9/old.txt"
printf 'id: k1\nname: K\nqty: 9999999\n' > "$WORK/in9.txt"
run_cli "$WORK/in9.txt" "$WORK/out9"
check_summary "existing-out-dir" "false|0|1" 1
if [ ! -f "$WORK/out9/old.txt" ]; then
  note "existing-out-dir: pre-existing file was removed"
fi
if [ "$(count_files "$WORK/out9")" != "1" ]; then
  note "existing-out-dir: directory contents changed"
fi

# --- 10. empty input
: > "$WORK/in10.txt"
rm -rf "$WORK/out10"
run_cli "$WORK/in10.txt" "$WORK/out10"
check_summary "empty-input" "true|0|0" 0
if [ ! -d "$WORK/out10" ]; then
  note "empty-input: output directory was not created"
elif [ "$(count_files "$WORK/out10")" != "0" ]; then
  note "empty-input: unexpected files in output directory"
fi

# --- 11. usage errors
node "$CLI" >"$WORK/stdout.txt" 2>"$WORK/stderr.txt"
CODE=$?
if [ "$CODE" -ne 2 ]; then note "no-arguments: exit code $CODE, expected 2"; fi
node "$CLI" "$WORK/does-not-exist.txt" "$WORK/out11" >"$WORK/stdout.txt" 2>"$WORK/stderr.txt"
CODE=$?
if [ "$CODE" -ne 2 ]; then note "unreadable-input: exit code $CODE, expected 2"; fi

if [ "$failures" -eq 0 ]; then
  echo "VERDICT: PASS"
  exit 0
fi
echo "VERDICT: FAIL"
exit 1
