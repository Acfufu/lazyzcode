import fs from 'node:fs';
import path from 'node:path';

export function transform(item) {
  const value = Number(item.value);
  if (!Number.isInteger(value)) {
    throw new Error(`record ${item.key} has a non-integer value`);
  }
  return {
    key: item.key,
    value,
    parity: value % 2 === 0 ? 'even' : 'odd',
    square: value * value,
  };
}

export function readSource(sourcePath) {
  const text = fs.readFileSync(sourcePath, 'utf8');
  const items = [];
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    items.push(JSON.parse(raw));
  }
  return items;
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) return null;
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

export function runPipeline({ source, out, state, env = process.env }) {
  const items = readSource(source);
  const cancelAfter = Number(env.CANCEL_AFTER || 0);

  const saved = readState(state);
  const done = saved && typeof saved.done === 'number' ? saved.done : 0;

  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  let consumed = 0;
  for (let i = done; i < items.length; i += 1) {
    fs.appendFileSync(out, `${JSON.stringify(transform(items[i]))}\n`, 'utf8');
    consumed += 1;
    if (cancelAfter > 0 && consumed === cancelAfter) {
      process.exit(70);
    }
  }

  fs.writeFileSync(state, JSON.stringify({ done: items.length }), 'utf8');
  return { processed: items.length };
}
