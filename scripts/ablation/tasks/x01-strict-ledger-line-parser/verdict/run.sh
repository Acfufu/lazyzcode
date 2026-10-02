#!/usr/bin/env bash
set -u

ROOT="$(pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/full_check.mjs" <<'JSEOF'
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
let failures = 0;

function fail(name, message) {
  failures += 1;
  console.log('FAIL ' + name + ' :: ' + message);
}

function attempt(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, error: err };
  }
}

function describe(err) {
  if (err && err.name === 'ParseError') {
    return 'ParseError(line=' + String(err.line) + ')';
  }
  if (err && err.message) {
    return String(err.name) + ': ' + String(err.message);
  }
  return String(err);
}

let mod = null;
try {
  mod = await import(pathToFileURL(path.join(root, 'src', 'ledger.mjs')).href);
} catch (err) {
  console.log('FAIL load :: ' + describe(err));
  process.exit(1);
}

const parseAmount = mod.parseAmount;
const parseLedger = mod.parseLedger;
const ParseError = mod.ParseError;

if (typeof parseAmount !== 'function' || typeof parseLedger !== 'function' || typeof ParseError !== 'function') {
  console.log('FAIL exports :: parseAmount, parseLedger and ParseError must all be exported');
  process.exit(1);
}

function expectEqual(name, actual, expected) {
  if (actual !== expected) {
    fail(name, 'expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
  }
}

function expectParseError(name, fn) {
  const res = attempt(fn);
  if (res.ok) {
    fail(name, 'expected a ParseError but nothing was thrown');
    return null;
  }
  if (!(res.error instanceof ParseError)) {
    fail(name, 'expected a ParseError but got ' + describe(res.error));
    return null;
  }
  return res.error;
}

function entriesOf(value) {
  if (value && Array.isArray(value.entries)) {
    return value.entries;
  }
  return [];
}

const validAmounts = [
  ['0', 0],
  ['0.00', 0],
  ['0.50', 50],
  ['12', 1200],
  ['12.5', 1250],
  ['12.50', 1250],
  ['-3.07', -307],
  ['-0.01', -1],
  ['-0.00', 0],
  ['90071992547409.91', 9007199254740991],
  ['-90071992547409.91', -9007199254740991]
];

for (const pair of validAmounts) {
  const res = attempt(() => parseAmount(pair[0]));
  if (!res.ok) {
    fail('parseAmount ' + JSON.stringify(pair[0]), 'threw ' + describe(res.error));
  } else {
    expectEqual('parseAmount ' + JSON.stringify(pair[0]), res.value, pair[1]);
  }
}

const invalidAmounts = [
  '', ' ', '  12', '12  ', '1e3', '1E3', '+5', '0x10', '0b101', 'Infinity', '-Infinity',
  'NaN', '1,000', '12.', '.5', '5.123', '-', '007', '01', '00', '1 2', '5\n', '1_000',
  '--1', '1.2.3', '12..3', '99999999999999999999', '10000000000000000',
  '90071992547409.92', '-90071992547409.92'
];

for (const text of invalidAmounts) {
  expectParseError('parseAmount rejects ' + JSON.stringify(text), () => parseAmount(text));
}

{
  const err = expectParseError('parseAmount rejects a word', () => parseAmount('word'));
  if (err !== null) {
    expectEqual('parseAmount error line', err.line, null);
  }
}

{
  const text = '2024-01-01|10.00|rent\n2024-02-29|0.05|leap\n2024-03-01|-2.50|refund\n';
  const res = attempt(() => parseLedger(text));
  if (!res.ok) {
    fail('ledger basic', 'threw ' + describe(res.error));
  } else {
    const value = res.value || {};
    const entries = entriesOf(value);
    expectEqual('ledger basic entry count', entries.length, 3);
    expectEqual('ledger basic total', value.total, 755);
    expectEqual('ledger basic date 0', (entries[0] || {}).date, '2024-01-01');
    expectEqual('ledger basic amount 0', (entries[0] || {}).amount, 1000);
    expectEqual('ledger basic memo 0', (entries[0] || {}).memo, 'rent');
    expectEqual('ledger basic amount 1', (entries[1] || {}).amount, 5);
    expectEqual('ledger basic amount 2', (entries[2] || {}).amount, -250);
  }
}

{
  const text = '\r\n2024-01-01|1.00|a   \r\n   \n2024-01-02|2.00|\r\n';
  const res = attempt(() => parseLedger(text));
  if (!res.ok) {
    fail('ledger CRLF', 'threw ' + describe(res.error));
  } else {
    const value = res.value || {};
    const entries = entriesOf(value);
    expectEqual('ledger CRLF entry count', entries.length, 2);
    expectEqual('ledger CRLF total', value.total, 300);
    expectEqual('ledger CRLF memo 0', (entries[0] || {}).memo, 'a');
    expectEqual('ledger CRLF memo 1', (entries[1] || {}).memo, '');
  }
}

{
  const res = attempt(() => parseLedger('2024-01-01|1.00|tail\r'));
  if (!res.ok) {
    fail('ledger trailing CR', 'threw ' + describe(res.error));
  } else {
    const entries = entriesOf(res.value);
    expectEqual('ledger trailing CR count', entries.length, 1);
    expectEqual('ledger trailing CR memo', (entries[0] || {}).memo, 'tail');
  }
}

{
  const res = attempt(() => parseLedger(' \n\n\t\n   \n'));
  if (!res.ok) {
    fail('ledger blank', 'threw ' + describe(res.error));
  } else {
    const value = res.value || {};
    expectEqual('ledger blank entry count', entriesOf(value).length, 0);
    expectEqual('ledger blank total', value.total, 0);
  }
}

const goodDates = ['2024-02-29', '2000-02-29', '1900-02-28', '2024-12-31', '2024-01-31'];
for (const date of goodDates) {
  const res = attempt(() => parseLedger(date + '|1.00|m\n'));
  if (!res.ok) {
    fail('ledger accepts date ' + date, 'threw ' + describe(res.error));
  }
}

const badDates = [
  '2023-02-29', '1900-02-29', '2024-02-30', '2023-13-01', '2023-00-10', '2023-04-31',
  '2023-1-01', '2024-1-1', '20240101', '2024-01-32', '2024-06-31', '1999-12-32'
];
for (const date of badDates) {
  expectParseError('ledger rejects date ' + date, () => parseLedger(date + '|1.00|m\n'));
}

const badLines = [
  '2024-01-01|1.00|a|b',
  '2024-01-01|1.00',
  '2024-01-01',
  '2024-01-01|1.00|a|',
  '|1.00|a',
  '2024-01-01||a',
  '2024-01-01|   |a',
  '2024-01-01|1.00|   |extra'
];
for (const line of badLines) {
  expectParseError('ledger rejects ' + JSON.stringify(line), () => parseLedger(line + '\n'));
}

expectParseError('ledger rejects padded date', () => parseLedger(' 2024-01-01|1.00|m\n'));
expectParseError('ledger rejects padded amount', () => parseLedger('2024-01-01| 1.00|m\n'));

{
  const res = attempt(() => parseLedger('2024-01-01|1.00|  hello  \n2024-01-02|2.00|\n'));
  if (!res.ok) {
    fail('ledger memo', 'threw ' + describe(res.error));
  } else {
    const entries = entriesOf(res.value);
    expectEqual('ledger memo trimmed', (entries[0] || {}).memo, 'hello');
    expectEqual('ledger memo empty', (entries[1] || {}).memo, '');
  }
}

{
  let text = '';
  for (let i = 0; i < 10; i += 1) {
    text += '2024-01-01|0.1|x\n';
  }
  const res = attempt(() => parseLedger(text));
  if (!res.ok) {
    fail('ledger repeated decimals', 'threw ' + describe(res.error));
  } else {
    expectEqual('ledger repeated decimals total', (res.value || {}).total, 100);
  }
}

{
  const res = attempt(() => parseLedger('2024-01-01|90071992547409.91|m\n'));
  if (!res.ok) {
    fail('ledger largest safe amount', 'threw ' + describe(res.error));
  } else {
    const entries = entriesOf(res.value);
    expectEqual('ledger largest safe amount value', (entries[0] || {}).amount, 9007199254740991);
  }
}

expectParseError('ledger rejects too large amount', () => parseLedger('2024-01-01|90071992547409.92|m\n'));

function expectLine(name, text, expectedLine) {
  const err = expectParseError(name, () => parseLedger(text));
  if (err !== null) {
    expectEqual(name + ' (line)', err.line, expectedLine);
  }
}

expectLine('line number after blank lines', '\n\n2024-01-01|1.00|a\n2024-13-01|1.00|b\n', 4);
expectLine('line number after whitespace line', '   \n2024-01-02|zzz|b\n', 2);
expectLine('line number with CRLF', '2024-01-01|1.00|a\r\n2024-01-02|nope|b\r\n', 2);
expectLine('line number of short line', '2024-01-01|1.00|a\nbroken\n', 2);

process.exit(failures === 0 ? 0 : 1);
JSEOF

output="$(cd "$ROOT" && node "$TMP/full_check.mjs" 2>&1)"
status=$?
printf '%s\n' "$output"

if [ "$status" -eq 0 ]; then
  echo "VERDICT: PASS"
  exit 0
fi

echo "VERDICT: FAIL"
exit 1
