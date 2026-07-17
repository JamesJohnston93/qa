/** SKU -> Shopify variant GID maps for each staging store. Ported from orders_processor.py. */

import type { Store } from "./config";

export const US_VARIANTS: Record<string, string> = {
  "32625134": "gid://shopify/ProductVariant/51763546423569",
  "32357875": "gid://shopify/ProductVariant/51760210739473",
  "33006246": "gid://shopify/ProductVariant/51764543422737",
  "33660301": "gid://shopify/ProductVariant/51764570456337",
  "33413679": "gid://shopify/ProductVariant/51764606599441",
};

export const PS_VARIANTS: Record<string, string> = {
  "33203669": "gid://shopify/ProductVariant/50773867888932",
  "33801421": "gid://shopify/ProductVariant/50774177186084",
  "34012956": "gid://shopify/ProductVariant/50913560035620",
  "33487854": "gid://shopify/ProductVariant/50774175940900",
};

export function variantsFor(store: Store): Record<string, string> {
  return store === "US" ? US_VARIANTS : PS_VARIANTS;
}
