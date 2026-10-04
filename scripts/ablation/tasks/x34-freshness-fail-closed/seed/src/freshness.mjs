// Broken: 2-hour-old snapshot judged fresh.
const TTL = 3_600_000;
export function judge(snapshot, now) {
  const age = now - snapshot?.writtenAt;
  return age > TTL ? "stale" : "fresh";
}
