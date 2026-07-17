"""
NewStore order read-back (minimal — for baseline cases 7–8, not yet wired
into the runner).

TODO(JJ): confirm the read endpoint. Candidates:
  - GET /v0/d/orders/{order_uuid}          (the notes API uses this base)
  - the external_orders lookup by external_id
Once confirmed, wire NS SFS/OTC cases into cases.py + runner.py.
"""


def get_order(order_uuid: str) -> dict:
    """Fetches an injected order back from NewStore by its UUID."""
    from newstore_client import staging_client  # lazy: needs NS_* env vars
    return staging_client.get(f"/v0/d/orders/{order_uuid}")
