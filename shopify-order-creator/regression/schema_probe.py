"""
One-shot probe to confirm the key schemas of staging-orders-v2 and
staging-shipments before the first regression run.

    python -m regression.schema_probe                 # describe keys + sample rows
    python -m regression.schema_probe --order 12345   # also search for an order ref

Prints each table's declared key schema (from DescribeTable — authoritative)
and a few sample rows (attribute names only, values truncated) so
TABLE_SCHEMAS in regression/readers/dynamo_reader.py can be filled in with
real formats. Read-only: uses describe_table and a Limit-ed scan.
"""

import argparse
import json

import boto3

from regression.config import RegressionConfig


def _preview(value, max_len: int = 60) -> str:
    text = json.dumps(value, default=str)
    return text if len(text) <= max_len else text[: max_len - 3] + "..."


def probe_table(config: RegressionConfig, table_name: str, order_ref: str | None):
    session = boto3.Session(profile_name=config.aws_profile, region_name=config.aws_region)
    client = session.client("dynamodb")
    resource_table = session.resource("dynamodb").Table(table_name)

    print(f"\n{'=' * 70}\nTABLE: {table_name}")

    desc = client.describe_table(TableName=table_name)["Table"]
    print("Key schema (authoritative):")
    for key in desc["KeySchema"]:
        print(f"    {key['KeyType']:>5}: {key['AttributeName']}")
    for gsi in desc.get("GlobalSecondaryIndexes", []) or []:
        keys = ", ".join(f"{k['KeyType']}={k['AttributeName']}" for k in gsi["KeySchema"])
        print(f"    GSI {gsi['IndexName']}: {keys}")

    print("Sample rows (attribute names + truncated values):")
    sample = resource_table.scan(Limit=3)
    for i, item in enumerate(sample.get("Items", []), 1):
        print(f"  row {i}:")
        for attr, value in sorted(item.items()):
            print(f"      {attr} = {_preview(value)}")

    if order_ref:
        print(f"Searching for rows containing '{order_ref}' (scan, may take a moment)...")
        # Broad contains-scan across likely key attributes; staging tables only.
        found = []
        scan_kwargs = {"Limit": 1000}
        resp = resource_table.scan(**scan_kwargs)
        for item in resp.get("Items", []):
            if order_ref in json.dumps(item, default=str):
                found.append(item)
        if found:
            print(f"  {len(found)} row(s) matched in first page:")
            for item in found[:5]:
                for attr, value in sorted(item.items()):
                    print(f"      {attr} = {_preview(value)}")
                print("      ---")
        else:
            print("  No match in the first scan page — try a more recent order, "
                  "or query the table directly in the AWS console.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--order", help="A recent order reference (Shopify order number/name) to search for")
    args = parser.parse_args()

    config = RegressionConfig()
    for table in (config.orders_table, config.shipments_table):
        probe_table(config, table, args.order)

    print(
        "\nNext: update TABLE_SCHEMAS in regression/readers/dynamo_reader.py "
        "with the real key attrs/formats and remove the UNCONFIRMED flags."
    )


if __name__ == "__main__":
    main()
