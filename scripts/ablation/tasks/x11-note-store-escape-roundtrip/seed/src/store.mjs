// A tiny line based store: KEY=VALUE per line.

export function parseStore(text) {
  const out = new Map();
  const lines = String(text).split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) {
      throw new Error('invalid line: ' + line);
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    out.set(key, value);
  }
  return out;
}

export function formatStore(entries) {
  let text = '';
  for (const [key, value] of entries) {
    text += key + '=' + value + '\n';
  }
  return text;
}
