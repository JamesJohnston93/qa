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
// Baseline customers — no pre-existing Shopify customer GID is used. Orders
// are placed with just an email + name; Shopify creates/attaches the
// customer record automatically on first use of that email (confirmed by
// JJ, 2026-07-17). Previously this pointed at an existing staff customer
// (Jared Davis) — replaced with a dedicated QA-automation identity per store
// so test orders are clearly attributable in Shopify admin.
// ---------------------------------------------------------------------------

export interface Customer {
  email: string;
  firstName: string;
  lastName: string;
}

export const BASELINE_CUSTOMERS: Record<Store, Customer> = {
  US: {
    email: "QAauto@universalstore.com.au",
    firstName: "JJQA",
    lastName: "AutoUS",
  },
  PS: {
    email: "QAauto@perfectstranger.com.au",
    firstName: "JJQA",
    lastName: "AutoPS",
  },
};

/**
 * Per-stage polling timeouts (seconds).
 *
 * Tuned 2026-07-22 from 71 case runs across 10 reports (both stores, live
 * staging, 2026-07-17 through 2026-07-22 incl. the US+PS full-set --repeat 3
 * baseline). Observed p90/max per runner.ts stage:
 *   orders_table              p90=10.8s  max=25.7s
 *   allocation (shipments+allocation combined budget)  p90=20.3s  max=35.4s
 *   refund                    p90=16.6s  max=16.7s (25 samples only)
 *   cleanup                   p90=25.3s  max=50.6s (23 samples, widest variance)
 *   inventory                 p90=0.1s   max=55.7s (single pre-fix outlier,
 *                             order #9703, caused by the aggregate-location
 *                             false-decrement bug fixed the same day — see
 *                             CLAUDE.md; everything since is ~0-0.1s)
 * Windows below keep 2-5x headroom over observed max, not just p90 — a stage
 * passing near its timeout is itself a drift signal worth re-tuning for.
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
  ordersTable: 60,
  shipmentsTable: 40,
  allocation: 50,
  refund: 90,
  cleanup: 120,
  inventory: 60,
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
