import assert from 'node:assert/strict';
import {
  createInventory,
  record,
  onHand,
  totalOnHand,
  skuList,
} from './src/inventory.mjs';

const inv = createInventory();

record(inv, 'widget', 5);
assert.equal(onHand(inv, 'widget'), 5);
assert.deepEqual(skuList(inv), ['widget']);
assert.equal(totalOnHand(inv), 5);

record(inv, 'widget', -2);
assert.equal(onHand(inv, 'widget'), 3);

record(inv, 'gadget', 4);
assert.equal(totalOnHand(inv), 7);
assert.deepEqual(skuList(inv), ['gadget', 'widget']);
assert.equal(onHand(inv, 'widget'), 3);
assert.equal(onHand(inv, 'gadget'), 4);

console.log('check.mjs: all visible checks passed');
