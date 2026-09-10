# BUSY-1161 scripts

Ticket-specific scripts live in `scripts/` beside this file. Anything useful to another ticket gets promoted to `../../tools/` and moved to `../../tools/SCRIPTS-INDEX.md`.

**Almost nothing should need writing.** The engineer's toolset covers this ticket's drive surface. Read this file, then that toolset's own READMEs, before writing a line.

| Script | TC | Purpose | What it does NOT check | Read only | Reviewed by |
|---|---|---|---|---|---|
| `check-outbound-chain-deploy.sh` | Slice 01 Gate A | `LastModified`/`CodeSha256`/`Version` for the seven outbound-chain functions plus poller | Deployed code correctness, log recency | yes | unreviewed |
| `check-outbound-queue-mappings.sh` | Slice 01 Gate B | Depth, redrive policy and event source mapping (by `--event-source-arn`) for each of the three outbound queues plus DLQ | Consumer function's own behaviour, message content | yes | unreviewed |

## The engineer's toolset, and where it lives

**`../../tools/`**, beside the epic folders. Credentials come from a `.env` at its root; AWS access is your own SSO profile through `--stage` and `--profile`.

| Tool | What it gives this ticket |
|---|---|
| `cin7-sales-orders/invoke-so-revision.sh` | **The drive tool for almost every case.** Publishes a create, update or cancel built from a fixture. `--family outbound` is mandatory; `--order-type WHOLESALE` or `RTV`; `--event auto` mirrors the poller's own create/update/cancel decision; `--dry-run` is always safe. |
| `cin7-sales-orders/fixtures/wholesale/` | 19 scenarios from a real redacted order, ascending last-modified. Generic to both order types. |
| `cin7-sales-orders/fixtures/rtv/` | Baseline plus a supplier-email revision. **Composed, not captured.** No in-scope RTV exists to capture. |
| `cin7-sales-orders/make-wholesale-scenarios.py`, `make-rtv-baseline.py` | Regenerate the fixtures offline. This is the supported route to a scenario that does not yet exist, such as TC6b's cleared field. |
| `cin7-sales-orders/inspect-ctc-order.sh` | Reads the whole chain for one reference, **including the outbound header, lines and transactions**. The older copy in `../../` has no outbound support. |
| `cin7-sales-orders/check-ctc-status.sh` | Queue and DLQ depths across every stage including the outbound ones, watermark, schedule, alarms. Also newer than `../../`. |
| `cin7-sales-orders/invoke-shipment-sender.sh` | `--family outbound` publishes a ready event onto the shipping bus. It publishes whether or not `--send` is passed. |
| `cin7-sales-orders/stale-payload-hash.sh` | Exercises the poller's own echo guard. **No outbound awareness.** Native only. |
| `common/cin7-watermark.sh` | Slice 07's lever. `--poller` must be passed every time; it defaults silently to the item master. |
| `common/probe-manhattan.sh` | Builds and posts a Shipment document, or a header delete with `--withdraw`. **No read path.** It cannot ask SCALE what it holds. |
| `cin7-sales-orders/clean-ctc-order.sh` | Destructive, hard locked to the `kian-dev` stage with an independent account check. **Not usable on staging**, which is why a reference is single use here. |

## Still worth knowing from the older folder

`../../tools/inspect-lambda-code.sh` reads a deployed Lambda's own artefact. Every source-read verdict in this epic came from it, and the new toolset has no equivalent. Slice 02's fidelity gate needs it.

## Notes

A row here is not a claim that a script is correct. The Reviewed column is the only thing that says a human has read it. Review is deferred by design, JJ's call.

The revision tool carries its own honest limit, and it belongs on every verdict except TC9's: it reimplements the mapping in Python rather than calling the deployed code, so a clean run proves SCALE accepts that document, not that the deployed mapper builds it.
