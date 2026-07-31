/**
 * NewStore order read-back for verification (TAA-17 step 3, NS cases 7-8).
 *
 * No Python spec to port here: the retired regression/readers/newstore_reader.py
 * was only ever a TODO stub guessing at the read endpoint. The real endpoint
 * was confirmed live 2026-07-22 (see CLAUDE.md): GET
 * /v0/d/external_orders/{external_id}, ~2s propagation after injection,
 * response has order_uuid, order_id (display id), and ordered_products[]
 * with product_sku/quantity/item_id.
 */

import type { NewStoreClient } from "../clients/newstore";

export interface NewStoreOrderedProduct {
  productSku: string;
  quantity: number;
  itemId: string | null;
}

export interface NewStoreOrderSnapshot {
  orderUuid: string;
  orderId: string;
  orderedProducts: NewStoreOrderedProduct[];
  raw: unknown;
}

interface ExternalOrderProductResponse {
  product_sku?: string;
  quantity?: number;
  item_id?: string;
}

interface ExternalOrderResponse {
  order_uuid?: string;
  order_id?: string;
  ordered_products?: ExternalOrderProductResponse[];
}

function isNotFoundError(error: unknown): boolean {
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
export async function getOrderByExternalId(
  client: NewStoreClient,
  externalId: string,
): Promise<NewStoreOrderSnapshot | null> {
  let result: ExternalOrderResponse;
  try {
    result = await client.get<ExternalOrderResponse>(`/v0/d/external_orders/${encodeURIComponent(externalId)}`);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }

  if (!result.order_uuid) {
    throw new Error(`NewStore external order ${externalId} missing order_uuid: ${JSON.stringify(result)}`);
  }

  const orderedProducts: NewStoreOrderedProduct[] = (result.ordered_products ?? []).map((product) => {
    if (!product.product_sku || product.quantity === undefined) {
      throw new Error(
        `NewStore external order ${externalId} has a malformed ordered_products entry: ${JSON.stringify(product)}`,
      );
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
export function skuQuantities(snapshot: NewStoreOrderSnapshot): Record<string, number> {
  const out: Record<string, number> = {};
  for (const product of snapshot.orderedProducts) {
    out[product.productSku] = (out[product.productSku] ?? 0) + product.quantity;
  }
  return out;
}
