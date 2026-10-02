#!/usr/bin/env bash
set -u

ROOT=$(pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/verify.mjs" <<'JS'
import { pathToFileURL } from 'node:url';

const base = pathToFileURL(process.env.ROOT + '/');
const mod = await import(new URL('src/store.mjs', base).href);
const parseStore = mod.parseStore;
const formatStore = mod.formatStore;

let fails = 0;
function ok(cond, msg) {
  if (!cond) { fails += 1; console.log('FAIL: ' + msg); }
}
function eq(actual, expected, msg) {
  ok(Object.is(actual, expected),
    msg + ' (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
}
function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch (e) { threw = e instanceof Error; }
  ok(threw, msg);
}
function dump(map) {
  const parts = [];
  for (const [k, v] of map) parts.push(k + '\u0000' + v);
  return parts.join('\u0001');
}

ok(parseStore('a=1\n') instanceof Map, 'parseStore returns a Map');
eq(parseStore('a=1\n').get('a'), '1', 'reads a simple entry');
eq(parseStore('# c\n\n   \n  # d\na=1').size, 1, 'comments and blank lines are skipped');
eq(parseStore('k=').get('k'), '', 'empty value');
eq(parseStore('k=a=b').get('k'), 'a=b', 'value may contain =');
eq(parseStore('k=  hi  ').get('k'), '  hi  ', 'value is not trimmed');
eq(parseStore('k=#hi').get('k'), '#hi', 'value may start with #');
eq(parseStore('a=1\r\nb=2\r\n').size, 2, 'CRLF line endings');
eq([...parseStore('b=1\na=2').keys()].join(','), 'b,a', 'file order is kept');

throws(() => parseStore('nope'), 'line without = must throw');
throws(() => parseStore('1x=v'), 'key starting with a digit must throw');
throws(() => parseStore('=v'), 'empty key must throw');
throws(() => parseStore(' x=v'), 'leading space before the key must throw');
throws(() => parseStore('x y=v'), 'space inside the key must throw');
throws(() => parseStore('a=1\na=2'), 'duplicate key must throw');

eq(parseStore('k=a\\nb').get('k'), 'a\nb', 'unescapes \\n');
eq(parseStore('k=a\\tb').get('k'), 'a\tb', 'unescapes \\t');
eq(parseStore('k=a\\rb').get('k'), 'a\rb', 'unescapes \\r');
eq(parseStore('k=a\\\\b').get('k'), 'a\\b', 'unescapes double backslash');
eq(parseStore('k=a\\\\nb').get('k'), 'a\\nb', 'escaped backslash does not start an escape');
throws(() => parseStore('k=a\\qb'), 'unknown escape must throw');
throws(() => parseStore('k=ab\\'), 'dangling backslash must throw');

eq(formatStore(new Map([['k', 'a\nb']])), 'k=a\\nb\n', 'escapes LF on write');
eq(formatStore(new Map([['k', 'a\tb']])), 'k=a\\tb\n', 'escapes TAB on write');
eq(formatStore(new Map([['k', 'a\rb']])), 'k=a\\rb\n', 'escapes CR on write');
eq(formatStore(new Map([['k', 'a\\b']])), 'k=a\\\\b\n', 'escapes backslash on write');
eq(formatStore(new Map()), '', 'empty map writes nothing');
eq(formatStore(new Map([['b', '1'], ['a', '2']])), 'b=1\na=2\n', 'iteration order is kept');
throws(() => formatStore(new Map([['1bad', 'x']])), 'invalid key on write must throw');
throws(() => formatStore(new Map([['k', 5]])), 'non-string value must throw');

const hostile = 'ok\nadmin=true\n# note\nmemo=boom';
const hostileText = formatStore(new Map([['note', hostile]]));
eq(hostileText.split('\n').length, 2, 'a value with line breaks stays on one line');
const hostileBack = parseStore(hostileText);
eq(hostileBack.size, 1, 'an embedded line break does not create a record');
eq(hostileBack.get('note'), hostile, 'embedded text round-trips unchanged');
ok(!hostileBack.has('admin'), 'embedded text does not become data');

const special = parseStore('__proto__=p\nconstructor=c\ntoString=t\nhasOwnProperty=h');
eq(special.size, 4, 'prototype-ish keys are ordinary entries');
eq(special.get('__proto__'), 'p', '__proto__ key');
eq(special.get('constructor'), 'c', 'constructor key');
eq(special.get('toString'), 't', 'toString key');
eq(formatStore(special), '__proto__=p\nconstructor=c\ntoString=t\nhasOwnProperty=h\n', 'prototype-ish keys round-trip');

const rich = new Map([['a', 'x=y'], ['b', 'one\ntwo'], ['c', '#note'], ['d', 'back\\slash'], ['e', ''], ['f', 'h\u00e9llo \ud83c\udf0d']]);
eq(dump(parseStore(formatStore(rich))), dump(rich), 'rich map round-trips');
eq(formatStore(parseStore('a=hello\\nworld\nb=tab\\there\n')), 'a=hello\\nworld\nb=tab\\there\n', 're-formatting a parsed file is stable');

if (fails > 0) {
  console.log(fails + ' contract check(s) failed');
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
JS

ROOT="$ROOT" node "$TMP/verify.mjs"
status=$?

if [ "$status" -ne 0 ]; then
  echo "VERDICT: FAIL"
  exit 1
fi

echo "VERDICT: PASS"
exit 0
