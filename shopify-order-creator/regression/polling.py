"""
Polling helpers for the asynchronous staging pipeline.

Every downstream effect (orders-v2 row, shipment allocation, inventory
decrement, refund) arrives some seconds after the Shopify order completes.
poll_until() re-checks a condition at a fixed interval until it holds or the
stage's timeout expires, and records how long the stage actually took — those
timings feed back into PollWindows tuning and are themselves a drift signal.
"""

import time
from dataclasses import dataclass


class StageTimeout(Exception):
    """A pipeline stage did not reach the expected state within its window."""

    def __init__(self, stage: str, timeout: float, last_value):
        self.stage = stage
        self.timeout = timeout
        self.last_value = last_value
        super().__init__(
            f"stage '{stage}' did not reach expected state within {timeout:.0f}s; "
            f"last observed: {last_value!r}"
        )


@dataclass
class PollResult:
    value: object          # the value that satisfied the predicate
    elapsed: float         # seconds until the predicate held
    attempts: int


def poll_until(
    fetch,                 # () -> value: reads current state from a system
    predicate,             # (value) -> bool: True when the expected state holds
    timeout: float,
    interval: float,
    stage: str,
    verbose: bool = False,
) -> PollResult:
    """
    Repeatedly calls fetch() until predicate(value) is True.

    Returns a PollResult (with the satisfying value and elapsed time), or
    raises StageTimeout carrying the last observed value — which goes straight
    into the failure report as "actual".

    fetch() exceptions are NOT swallowed: a reader error is a hard failure,
    not something to retry past (retries for transient network errors belong
    in the clients, not here).
    """
    start = time.monotonic()
    attempts = 0
    value = None
    while True:
        value = fetch()
        attempts += 1
        if predicate(value):
            elapsed = time.monotonic() - start
            if verbose:
                print(f"    [poll] {stage}: ok after {elapsed:.1f}s ({attempts} checks)")
            return PollResult(value=value, elapsed=elapsed, attempts=attempts)

        elapsed = time.monotonic() - start
        if elapsed >= timeout:
            raise StageTimeout(stage, timeout, value)
        if verbose:
            print(f"    [poll] {stage}: waiting... ({elapsed:.0f}s / {timeout:.0f}s)")
        time.sleep(interval)
