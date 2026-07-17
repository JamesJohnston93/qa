"use strict";
/** SKU -> Shopify variant GID maps for each staging store. Ported from orders_processor.py. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PS_VARIANTS = exports.US_VARIANTS = void 0;
exports.variantsFor = variantsFor;
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
