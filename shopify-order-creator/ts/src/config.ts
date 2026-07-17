export type Store = "US" | "PS";

export interface RegressionConfig {
  store: Store;
  repeat: number;
  verbose: boolean;
}

export const DEFAULT_CONFIG: RegressionConfig = {
  store: "US",
  repeat: 1,
  verbose: true,
};

export interface CaseDefinition {
  name: string;
  description: string;
  expected: string;
}

export const CASES: CaseDefinition[] = [
  {
    name: "single",
    description: "Single-item order with stock at one ATP location",
    expected: "One shipment allocated to the seeded store",
  },
  {
    name: "multi",
    description: "Three units of one SKU held in one shipment",
    expected: "One shipment and three AWS ITEM rows",
  },
  {
    name: "split",
    description: "SKU stock spread across stores to force split allocation",
    expected: "One shipment per allocated store",
  },
  {
    name: "undeliverable",
    description: "No stock available, refund path must be exercised",
    expected: "UNDELIVERABLE state and refund evidence",
  },
];
