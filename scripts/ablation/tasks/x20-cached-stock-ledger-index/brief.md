# Inventory index with memoized reads

`src/inventory.mjs` is a tiny in-memory inventory index. Stock moves constantly,
so every read must reflect every movement recorded so far. A read may never
return a value that was computed from an older set of movements.

## API

All functions are named exports and take the index object returned by
`createInventory()` as their first argument.

- `createInventory()` — returns a fresh, empty index. Two indexes are fully
  independent of each other.
- `record(index, sku, delta)` — appends one movement. `sku` must be a non-empty
  string and `delta` a safe integer; otherwise it throws a `TypeError` and
  changes nothing.
- `onHand(index, sku)` — the sum of all deltas recorded for `sku`, or `0` for a
  sku that has no movements. Reading an unknown sku must not create it.
- `totalOnHand(index)` — the sum of every delta in the index.
- `skuList(index)` — sorted array of the skus whose `onHand` is non-zero. A sku
  brought to zero by its movements disappears; if it moves again it reappears.
- `snapshot(index)` — `{ revision, total, skus }`, where `revision` is the number
  of accepted movements, `total` equals `totalOnHand(index)` and `skus` equals
  `skuList(index)`.

## Rules

- Results are plain values and every call returns fresh data. A caller that
  mutates an array or object it just received must not be able to affect any
  later read.
- Reads (`onHand`, `totalOnHand`, `skuList`, `snapshot`) never change the index
  and never change `revision`.
- Only accepted movements count. A rejected call leaves the index exactly as it
  was before the call.
- Memoizing repeated reads is welcome for speed, but cached values are only a
  performance detail: no read may ever miss a movement that was recorded before
  it was called.
- Node >= 22 ES modules, standard library only, no dependencies.

## Running the check

```
node check.mjs
```

It prints a line when every check passes and throws when one fails.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x20-cached-stock-ledger-index`.
