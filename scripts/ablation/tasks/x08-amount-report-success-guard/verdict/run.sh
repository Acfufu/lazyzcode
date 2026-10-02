#!/usr/bin/env bash
set -u

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAILS=0

fail() {
  echo "FAIL: $1"
  FAILS=$((FAILS + 1))
}

check() {
  local label="$1"
  local ecode="$2"
  local eout="$3"
  local csv="$4"
  printf '%s' "$csv" > "$WORK/in.csv"
  node src/cli.mjs "$WORK/in.csv" > "$WORK/got.txt" 2>&1
  local code=$?
  if [ "$code" != "$ecode" ]; then
    fail "$label: exit code $code, wanted $ecode"
    sed 's/^/      /' "$WORK/got.txt"
    return 0
  fi
  printf '%s' "$eout" > "$WORK/want.txt"
  if ! cmp -s "$WORK/want.txt" "$WORK/got.txt"; then
    fail "$label: output mismatch"
    sed 's/^/      /' "$WORK/got.txt"
  fi
  return 0
}

check "happy path" 0 $'books 2 1000\ntoys 1 300\nSUCCESS rows=3 groups=2 total=1300\n' $'id,category,amount\nr2,toys,300\nr1,books,1200\nr3,books,-200\n'

check "blank lines skipped" 0 $'alpha 1 5\nbeta 1 7\nSUCCESS rows=2 groups=2 total=12\n' $'id,category,amount\n\na,alpha,5\n\nb,beta,7\n'

check "blank line keeps numbering" 2 $'ERROR line 4: bad amount\n' $'id,category,amount\na,alpha,5\n\nb,beta,xx\n'

check "duplicate id" 2 $'ERROR line 4: duplicate id\n' $'id,category,amount\na,alpha,5\nb,beta,7\na,alpha,9\n'

check "empty id" 2 $'ERROR line 2: empty id\n' $'id,category,amount\n,alpha,5\n'

check "empty category" 2 $'ERROR line 2: empty category\n' $'id,category,amount\na,,5\n'

check "two fields" 2 $'ERROR line 2: bad field count\n' $'id,category,amount\na,alpha\n'

check "four fields" 2 $'ERROR line 2: bad field count\n' $'id,category,amount\na,alpha,5,6\n'

check "space only line" 2 $'ERROR line 3: bad field count\n' $'id,category,amount\na,alpha,5\n   \n'

for tok in '1e3' '0x10' '5.0' '+5' '.5' 'abc' '-' ' 5' '5 ' ''; do
  check "amount [$tok]" 2 $'ERROR line 2: bad amount\n' "$(printf 'id,category,amount\na,alpha,%s\n' "$tok")"
done

check "large integers" 0 $'big 2 18014398509481986\nSUCCESS rows=2 groups=1 total=18014398509481986\n' $'id,category,amount\nk1,big,9007199254740993\nk2,big,9007199254740993\n'

check "negative total" 0 $'refunds 2 -750\nSUCCESS rows=2 groups=1 total=-750\n' $'id,category,amount\nn1,refunds,-500\nn2,refunds,-250\n'

check "no final newline" 0 $'alpha 1 5\nSUCCESS rows=1 groups=1 total=5\n' $'id,category,amount\na,alpha,5'

check "header only" 0 $'SUCCESS rows=0 groups=0 total=0\n' $'id,category,amount\n'

check "header only no newline" 0 $'SUCCESS rows=0 groups=0 total=0\n' 'id,category,amount'

check "empty file" 2 $'ERROR line 1: bad header\n' ''

check "wrong header" 2 $'ERROR line 1: bad header\n' $'Id,category,amount\na,alpha,5\n'

check "blank lines only" 0 $'SUCCESS rows=0 groups=0 total=0\n' $'id,category,amount\n\n\n'

check "code unit order" 0 $'B 1 2\n_x 1 3\nb 1 1\nSUCCESS rows=3 groups=3 total=6\n' $'id,category,amount\na,b,1\nc,B,2\nd,_x,3\n'

check "spaced category" 0 $'new york 1 50\nSUCCESS rows=1 groups=1 total=50\n' $'id,category,amount\na,new york,50\n'

node src/cli.mjs "$WORK/missing.csv" > "$WORK/got.txt" 2>&1
code=$?
if [ "$code" != 2 ]; then
  fail "missing file: exit code $code"
fi
printf 'ERROR file: cannot read %s\n' "$WORK/missing.csv" > "$WORK/want.txt"
if ! cmp -s "$WORK/want.txt" "$WORK/got.txt"; then
  fail "missing file: output mismatch"
  sed 's/^/      /' "$WORK/got.txt"
fi

node src/cli.mjs > "$WORK/got.txt" 2>&1
code=$?
if [ "$code" != 2 ]; then
  fail "no argument: exit code $code"
fi
printf 'ERROR usage: expected <file> argument\n' > "$WORK/want.txt"
if ! cmp -s "$WORK/want.txt" "$WORK/got.txt"; then
  fail "no argument: output mismatch"
  sed 's/^/      /' "$WORK/got.txt"
fi

if [ "$FAILS" -gt 0 ]; then
  echo "VERDICT: FAIL"
  exit 1
fi
echo "VERDICT: PASS"
exit 0
