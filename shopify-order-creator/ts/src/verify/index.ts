/**
 * Assertion helpers. Every failure throws VerificationError carrying
 * expected vs actual from each system — reports include enough evidence to
 * raise a defect without re-running.
 */

export interface VerificationErrorShape {
  check: string;
  expected: unknown;
  actual: unknown;
  detail?: string;
}

export class VerificationError extends Error {
  readonly check: string;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly detail: string;

  constructor(check: string, expected: unknown, actual: unknown, detail = "") {
    super(`${check}: expected ${describe(expected)}, got ${describe(actual)}` + (detail ? ` — ${detail}` : ""));
    this.name = "VerificationError";
    this.check = check;
    this.expected = expected;
    this.actual = actual;
    this.detail = detail;
  }

  toDict(): VerificationErrorShape {
    return { check: this.check, expected: this.expected, actual: this.actual, detail: this.detail };
  }
}

function describe(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export * from "./fulfilment";
export * from "./allocation";
export * from "./rejects";

// TAA-52's three new modules (holds.ts, finalisation.ts, transactions.ts)
// deliberately follow orders.ts/shipments.ts's convention — imported
// directly by callers (`from "./verify/holds"`, etc.) — rather than being
// re-exported here. In practice every existing consumer (runner.ts, every
// *.test.js) already imports every verify module directly regardless of
// what this file re-exports, so the re-exports above are unused by any
// current caller; not re-exporting is the more honest reflection of that,
// and keeps holds/finalisation/transactions consistent with the other
// orders-v2/staging-shipments read-based modules (orders.ts, shipments.ts)
// rather than the result-of-an-action modules above (fulfilment/allocation/
// rejects).
