import { parseStore, formatStore } from './src/store.mjs';

let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('ok   - ' + name);
  } catch (err) {
    failed += 1;
    console.log('FAIL - ' + name + ': ' + err.message);
  }
}

function is(actual, expected, label) {
  if (!Object.is(actual, expected)) {
    throw new Error(label + ': expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
  }
}

function throws(fn, label) {
  let didThrow = false;
  try {
    fn();
  } catch (err) {
    didThrow = true;
  }
  if (!didThrow) {
    throw new Error(label + ': expected an error');
  }
}

test('reads a simple entry', () => {
  const store = parseStore('title=Trip notes\n');
  is(store.get('title'), 'Trip notes', 'title');
  is(store.size, 1, 'size');
});

test('skips blank and comment lines', () => {
  is(parseStore('# heading\n\n  \ntitle=Hi\n').size, 1, 'size');
});

test('allows an empty value', () => {
  is(parseStore('memo=\n').get('memo'), '', 'memo');
});

test('value keeps everything after the first =', () => {
  is(parseStore('memo=a=b\n').get('memo'), 'a=b', 'memo');
});

test('a line without = is rejected', () => {
  throws(() => parseStore('just text\n'), 'missing separator');
});

test('writes entries in order', () => {
  is(formatStore(new Map([['b', '1'], ['a', '2']])), 'b=1\na=2\n', 'text');
});

test('an empty store writes nothing', () => {
  is(formatStore(new Map()), '', 'text');
});

test('a value with a line break survives a round trip', () => {
  const store = new Map([['memo', 'first\nsecond']]);
  const text = formatStore(store);
  is(text.split('\n').length, 2, 'entry stays on one line');
  const back = parseStore(text);
  is(back.get('memo'), 'first\nsecond', 'memo');
  is(back.size, 1, 'size');
});

if (failed > 0) {
  console.log('\n' + failed + ' check(s) failed');
  process.exitCode = 1;
} else {
  console.log('\nall checks passed');
}
