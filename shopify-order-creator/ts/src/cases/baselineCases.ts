export interface BaselineCase {
  name: string;
  description: string;
  skuQuantities: Record<string, number>;
  seedPlan: Record<string, Record<string, number>>;
  expectedAllocation: Record<string, string>;
  expectedDecrements?: Record<string, Record<string, number>>;
  expectedRefundSkus?: Record<string, number>;
  cleanupSkus?: string[];
}

export const BASELINE_CASES: BaselineCase[] = [
  {
    name: "single",
    description: "Single item, stock at one location",
    skuQuantities: { demo_sku: 1 },
    seedPlan: { demo_sku: { "ATP#100": 99 } },
    expectedAllocation: { demo_sku: "100" },
    expectedDecrements: { demo_sku: { "ATP#100": 1 } },
  },
  {
    name: "multi",
    description: "Three units of one SKU",
    skuQuantities: { demo_sku: 3 },
    seedPlan: { demo_sku: { "ATP#100": 99 } },
    expectedAllocation: { demo_sku: "100" },
    expectedDecrements: { demo_sku: { "ATP#100": 3 } },
  },
  {
    name: "unique",
    description: "Three different SKUs all stocked at one location",
    skuQuantities: { demo_sku: 1, alt_sku: 1, tertiary_sku: 1 },
    seedPlan: {
      demo_sku: { "ATP#100": 99 },
      alt_sku: { "ATP#100": 99 },
      tertiary_sku: { "ATP#100": 99 },
    },
    expectedAllocation: { demo_sku: "100", alt_sku: "100", tertiary_sku: "100" },
    expectedDecrements: {
      demo_sku: { "ATP#100": 1 },
      alt_sku: { "ATP#100": 1 },
      tertiary_sku: { "ATP#100": 1 },
    },
  },
  {
    name: "split",
    description: "Each SKU allocated independently across locations",
    skuQuantities: { demo_sku: 1, alt_sku: 1 },
    seedPlan: { demo_sku: { "ATP#99": 99 }, alt_sku: { "ATP#100": 99 } },
    expectedAllocation: { demo_sku: "99", alt_sku: "100" },
    expectedDecrements: { demo_sku: { "ATP#99": 1 }, alt_sku: { "ATP#100": 1 } },
  },
  {
    name: "undeliverable",
    description: "Zero stock everywhere triggers refund/cleanup path",
    skuQuantities: { demo_sku: 1 },
    seedPlan: {},
    expectedAllocation: { demo_sku: "UNDELIVERABLE" },
    expectedRefundSkus: { demo_sku: 1 },
    cleanupSkus: ["demo_sku"],
  },
  {
    name: "partial_undeliverable",
    description: "One SKU allocated and one SKU refunded as undeliverable",
    skuQuantities: { demo_sku: 1, alt_sku: 1 },
    seedPlan: { demo_sku: { "ATP#100": 99 } },
    expectedAllocation: { demo_sku: "100", alt_sku: "UNDELIVERABLE" },
    expectedRefundSkus: { alt_sku: 1 },
    cleanupSkus: ["alt_sku"],
    expectedDecrements: { demo_sku: { "ATP#100": 1 } },
  },
];
