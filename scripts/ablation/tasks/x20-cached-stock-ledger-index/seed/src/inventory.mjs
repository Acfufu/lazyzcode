// In-memory inventory index with memoized reads.
//
// Movements are appended to a ledger. Reads walk the ledger the first time a
// value is asked for and are supposed to stay in sync with it afterwards.

export function createInventory() {
  return {
    movements: [],
    onHandCache: new Map(),
    totalCache: null,
    skuListCache: null,
  };
}

function assertSku(sku) {
  if (typeof sku !== 'string' || sku.length === 0) {
    throw new TypeError('sku must be a non-empty string');
  }
}

function assertDelta(delta) {
  if (!Number.isSafeInteger(delta)) {
    throw new TypeError('delta must be a safe integer');
  }
}

export function record(inv, sku, delta) {
  assertSku(sku);
  assertDelta(delta);
  inv.movements.push({ sku, delta });
  inv.onHandCache.delete(sku);
}

function sumFor(inv, sku) {
  let sum = 0;
  for (const movement of inv.movements) {
    if (movement.sku === sku) {
      sum += movement.delta;
    }
  }
  return sum;
}

export function onHand(inv, sku) {
  assertSku(sku);
  if (!inv.onHandCache.has(sku)) {
    inv.onHandCache.set(sku, sumFor(inv, sku));
  }
  return inv.onHandCache.get(sku);
}

export function totalOnHand(inv) {
  if (inv.totalCache === null) {
    let sum = 0;
    for (const movement of inv.movements) {
      sum += movement.delta;
    }
    inv.totalCache = sum;
  }
  return inv.totalCache;
}

export function skuList(inv) {
  if (inv.skuListCache === null) {
    const seen = new Set();
    for (const movement of inv.movements) {
      seen.add(movement.sku);
    }
    inv.skuListCache = [...seen].sort();
  }
  return inv.skuListCache;
}

export function snapshot(inv) {
  return {
    revision: inv.movements.length,
    total: totalOnHand(inv),
    skus: skuList(inv),
  };
}
