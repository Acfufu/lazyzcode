// Broken: only the happy-path age comparison; NaN and future dates pass.
const TTL = 7_200_000;
export function judge(snapshot, now) {
  const age = now - snapshot?.writtenAt;
  return age > TTL ? "stale" : "fresh";
}
