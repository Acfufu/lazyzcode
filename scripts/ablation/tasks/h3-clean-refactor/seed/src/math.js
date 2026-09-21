// Small statistics helpers used by the release checklist.
export function sum(xs) {
  return xs.reduce((a, b) => a + b, 0);
}

export function max(xs) {
  return xs.length === 0 ? null : Math.max(...xs);
}
