# Cin7 Sales Order 261115 — Carrier Mapping Check

Source: `./find-cin7-sales-order.sh --reference '#261115' --raw`
(Plain `--reference 261115` returned no matches; the order's `reference` field
in Cin7 is stored with a leading `#`, so the retry with `--reference '#261115'`
found it on the first page — `--any-branch` was not needed.)

Cin7 internal id: `964484`

Note: customer name, address, email, phone, and tracking code from the raw
response have been deliberately omitted/redacted below per epic risk 17.

## Requested fields

| Field | Value |
|---|---|
| `logisticsCarrier` | `"Australia Post"` |
| `createdDate` | `"2026-08-27T23:41:52Z"` |
| `estimatedDeliveryDate` | `"2026-08-27T23:41:52Z"` |
| `customerOrderNo` | `null` |
| `projectName` | `"ShopifyV2_thrills"` |
| `stage` | `"Dispatched"` |
| `status` | `"APPROVED"` |
| `modifiedDate` | `"2026-08-30T23:15:58Z"` |

All eight fields are present in the response (none absent) — `customerOrderNo`
is present but its value is `null`.

## Top-level fields matching "carrier" (case-insensitive)

| Field | Value |
|---|---|
| `logisticsCarrier` | `"Australia Post"` |

`logisticsCarrier` is the only top-level field whose name contains "carrier".
No other carrier-named field exists at the top level of the response.

## Verdicts

- **Q-A — is `logisticsCarrier` populated on this order?** Yes: `logisticsCarrier = "Australia Post"`, matching the Cin7 UI's Carrier value, and it is the field the LLD per-type matrix maps ECOM Carrier from — so Dynamo's `carrier: UNASSIGNED` and Manhattan SCALE's missing carrier both reflect a mapping/propagation gap downstream of Cin7, not a missing value at the source.
- **Q-B — do `createdDate` and `estimatedDeliveryDate` differ?** No: both are the identical raw timestamp `2026-08-27T23:41:52Z`, confirming the UI's matching display (28-08-2026 09:41 local) is not a display-rounding coincidence — the two fields genuinely hold the same instant on this order.
