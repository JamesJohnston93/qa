"use strict";
/** Inventory decrement checks against staging-inventory-v2. Ports regression/verify/inventory.py. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertDecrements = assertDecrements;
const index_1 = require("./index");
/**
 * Inventory changed by exactly the expected amount at exactly the expected
 * locations, and nowhere else.
 *
 * before / after:        {sku: {storeKey: qty}} snapshots.
 * expectedDecrements:    {sku: {storeKey: units}} — e.g. an order of 2 units
 *                        allocated at ATP#100 expects {sku: {"ATP#100": 2}}.
 */
function assertDecrements(before, after, expectedDecrements, orderName) {
    for (const sku of Object.keys(before)) {
        const expected = expectedDecrements[sku] ?? {};
        const locations = new Set([...Object.keys(before[sku] ?? {}), ...Object.keys(after[sku] ?? {})]);
        for (const location of Array.from(locations).sort()) {
            const b = before[sku]?.[location] ?? 0;
            const a = after[sku]?.[location] ?? 0;
            const expectedAfter = b - (expected[location] ?? 0);
            if (a !== expectedAfter) {
                throw new index_1.VerificationError("inventory.decrement", { [`${sku}@${location}`]: expectedAfter }, { [`${sku}@${location}`]: a }, `order ${orderName}: before=${b}, expected decrement=${expected[location] ?? 0}`);
            }
        }
    }
}
