# Token bucket rate limiter (deterministic)

Implement `src/tokenbucket.mjs` exporting `createBucket(opts)`. Time is
EXPLICIT — every call takes `nowMs`; nothing reads a wall clock. The contract
below is LARGE on purpose — you have a bounded session; maximize correctness.
`node check.mjs` is a smoke subset.

## createBucket({ capacity, refillPerSec, initial })

- `capacity`: positive number, required. Not a positive number → TypeError.
- `refillPerSec`: non-negative number (default 0). Negative or non-number →
  TypeError. Tokens accrue continuously: `refillPerSec` per 1000 ms.
- `initial`: number in [0, capacity] (default = capacity; a larger value is
  clamped to capacity; negative → TypeError).
- The bucket timeline starts at `nowMs = 0` holding `initial` tokens.

## Buckets

- `available(nowMs)`: `min(capacity, last + (nowMs - lastTime)/1000 *
  refillPerSec)` — refill accrues continuously from the last snapshot and is
  capped by capacity.
- `tryConsume(tokens, nowMs)`: `tokens` must be a positive integer, else
  TypeError. If `available(nowMs) >= tokens`: debit it and return
  `{ allowed: true, remaining }`; otherwise return
  `{ allowed: false, remaining: available(nowMs) }` and change nothing except
  the refill snapshot.
- `nextAvailableAt(tokens, nowMs)`: positive-integer `tokens` else TypeError.
  Returns `nowMs` if already affordable; otherwise the smallest
  `nowMs' > nowMs` (rounded UP to the integer ms) at which `available`
  reaches `tokens`; `Infinity` when `refillPerSec` is 0.
- All of `nowMs`/consecutive calls must be non-decreasing in time (going
  backwards → TypeError).
- Refill must never exceed capacity even after long idle gaps.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x39-token-bucket-limiter`.
