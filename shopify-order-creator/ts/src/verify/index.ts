/**
 * Assertion helpers. Every failure throws VerificationError carrying
 * expected vs actual from each system — reports include enough evidence to
 * raise a defect without re-running. Ports regression/verify/__init__.py.
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
