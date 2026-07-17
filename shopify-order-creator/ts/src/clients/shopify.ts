export interface ShopifyOrderResult {
  orderId: string;
  orderName: string;
  createdAt: string;
}

export class ShopifyClient {
  constructor(private readonly store: "US" | "PS") {}

  async createDraftOrder(_customerId: string, _lineItems: Array<{ variantId: string; quantity: number }>): Promise<ShopifyOrderResult> {
    return {
      orderId: `gid://shopify/Order/${Date.now()}`,
      orderName: `#${Math.floor(Math.random() * 100000)}`,
      createdAt: new Date().toISOString(),
    };
  }
}
