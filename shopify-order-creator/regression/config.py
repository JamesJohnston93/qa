"""
Explicit configuration for regression runs.

Everything a run needs is carried in a RegressionConfig instance — no module
globals, no interactive prompts. Construct one per run (the runner does this
from CLI args) and pass it down.
"""

import os
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# ATP locations (staging)
# ---------------------------------------------------------------------------

WEB_DC = "ATP#100"          # web distribution centre
STORE_99 = "ATP#99"
CHERMSIDE_US = "ATP#407"    # BRANCH_407 (US)
PS_STORE = "ATP#640"        # BRANCH_640 (PS)

ALL_LOCATIONS = [WEB_DC, STORE_99, CHERMSIDE_US, PS_STORE]


# ---------------------------------------------------------------------------
# Known baseline customers (existing staging customers, from main.py pools)
# ---------------------------------------------------------------------------

BASELINE_CUSTOMERS = {
    "US": {
        "id": "gid://shopify/Customer/8997370954001",
        "email": "jared.davis@universalstore.com.au",
        "first_name": "Jared",
        "last_name": "Davis",
    },
    "PS": {
        "id": "gid://shopify/Customer/22959422669092",
        "email": "jared.davis@universalstore.com.au",
        "first_name": "Jared",
        "last_name": "Davis",
    },
}


@dataclass
class PollWindows:
    """
    Per-stage polling timeouts (seconds).

    Defaults are deliberately generous first guesses. Tighten them from the
    stage timings recorded in run reports ("right-size polling from recorded
    latencies" — scope of work). A stage that only passes near its timeout is
    itself a signal worth investigating.
    """
    interval: float = 5.0            # seconds between polls
    orders_table: float = 120.0      # Shopify order → staging-orders-v2 row
    shipments_table: float = 180.0   # orders-v2 → staging-shipments ITEM# rows
    allocation: float = 240.0        # ITEM# rows → allocated / UNDELIVERABLE
    refund: float = 300.0            # undeliverable → Shopify refund
    cleanup: float = 300.0           # refund → rows removed from AWS tables
    inventory: float = 240.0         # allocation → inventory decrement


@dataclass
class RegressionConfig:
    store: str = "US"                       # "US" or "PS"
    repeat: int = 1                         # identical-run repeats (variance diff)
    report_dir: str = "regression_reports"  # where markdown/JSON reports land
    verbose: bool = True

    # AWS
    aws_region: str = field(default_factory=lambda: os.environ.get("AWS_REGION", "ap-southeast-2"))
    aws_profile: str = field(default_factory=lambda: os.environ.get("AWS_PROFILE", "staging"))
    inventory_table: str = "staging-inventory-v2"
    orders_table: str = "staging-orders-v2"
    shipments_table: str = "staging-shipments"

    poll: PollWindows = field(default_factory=PollWindows)

    def customer(self) -> dict:
        return BASELINE_CUSTOMERS[self.store]

    def validate(self):
        if self.store not in ("US", "PS"):
            raise ValueError(f"store must be US or PS, got {self.store!r}")
        if self.repeat < 1:
            raise ValueError("repeat must be >= 1")
