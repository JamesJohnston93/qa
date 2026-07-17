"use strict";
/** SKU -> Shopify variant GID maps for each staging store. Ported from orders_processor.py. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PS_SKU_ORDER = exports.US_SKU_ORDER = exports.PS_VARIANTS = exports.US_VARIANTS = void 0;
exports.variantsFor = variantsFor;
exports.skuPoolFor = skuPoolFor;
exports.US_VARIANTS = {
    "32625134": "gid://shopify/ProductVariant/51763546423569",
    "32357875": "gid://shopify/ProductVariant/51760210739473",
    "33006246": "gid://shopify/ProductVariant/51764543422737",
    "33660301": "gid://shopify/ProductVariant/51764570456337",
    "33413679": "gid://shopify/ProductVariant/51764606599441",
};
exports.PS_VARIANTS = {
    "33203669": "gid://shopify/ProductVariant/50773867888932",
    "33801421": "gid://shopify/ProductVariant/50774177186084",
    "34012956": "gid://shopify/ProductVariant/50913560035620",
    "33487854": "gid://shopify/ProductVariant/50774175940900",
};
function variantsFor(store) {
    return store === "US" ? exports.US_VARIANTS : exports.PS_VARIANTS;
}
/**
 * Declared SKU order per store, used by cases/baselineCases.ts's sku(i)
 * lookup. NOT derived via Object.keys(US_VARIANTS)/Object.keys(PS_VARIANTS):
 * these SKUs are all canonical-integer strings (e.g. "32625134"), and
 * JavaScript's own-property enumeration order sorts integer-index-like keys
 * ascending numerically regardless of declaration order — unlike Python
 * dicts, which always preserve insertion order. Object.keys() here would
 * silently reorder the pool (confirmed live: sku(0) resolved to "32357875",
 * the numerically-smallest key, instead of the first-declared "32625134"),
 * breaking parity with the Python reference's case-to-SKU assignment.
 */
exports.US_SKU_ORDER = ["32625134", "32357875", "33006246", "33660301", "33413679"];
exports.PS_SKU_ORDER = ["33203669", "33801421", "34012956", "33487854"];
function skuPoolFor(store) {
    return store === "US" ? exports.US_SKU_ORDER : exports.PS_SKU_ORDER;
}
