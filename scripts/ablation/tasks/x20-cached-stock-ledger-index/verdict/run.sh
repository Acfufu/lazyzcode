#!/usr/bin/env bash
set -u

ROOT="$(pwd)"
SRC="$ROOT/src/inventory.mjs"

if [ ! -f "$SRC" ]; then
  echo "missing src/inventory.mjs"
  echo "VERDICT: FAIL"
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/harness.mjs" <<'HARNESS'
import { pathToFileURL } from 'node:url';

const fails = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    fails.push(label + ' -> got ' + a + ', want ' + e);
  }
}

function throwsTypeError(fn, label) {
  try {
    fn();
    fails.push(label + ' -> expected a TypeError');
  } catch (err) {
    if (!(err instanceof TypeError)) {
      fails.push(label + ' -> expected a TypeError, got ' + err);
    }
  }
}

let m;
try {
  m = await import(pathToFileURL(process.env.SRC).href);
} catch (err) {
  console.log('module failed to load: ' + (err && err.message));
  process.exit(2);
}

const names = ['createInventory', 'record', 'onHand', 'totalOnHand', 'skuList', 'snapshot'];
for (const name of names) {
  if (typeof m[name] !== 'function') {
    console.log('missing export: ' + name);
    process.exit(2);
  }
}

const createInventory = m.createInventory;
const record = m.record;
const onHand = m.onHand;
const totalOnHand = m.totalOnHand;
const skuList = m.skuList;
const snapshot = m.snapshot;

// 1. an empty index and an unknown sku
{
  const inv = createInventory();
  eq(totalOnHand(inv), 0, 'empty total');
  eq(skuList(inv), [], 'empty list');
  eq(snapshot(inv).revision, 0, 'empty revision');
  eq(onHand(inv, 'ghost'), 0, 'unknown sku reads zero');
  eq(skuList(inv), [], 'reading an unknown sku does not list it');
  eq(snapshot(inv).revision, 0, 'read does not bump revision');
}

// 2. writes after reads
{
  const inv = createInventory();
  record(inv, 'a', 5);
  eq(onHand(inv, 'a'), 5, 'first movement visible');
  record(inv, 'a', -2);
  eq(onHand(inv, 'a'), 3, 'second movement visible');
  eq(totalOnHand(inv), 3, 'total after two movements');
  record(inv, 'b', 4);
  eq(onHand(inv, 'b'), 4, 'new sku visible');
  eq(totalOnHand(inv), 7, 'total after a new sku');
  eq(onHand(inv, 'a'), 3, 'earlier sku unchanged');
  eq(skuList(inv), ['a', 'b'], 'list after a new sku');
  record(inv, 'a', 10);
  eq(totalOnHand(inv), 17, 'total after an existing sku changed');
  eq(skuList(inv), ['a', 'b'], 'list unchanged by quantity change');
}

// 3. zeroed and re-added skus
{
  const inv = createInventory();
  record(inv, 'x', 3);
  record(inv, 'y', 5);
  eq(skuList(inv), ['x', 'y'], 'sorted list');
  record(inv, 'x', -3);
  eq(skuList(inv), ['y'], 'zeroed sku leaves the list');
  eq(totalOnHand(inv), 5, 'total after zeroing');
  eq(onHand(inv, 'x'), 0, 'zeroed sku quantity');
  record(inv, 'x', 1);
  eq(skuList(inv), ['x', 'y'], 're-added sku returns to the list');
  eq(onHand(inv, 'x'), 1, 're-added sku quantity');
  eq(totalOnHand(inv), 6, 'total after re-adding');
}

// 4. results handed to callers are fresh copies
{
  const inv = createInventory();
  record(inv, 'p', 2);
  record(inv, 'q', 7);
  const list = skuList(inv);
  list.push('zzz');
  list.sort();
  eq(skuList(inv), ['p', 'q'], 'skuList result is not aliased');
  const snap = snapshot(inv);
  snap.skus.push('zzz');
  snap.total = 999;
  const again = snapshot(inv);
  eq(again.skus, ['p', 'q'], 'snapshot skus are not aliased');
  eq(again.total, 9, 'snapshot total');
  eq(again.revision, 2, 'snapshot revision');
}

// 5. rejected movements leave no trace
{
  const inv = createInventory();
  record(inv, 'a', 4);
  eq(snapshot(inv).revision, 1, 'revision counts accepted movements');
  throwsTypeError(function () { record(inv, 'a', 1.5); }, 'fractional delta');
  throwsTypeError(function () { record(inv, 'a', NaN); }, 'NaN delta');
  throwsTypeError(function () { record(inv, 'a', '3'); }, 'string delta');
  throwsTypeError(function () { record(inv, '', 1); }, 'empty sku');
  throwsTypeError(function () { record(inv, 42, 1); }, 'non-string sku');
  eq(onHand(inv, 'a'), 4, 'quantity untouched by rejected calls');
  eq(totalOnHand(inv), 4, 'total untouched by rejected calls');
  eq(skuList(inv), ['a'], 'list untouched by rejected calls');
  eq(snapshot(inv).revision, 1, 'revision untouched by rejected calls');
}

// 6. two indexes are independent
{
  const a = createInventory();
  const b = createInventory();
  record(a, 'k', 3);
  eq(totalOnHand(b), 0, 'second index total');
  eq(skuList(b), [], 'second index list');
  eq(onHand(b, 'k'), 0, 'second index unknown sku');
  eq(snapshot(b).revision, 0, 'second index revision');
  record(b, 'k', 1);
  eq(onHand(a, 'k'), 3, 'first index unaffected');
  eq(onHand(b, 'k'), 1, 'second index value');
}

// 7. interleaved reads and writes
{
  const inv = createInventory();
  const seq = [['m', 5], ['n', 2], ['m', -1], ['o', 7], ['n', -2], ['m', 3], ['o', -7]];
  const running = new Map();
  let total = 0;
  for (const step of seq) {
    const sku = step[0];
    const delta = step[1];
    record(inv, sku, delta);
    total += delta;
    running.set(sku, (running.get(sku) || 0) + delta);
    eq(totalOnHand(inv), total, 'running total after ' + sku + ' ' + delta);
    eq(onHand(inv, sku), running.get(sku), 'running quantity for ' + sku);
    const want = [];
    for (const entry of running) {
      if (entry[1] !== 0) want.push(entry[0]);
    }
    want.sort();
    eq(skuList(inv), want, 'running list after ' + sku + ' ' + delta);
    eq(snapshot(inv).revision, seq.indexOf(step) + 1, 'running revision');
  }
}

if (fails.length > 0) {
  for (const f of fails.slice(0, 20)) {
    console.log('FAIL ' + f);
  }
  console.log(fails.length + ' failing assertion(s)');
  process.exit(1);
}

console.log('contract checks passed');
process.exit(0);
HARNESS

out="$(SRC="$SRC" node "$TMP/harness.mjs" 2>&1)"
status=$?

if [ "$status" -eq 0 ]; then
  echo "VERDICT: PASS"
  exit 0
fi

printf '%s\n' "$out" | head -n 20
echo "VERDICT: FAIL"
exit 1
