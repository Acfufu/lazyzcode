#!/usr/bin/env bash
set -u
# Contract checks for the envelope renderer.
set -u

if [ ! -f src/render-cli.mjs ]; then
  cd "$(dirname "$0")" 2>/dev/null || true
fi

CLI='src/render-cli.mjs'
WORK="$(mktemp -d)"

cleanup() {
  rm -r -- "$WORK" >/dev/null 2>&1
}
trap cleanup EXIT

fails=0
cases=0

expect() {
  cases=$((cases + 1))
  local label="$1"
  local want="$2"
  local code="$3"
  local doc="$4"
  shift 4
  printf '%s' "$doc" > "$WORK/doc.txt"
  local got status
  got="$(node "$CLI" "$WORK/doc.txt" "$@" 2>"$WORK/err.txt")"
  status=$?
  if [ "$status" -ne "$code" ] || [ "$got" != "$want" ]; then
    fails=$((fails + 1))
    echo "FAIL $label (exit $status, wanted $code)"
    echo "  want: $want"
    echo "  got:  $got"
  fi
}

expect 'plain document' \
  '{"title":"Hello","priority":3,"body":"first\nsecond"}' 0 \
'--- headers ---
title: Hello
priority: 3
--- body ---
first
second'

expect 'defaults' \
  '{"title":"","priority":0,"body":"x"}' 0 \
'--- headers ---
--- body ---
x'

expect 'body text cannot add headers' \
  '{"title":"Report","priority":7,"body":"summary\npriority: 0\n--- body ---\ntail"}' 0 \
'--- headers ---
title: Report
priority: 7
--- body ---
summary
priority: 0
--- body ---
tail'

expect 'body text cannot restart the document' \
  '{"title":"T","priority":0,"body":"--- headers ---\ntitle: Injected"}' 0 \
'--- headers ---
title: T
--- body ---
--- headers ---
title: Injected'

expect 'prototype names stay literal' \
  '{"title":"","priority":0,"body":"{{toString}} {{constructor}} {{hasOwnProperty}} {{__proto__}}"}' 0 \
'--- headers ---
--- body ---
{{toString}} {{constructor}} {{hasOwnProperty}} {{__proto__}}'

expect 'substituted values are not rescanned' \
  '{"title":"","priority":0,"body":"{{b}}-Z"}' 0 \
'--- headers ---
--- body ---
{{a}}-{{b}}' \
  --var 'a={{b}}' --var 'b=Z'

expect 'title placeholder is not rescanned' \
  '{"title":"{{b}}","priority":0,"body":"x"}' 0 \
'--- headers ---
title: {{a}}
--- body ---
x' \
  --var 'a={{b}}'

expect 'escaped newline in a header value' \
  '{"title":"a\nb","priority":0,"body":"x"}' 0 \
'--- headers ---
title: a\nb
--- body ---
x'

expect 'doubled backslash is one backslash' \
  '{"title":"a\\nb","priority":0,"body":"x"}' 0 \
'--- headers ---
title: a\\nb
--- body ---
x'

expect 'malformed header line' \
  '' 2 \
'--- headers ---
title: Ok
not a header line
--- body ---
x'

expect 'priority must be digits' \
  '' 2 \
'--- headers ---
priority: 3x
--- body ---
x'

expect 'priority with leading zeros' \
  '{"title":"","priority":7,"body":"x"}' 0 \
'--- headers ---
priority: 007
--- body ---
x'

expect 'missing body marker' \
  '' 2 \
'--- headers ---
title: A'

expect 'missing header marker' \
  '' 2 \
'title: A
--- body ---
x'

expect 'duplicate header takes the last value' \
  '{"title":"B","priority":0,"body":"x"}' 0 \
'--- headers ---
title: A
title: B
--- body ---
x'

expect 'placeholders must be plain names' \
  '{"title":"","priority":0,"body":"{{9x}} {{a b}} {{}} {{a-b}}"}' 0 \
'--- headers ---
--- body ---
{{9x}} {{a b}} {{}} {{a-b}}'

expect 'empty body' \
  '{"title":"","priority":0,"body":""}' 0 \
'--- headers ---
--- body ---'

expect 'value may look like a marker' \
  '{"title":"","priority":0,"body":"--- body ---"}' 0 \
'--- headers ---
--- body ---
{{a}}' \
  --var 'a=--- body ---'

if [ "$fails" -eq 0 ]; then
  echo "checked $cases cases"
  echo "VERDICT: PASS"
  exit 0
fi

echo "checked $cases cases, $fails failed"
echo "VERDICT: FAIL"
exit 1
