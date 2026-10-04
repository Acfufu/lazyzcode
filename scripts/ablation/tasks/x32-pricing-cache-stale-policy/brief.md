# Pricing cache

`src/pricing.mjs` exports a `Pricing` class that turns raw catalogue data into
final prices and keeps a small on-disk cache so repeated runs stay cheap.

## Data layout

- `data/policy.json` — `{ "taxRate": <number>, "discounts": { "<category>": <fraction> } }`
- `data/products/<id>.json` — `{ "id": <string>, "basePrice": <number>, "category": <string> }`

The final price of a product is
`round2(basePrice * (1 - categoryDiscount) * (1 + taxRate))`,
where a category without a discount entry uses `0` and `round2(x)` is
`Math.round(x * 100) / 100`.

## API

```js
const engine = new Pricing({ dataDir: 'data', cachePath: 'cache/prices.json' });
const { prices, recomputed } = await engine.load();
```

- `dataDir` defaults to `data`; `cachePath` defaults to `cache/prices.json`.
- `prices` maps every product id found under `data/products` to its final price.
- `recomputed` lists the ids that were *not* served from the cache. Order is not
  significant.
- `load()` always leaves a usable cache behind at `cachePath`.

## Cache rules

A cached price may only be reused while it still matches the inputs it was
derived from:

- If neither that product's file nor the policy file has changed since the
  cached value was produced, the value is reused and the id is not recomputed.
- If either one changed, the affected ids are recomputed and their new prices
  are returned.
- This decision is made per product and must depend on the current contents of
  those files, not on file names or timestamps.
- A product whose file is gone must not appear in `prices`, and must not force
  the remaining products to be recomputed.
- A cache file that cannot be validated against the current inputs must be
  ignored rather than trusted, and must never make `load()` throw.

## Constraints

- Node >= 22, ES modules, no npm dependencies, no network access.
- Keep the public entry point at `src/pricing.mjs`, exporting `Pricing`.

## Running the local check

From the repository root:

```
node check.mjs
```

It prints `CHECK PASSED` and exits 0 when the behaviour above looks right, or
`CHECK FAILED` plus a list of problems otherwise.

When you believe the task is complete, end your final message with the line `TASK COMPLETE: x32-pricing-cache-stale-policy`.
