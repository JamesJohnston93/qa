export interface VerificationFailure {
  check: string;
  expected: unknown;
  actual: unknown;
  detail?: string;
}

export class VerificationError extends Error {
  constructor(public readonly failure: VerificationFailure) {
    super(`${failure.check}: expected ${JSON.stringify(failure.expected)}, got ${JSON.stringify(failure.actual)}`);
  }
}

export function assertShopifyOrder(snapshot: { financialStatus?: string; lineItems: Array<{ sku: string; quantity: number }> }, expected: Record<string, number>): void {
  if (snapshot.financialStatus !== "PAID") {
    throw new VerificationError({
      check: "shopify.financial_status",
      expected: "PAID",
      actual: snapshot.financialStatus,
      detail: "The Shopify order must be paid",
    });
  }

  const actual = snapshot.lineItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.sku] = (acc[item.sku] ?? 0) + item.quantity;
    return acc;
  }, {});

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new VerificationError({
      check: "shopify.line_items",
      expected,
      actual,
      detail: "Line items do not match the expected order quantities",
    });
  }
}

export function assertOrdersTableAlignment(actual: Record<string, number>, expected: Record<string, number>): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new VerificationError({
      check: "orders_table.items",
      expected,
      actual,
      detail: "staging-orders-v2 items do not match the expected quantities",
    });
  }
}

export function assertUnitCounts(summary: { skuUnits: Record<string, number> }, expected: Record<string, number>): void {
  if (JSON.stringify(summary.skuUnits) !== JSON.stringify(expected)) {
    throw new VerificationError({
      check: "shipments.unit_counts",
      expected,
      actual: summary.skuUnits,
      detail: "One ITEM row per unit is required",
    });
  }
}

export function assertAllocation(summary: { byStore: Record<string, string[]>; unallocated: number }, expected: Record<string, string>): void {
  if (summary.unallocated > 0) {
    throw new VerificationError({
      check: "shipments.allocated",
      expected: "all items allocated or undeliverable",
      actual: `${summary.unallocated} item(s) with no store value`,
    });
  }

  for (const [sku, store] of Object.entries(expected)) {
    const stores = Object.entries(summary.byStore).filter(([, skus]) => skus.includes(sku)).map(([storeKey]) => storeKey);
    if (stores.length !== 1 || stores[0] !== store) {
      throw new VerificationError({
        check: "shipments.allocation",
        expected: { [sku]: store },
        actual: { [sku]: stores },
      });
    }
  }
}

export function assertInventoryDecrements(
  before: Record<string, Record<string, number>>,
  after: Record<string, Record<string, number>>,
  expectedDecrements: Record<string, Record<string, number>>,
  orderName: string,
): void {
  for (const [sku, beforeLocations] of Object.entries(before)) {
    const expected = expectedDecrements[sku] ?? {};
    const locations = new Set([...Object.keys(beforeLocations), ...Object.keys(after[sku] ?? {})]);
    for (const location of Array.from(locations).sort()) {
      const beforeQty = beforeLocations[location] ?? 0;
      const afterQty = after[sku]?.[location] ?? 0;
      const expectedAfter = beforeQty - (expected[location] ?? 0);
      if (afterQty !== expectedAfter) {
        throw new VerificationError({
          check: "inventory.decrement",
          expected: { [`${sku}@${location}`]: expectedAfter },
          actual: { [`${sku}@${location}`]: afterQty },
          detail: `order ${orderName}: before=${beforeQty}, expected decrement=${expected[location] ?? 0}`,
        });
      }
    }
  }
}
