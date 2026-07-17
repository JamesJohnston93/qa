/**
 * Explicit configuration for regression runs.
 *
 * Everything a run needs is carried in a RegressionConfig — no module
 * globals, no interactive prompts. Build one per run (the CLI does this from
 * argv) and pass it down.
 */

export type Store = "US" | "PS";

// ---------------------------------------------------------------------------
// ATP locations (staging)
// ---------------------------------------------------------------------------

export const WEB_DC = "ATP#100"; // web distribution centre
export const STORE_99 = "ATP#99";
export const CHERMSIDE_US = "ATP#407"; // BRANCH_407 (US)
export const PS_STORE = "ATP#640"; // BRANCH_640 (PS)

export const ALL_LOCATIONS = [WEB_DC, STORE_99, CHERMSIDE_US, PS_STORE];

/**
 * Known aggregate/pool location keys that some downstream staging process
 * mirrors from real store stock asynchronously (observed: ATP#INTERNATIONAL
 * picked up the same quantity written to ATP#100 within ~30-60s of seeding,
 * with no seed/order action of ours targeting it). These are not real
 * independent per-store stock and must be excluded from decrement
 * assertions, or every case would intermittently fail on a location we never
 * touched. Confirmed 2026-07-17 against staging-inventory-v2.
 */
export const AGGREGATE_LOCATIONS = ["ATP#INTERNATIONAL", "ATP#STUDIO", "ATP#ALL"];

// ---------------------------------------------------------------------------
// Known baseline customers (existing staging customers, from main.py pools)
// ---------------------------------------------------------------------------

export interface Customer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export const BASELINE_CUSTOMERS: Record<Store, Customer> = {
  US: {
    id: "gid://shopify/Customer/8997370954001",
    email: "jared.davis@universalstore.com.au",
    firstName: "Jared",
    lastName: "Davis",
  },
  PS: {
    id: "gid://shopify/Customer/22959422669092",
    email: "jared.davis@universalstore.com.au",
    firstName: "Jared",
    lastName: "Davis",
  },
};

/**
 * Per-stage polling timeouts (seconds).
 *
 * Defaults are deliberately generous first guesses. Tighten them from the
 * stage timings recorded in run reports — a stage that only passes near its
 * timeout is itself a signal worth investigating.
 */
export interface PollWindows {
  interval: number; // seconds between polls
  ordersTable: number; // Shopify order -> staging-orders-v2 row
  shipmentsTable: number; // orders-v2 -> staging-shipments ITEM# rows
  allocation: number; // ITEM# rows -> allocated / UNDELIVERABLE
  refund: number; // undeliverable -> Shopify refund
  cleanup: number; // refund -> rows removed from AWS tables
  inventory: number; // allocation -> inventory decrement
}

export const DEFAULT_POLL_WINDOWS: PollWindows = {
  interval: 5,
  ordersTable: 120,
  shipmentsTable: 180,
  allocation: 240,
  refund: 300,
  cleanup: 300,
  inventory: 240,
};

export interface RegressionConfig {
  store: Store;
  repeat: number; // identical-run repeats (variance diff)
  reportDir: string; // where markdown/JSON reports land
  verbose: boolean;
  caseNames?: string[];
  help?: boolean;
  listCases?: boolean;

  // AWS
  awsRegion: string;
  awsProfile: string;
  inventoryTable: string;
  ordersTable: string;
  shipmentsTable: string;

  poll: PollWindows;
}

export function defaultConfig(): RegressionConfig {
  return {
    store: "US",
    repeat: 1,
    reportDir: "./reports",
    verbose: true,
    help: false,
    listCases: false,
    awsRegion: process.env.AWS_REGION ?? "ap-southeast-2",
    awsProfile: process.env.AWS_PROFILE ?? "staging",
    inventoryTable: "staging-inventory-v2",
    ordersTable: "staging-orders-v2",
    shipmentsTable: "staging-shipments",
    poll: { ...DEFAULT_POLL_WINDOWS },
  };
}

export function customerFor(config: RegressionConfig): Customer {
  return BASELINE_CUSTOMERS[config.store];
}

export function validateConfig(config: RegressionConfig): void {
  if (config.store !== "US" && config.store !== "PS") {
    throw new Error(`store must be US or PS, got ${config.store}`);
  }
  if (config.repeat < 1) {
    throw new Error("repeat must be >= 1");
  }
}
