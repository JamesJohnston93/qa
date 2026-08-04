"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.StageTimeout = void 0;
exports.resolveInterval = resolveInterval;
exports.sleep = sleep;
exports.pollUntil = pollUntil;
class StageTimeout extends Error {
    stage;
    timeout;
    lastValue;
    constructor(stage, timeout, lastValue) {
        super(`stage '${stage}' did not reach expected state within ${timeout.toFixed(0)}s; ` +
            `last observed: ${describe(lastValue)}`);
        this.name = "StageTimeout";
        this.stage = stage;
        this.timeout = timeout;
        this.lastValue = lastValue;
    }
}
exports.StageTimeout = StageTimeout;
const DEFAULT_RAMP = [1, 2, 3];
/**
 * Resolves the sleep interval (seconds) for the poll attempt just completed.
 * A plain number is treated as a fixed interval (no ramp) — existing callers
 * and offline tests that just want deterministic fast polling keep working
 * unchanged. Pure — offline-testable.
 */
function resolveInterval(attempt, interval) {
    if (typeof interval === "number") {
        return interval;
    }
    const ramp = interval.ramp ?? DEFAULT_RAMP;
    const min = interval.min ?? 0;
    const step = attempt <= ramp.length ? ramp[attempt - 1] : interval.cap;
    return Math.max(min, Math.min(step, interval.cap));
}
function describe(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function sleep(ms) {
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
async function pollUntil(fetch, predicate, timeout, interval, stage, verbose = false, onWaiting) {
    const start = Date.now();
    let attempts = 0;
    let value;
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
        const sleepSeconds = resolveInterval(attempts, interval);
        if (verbose) {
            if (onWaiting) {
                onWaiting(elapsed, attempts);
            }
            else {
                console.log(`    [poll] ${stage}: waiting... (${elapsed.toFixed(0)}s / ${timeout.toFixed(0)}s, next in ${sleepSeconds.toFixed(1)}s)`);
            }
        }
        await sleep(sleepSeconds * 1000);
    }
}
