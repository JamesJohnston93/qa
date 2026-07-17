/**
 * Polling helpers for the asynchronous staging pipeline.
 *
 * Every downstream effect (orders-v2 row, shipment allocation, inventory
 * decrement, refund) arrives some seconds after the Shopify order completes.
 * pollUntil() re-checks a condition at a fixed interval until it holds or the
 * stage's timeout expires, and records how long the stage actually took —
 * those timings feed back into PollWindows tuning and are themselves a drift
 * signal.
 */

export class StageTimeout extends Error {
  readonly stage: string;
  readonly timeout: number;
  readonly lastValue: unknown;

  constructor(stage: string, timeout: number, lastValue: unknown) {
    super(
      `stage '${stage}' did not reach expected state within ${timeout.toFixed(0)}s; ` +
        `last observed: ${describe(lastValue)}`,
    );
    this.name = "StageTimeout";
    this.stage = stage;
    this.timeout = timeout;
    this.lastValue = lastValue;
  }
}

export interface PollResult<T> {
  value: T; // the value that satisfied the predicate
  elapsed: number; // seconds until the predicate held
  attempts: number;
}

function describe(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Repeatedly calls fetch() until predicate(value) is true.
 *
 * Returns a PollResult (with the satisfying value and elapsed time), or
 * throws StageTimeout carrying the last observed value — which goes straight
 * into the failure report as "actual".
 *
 * fetch() errors are NOT swallowed: a reader error is a hard failure, not
 * something to retry past (retries for transient network errors belong in
 * the clients, not here).
 */
export async function pollUntil<T>(
  fetch: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  timeout: number,
  interval: number,
  stage: string,
  verbose = false,
): Promise<PollResult<T>> {
  const start = Date.now();
  let attempts = 0;
  let value: T;

  for (;;) {
    value = await fetch();
    attempts += 1;
    if (predicate(value)) {
      const elapsed = (Date.now() - start) / 1000;
      if (verbose) {
        console.log(`    [poll] ${stage}: ok after ${elapsed.toFixed(1)}s (${attempts} checks)`);
      }
      return { value, elapsed, attempts };
    }

    const elapsed = (Date.now() - start) / 1000;
    if (elapsed >= timeout) {
      throw new StageTimeout(stage, timeout, value);
    }
    if (verbose) {
      console.log(`    [poll] ${stage}: waiting... (${elapsed.toFixed(0)}s / ${timeout.toFixed(0)}s)`);
    }
    await sleep(interval * 1000);
  }
}
