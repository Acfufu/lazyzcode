#!/usr/bin/env bash
set -u

ROOT="$(pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "VERDICT: FAIL"
  exit 1
}

cat > "$TMP/canon.cjs" <<'CANON'
const fs = require('fs');
const raw = fs.readFileSync(0, 'utf8');
const value = JSON.parse(raw);
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}
process.stdout.write(JSON.stringify(canon(value)));
CANON

rec() {
  printf '{"id":"%s","lane":"%s","ms":%s,"status":"%s"}\n' "$2" "$3" "$4" "$5" > "$1"
}

mkdir -p "$TMP/a"
rec "$TMP/a/01.json" r-b Zeta 100 ok
rec "$TMP/a/02.json" r-a Zeta 100 fail
rec "$TMP/a/03.json" r-c alpha 20 ok
rec "$TMP/a/04.json" r-d alpha 120 fail
rec "$TMP/a/05.json" r-e alpha 20 ok
printf 'not a record\n' > "$TMP/a/notes.txt"

mkdir -p "$TMP/b"
rec "$TMP/b/w5.json" r-e alpha 20 ok
rec "$TMP/b/w4.json" r-d alpha 120 fail
rec "$TMP/b/w3.json" r-c alpha 20 ok
rec "$TMP/b/w2.json" r-a Zeta 100 fail
rec "$TMP/b/w1.json" r-b Zeta 100 ok

cat > "$TMP/expected.json" <<'EXP'
{"version":1,"lanes":[{"lane":"Zeta","runs":2,"ok":1,"failed":1,"totalMs":200,"order":["r-a","r-b"]},{"lane":"alpha","runs":3,"ok":2,"failed":1,"totalMs":160,"order":["r-d","r-c","r-e"]}]}
EXP

EXPECTED="$(node "$TMP/canon.cjs" < "$TMP/expected.json")" || fail
if [ -z "$EXPECTED" ]; then fail; fi

check_output() {
  got="$(node "$TMP/canon.cjs" < "$1")" || fail
  if [ "$got" != "$EXPECTED" ]; then fail; fi
}

if ! node "$ROOT/src/cli.mjs" "$TMP/a" > "$TMP/out1.json" 2> "$TMP/err.txt"; then fail; fi
check_output "$TMP/out1.json"

if ! node "$ROOT/src/cli.mjs" "$TMP/a" > "$TMP/out2.json" 2> "$TMP/err.txt"; then fail; fi
check_output "$TMP/out2.json"

if ! node "$ROOT/src/cli.mjs" "$TMP/b" > "$TMP/out3.json" 2> "$TMP/err.txt"; then fail; fi
check_output "$TMP/out3.json"

if ! TZ=Pacific/Kiritimati LC_ALL=C LANG=C node "$ROOT/src/cli.mjs" "$TMP/b" > "$TMP/out4.json" 2> "$TMP/err.txt"; then fail; fi
check_output "$TMP/out4.json"

if ! TZ=America/New_York LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 node "$ROOT/src/cli.mjs" "$TMP/a" > "$TMP/out5.json" 2> "$TMP/err.txt"; then fail; fi
check_output "$TMP/out5.json"

if ! TZ=Europe/Berlin LC_ALL=tr_TR.UTF-8 LANG=tr_TR.UTF-8 node "$ROOT/src/cli.mjs" "$TMP/a" > "$TMP/out6.json" 2> "$TMP/err.txt"; then fail; fi
check_output "$TMP/out6.json"

echo "VERDICT: PASS"
exit 0
