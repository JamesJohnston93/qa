"use strict";
/**
 * NewStore order read-back for verification (TAA-17 step 3, NS cases 7-8).
 * Built from scratch — the retired Python regression package's reader for
 * this never got past guessing at the endpoint. The real endpoint was
 * confirmed live 2026-07-22 (see CLAUDE.md): GET
 * /v0/d/external_orders/{external_id}, ~2s propagation after injection,
 * response has order_uuid, order_id (display id), and ordered_products[]
 * with product_sku/quantity/item_id.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrderByExternalId = getOrderByExternalId;
exports.skuQuantities = skuQuantities;
function isNotFoundError(error) {
    return error instanceof Error && /NewStore request failed: 404\b/.test(error.message);
}
/**
 * Fetches an injected order back from NewStore by its external_id.
 *
 * Returns null while the order hasn't propagated yet (a 404 during the
 * ~2s propagation window is expected, not a failure — mirrors
 * DynamoReader.getOrderPk's "empty/null = not landed yet" convention so
 * pollVerify's retry-on-VerificationError loop can wait it out). Any other
 * error (network failure, non-404 4xx/5xx, malformed response) propagates —
 * those are real failures, not a "still propagating" signal.
 */
async function getOrderByExternalId(client, externalId) {
    let result;
    try {
        result = await client.get(`/v0/d/external_orders/${encodeURIComponent(externalId)}`);
    }
    catch (error) {
        if (isNotFoundError(error)) {
            return null;
        }
        throw error;
    }
    if (!result.order_uuid) {
        throw new Error(`NewStore external order ${externalId} missing order_uuid: ${JSON.stringify(result)}`);
    }
    const orderedProducts = (result.ordered_products ?? []).map((product) => {
        if (!product.product_sku || product.quantity === undefined) {
            throw new Error(`NewStore external order ${externalId} has a malformed ordered_products entry: ${JSON.stringify(product)}`);
        }
        return { productSku: product.product_sku, quantity: product.quantity, itemId: product.item_id ?? null };
    });
    return {
        orderUuid: result.order_uuid,
        orderId: result.order_id ?? "",
        orderedProducts,
        raw: result,
    };
}
/** SKU -> total quantity map. NewStore keeps one entry per unit like DynamoDB, not merged like Shopify. */
function skuQuantities(snapshot) {
    const out = {};
    for (const product of snapshot.orderedProducts) {
        out[product.productSku] = (out[product.productSku] ?? 0) + product.quantity;
    }
    return out;
}
