#!/usr/bin/env bash
set -u

WORK="$(mktemp -d "${TMPDIR:-/tmp}/rosterchk.XXXXXX")" || { echo "VERDICT: FAIL"; exit 1; }
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

EXPECT_MAIN="$WORK/expect_main.txt"
cat > "$EXPECT_MAIN" <<'EOF'
ROSTER
S1 Bo 6
S2 Cleo 4
S3 Dana 8
S4 Evan 6
S5 alice 8
S6 UNASSIGNED 0
TOTALS
Bo 6 1
Cleo 4 1
Dana 8 1
Evan 6 1
alice 8 1
EOF

EXPECT_ALT="$WORK/expect_alt.txt"
cat > "$EXPECT_ALT" <<'EOF'
ROSTER
T1 Bob 3
T2 Zed 3
T3 UNASSIGNED 0
TOTALS
Bob 3 1
Zed 3 1
EOF

OUT="$WORK/out.txt"

i=0
while [ "$i" -lt 6 ]; do
  case "$i" in
    0) env -i PATH="$PATH" TZ=UTC node roster.mjs > "$OUT" 2>/dev/null ;;
    1) env TZ=Asia/Tokyo node roster.mjs > "$OUT" 2>/dev/null ;;
    2) env LC_ALL=C LANG=C node roster.mjs > "$OUT" 2>/dev/null ;;
    3) env TZ=America/Denver LC_ALL=C node roster.mjs > "$OUT" 2>/dev/null ;;
    4) env TZ=Pacific/Kiritimati node roster.mjs > "$OUT" 2>/dev/null ;;
    *) node roster.mjs > "$OUT" 2>/dev/null ;;
  esac
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "VERDICT: FAIL"
    exit 1
  fi
  if ! diff -q "$EXPECT_MAIN" "$OUT" > /dev/null 2>&1; then
    echo "VERDICT: FAIL"
    exit 1
  fi
  i=$((i + 1))
done

if ! cp -R . "$WORK/repo" > /dev/null 2>&1; then
  echo "VERDICT: FAIL"
  exit 1
fi

cat > "$WORK/repo/data/staff.json" <<'EOF'
{ "staff": [
  { "name": "Zed", "role": "nurse", "available": true },
  { "name": "amy", "role": "nurse", "available": true },
  { "name": "Bob", "role": "nurse", "available": true }
] }
EOF

cat > "$WORK/repo/data/shifts.json" <<'EOF'
{ "shifts": [
  { "id": "T2", "role": "nurse", "hours": 3 },
  { "id": "T1", "role": "nurse", "hours": 3 },
  { "id": "T3", "role": "tech", "hours": 2 }
] }
EOF

j=0
while [ "$j" -lt 3 ]; do
  case "$j" in
    0) ( cd "$WORK/repo" && env TZ=UTC node roster.mjs ) > "$OUT" 2>/dev/null ;;
    1) ( cd "$WORK/repo" && env LC_ALL=C LANG=C TZ=Asia/Tokyo node roster.mjs ) > "$OUT" 2>/dev/null ;;
    *) ( cd "$WORK/repo" && node roster.mjs ) > "$OUT" 2>/dev/null ;;
  esac
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "VERDICT: FAIL"
    exit 1
  fi
  if ! diff -q "$EXPECT_ALT" "$OUT" > /dev/null 2>&1; then
    echo "VERDICT: FAIL"
    exit 1
  fi
  j=$((j + 1))
done

echo "VERDICT: PASS"
exit 0
