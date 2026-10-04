# Snapshot freshness judge

`src/freshness.mjs` exports `judge(snapshot, now)`. A coordination file is
rewritten by whoever picks the work up; consumers must only act on a snapshot
that is provably recent — and must fail closed whenever freshness cannot be
established.

`snapshot` is an object with `writtenAt` (epoch milliseconds, a finite
number); `now` is the current epoch milliseconds. Returns `"fresh"` or
`"stale"`:

- `writtenAt` missing, not a number, or not finite (`NaN`/`Infinity`) → `"stale"`;
- `now` not a finite number → `"stale"`;
- age = `now - writtenAt`; a negative age beyond 60_000 ms means a future-
  dated snapshot (clock skew tolerance is exactly 60_000 ms) → `"stale"`;
- age greater than or **equal to** 7_200_000 ms (2 hours) → `"stale"`;
- anything else → `"fresh"`.

Non-object `snapshot` (`null`, arrays, primitives) → `"stale"`.

Run `node check.mjs` for the visible cases.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x34-freshness-fail-closed`.
