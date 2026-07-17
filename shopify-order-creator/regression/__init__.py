"""
Deterministic regression package — omni-channel alignment baseline (TAA-3).

Proves that orders place, allocate into shipments, and inventory changes land
correctly across Shopify, AWS (DynamoDB), and NewStore. Headless: no input(),
no module-global state. Run with:

    python -m regression [--cases case1,case2] [--store US|PS] [--repeat N]

Design source of truth: regression-package-design.md (repo) / Confluence
"Regression Package Design — Omni-Channel Alignment Baseline".
"""

__version__ = "0.1.0"
