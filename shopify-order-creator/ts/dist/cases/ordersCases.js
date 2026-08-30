"use strict";
/**
 * Hold lifecycle cases (TC7-12, TAA-54) — six cases over one composable hold
 * flow (flows/holdFlow.ts, TAA-57), run through the `orders` subcommand
 * (ordersRunner.ts) rather than runner.ts's pipeline/newstore case kinds.
 * Opt-in, not part of the default 12-case regression set.
 *
 * Fixed slots, never positional — same reasoning as newstoreCases.ts's
 * NS_SFS_SLOT/NS_OTC_SLOT: a future pool change must not silently move which
 * SKU a case exercises. Base slots 18-23 (one per case, per the pool slot
 * map in CLAUDE.md/ts/plans/TAA-46-plan.md); slot 74 is a single add-item
 * SKU shared across the four edit-driven cases (outstanding/multi/
 * release_payment/partial_release) — sharing is safe because these cases run
 * sequentially (this subcommand never runs cases concurrently, unlike the
 * wave-scheduled pipeline cases), so there's no concurrent-mutation race on
 * the shared SKU's variant GID (holds never touch staging-inventory-v2 at
 * all, so there's no stock to race on either).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORDERS_CASE_NAMES = void 0;
exports.buildOrdersCases = buildOrdersCases;
const variants_1 = require("../variants");
const BASE_SLOTS = {
    os_hold_fraud: 18,
    os_hold_outstanding: 19,
    os_hold_multi: 20,
    os_hold_release_fraud: 21,
    os_hold_release_payment: 22,
    os_hold_partial_release: 23,
};
/** Shared add-item SKU slot across the four edit-driven cases (ticket's own SKU-slot table). */
const ADD_ITEM_SLOT = 74;
const VARIANT_BY_NAME = {
    os_hold_fraud: "fraud",
    os_hold_outstanding: "outstanding",
    os_hold_multi: "multi",
    os_hold_release_fraud: "release_fraud",
    os_hold_release_payment: "release_payment",
    os_hold_partial_release: "partial_release",
};
const DESCRIPTIONS = {
    os_hold_fraud: "TC7: fulfillmentOrderHold raises POTENTIAL_FRAUD",
    os_hold_outstanding: "TC8: an unpaid edit raises OUTSTANDING_PAYMENT",
    os_hold_multi: "TC9: both reasons held simultaneously, one HOLD_ORDER row each",
    os_hold_release_fraud: "TC10: fraud hold applied then released via fulfillmentOrderReleaseHold",
    os_hold_release_payment: "TC11: outstanding-payment hold applied then released via orderMarkAsPaid",
    os_hold_partial_release: "TC12: both reasons held, only fraud released — outstanding remains, no UNHOLD_ORDER for it",
};
const EDIT_DRIVEN = new Set(["outstanding", "multi", "release_payment", "partial_release"]);
exports.ORDERS_CASE_NAMES = Object.keys(BASE_SLOTS);
function buildOrdersCases(store) {
    const pool = (0, variants_1.skuPoolFor)(store);
    const maxSlot = Math.max(...Object.values(BASE_SLOTS), ADD_ITEM_SLOT);
    if (pool.length <= maxSlot) {
        throw new Error(`variant pool for ${store} has ${pool.length} entries, needs at least ${maxSlot + 1} for the orders cases' pinned slots`);
    }
    const addItemSku = pool[ADD_ITEM_SLOT];
    const cases = {};
    for (const name of exports.ORDERS_CASE_NAMES) {
        const variant = VARIANT_BY_NAME[name];
        cases[name] = {
            name,
            description: DESCRIPTIONS[name],
            variant,
            baseSku: pool[BASE_SLOTS[name]],
            addItemSku: EDIT_DRIVEN.has(variant) ? addItemSku : null,
        };
    }
    return cases;
}
