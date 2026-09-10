# Slice R3, update semantics, the half that needs no Cin7 revision

**Ticket:** BUSY-1159, AC6
**Cases:** TC3, TC21, TC21b, and the replay half of BUSY-1160's version guard
**Depends on:** R4, done. Uses the four orders R4 sent on 2026-09-04.
**Estimated:** one session
**Supersedes:** the original `R3-update-semantics.md`, which was written around a sequence of live
Cin7 edits and was invalid on its face. Cin7 is read-only for everyone. The Cin7-revision-dependent
cases moved to `_parked-cin7-revision-cases.md`.

## What this slice can still prove

Three of the four case groups in the old R3 never needed a Cin7 write at all:

* **TC3** resets the watermark behind an order already sent. That is an SSM write, ours.
* **TC21 and TC21b** re-poll an unchanged order. That is a poller invoke, ours.
* **The version guard's replay half** is the same action as TC3: the poller sees an order whose stored
  last-modified value is not older than what Cin7 returns, which is exactly a replayed revision.

Only the "genuine later edit in a new modified-date tick" half needs a real revision, and that is
parked.

So TC3, TC21 and TC21b can be verified against the 1160 build today, and they are three of the four
rows the whole re-test was called for.

## The fixture, already in hand

R4 sent four ECOM orders on 2026-09-04 in one scheduled cycle:

| Reference | Cin7 modifiedDate | Brand |
|---|---|---|
| `261842` | 2026-09-04T02:24:05Z | THRILLS |
| `261843` | 2026-09-04T02:24:04Z | THRILLS |
| `261844` | 2026-09-04T02:24:02Z | THRILLS |
| `WOR19169A` | 2026-09-04T02:22:26Z | WORSHIP |

`261842`'s SCALE `ShipmentId` is `18145142-944e-54db-9b3a-2bcc6a8e7777`. The others are readable from
the `shipmentId` field on the shipment header row in `staging-shipments`, which R4 found, rather than
by searching on `cin7Id`.

Four orders in one cycle is more useful than one. A guard that suppresses all four identically is a
per-order guard; one that suppresses the cycle is something else. Use all four.

## Preconditions

```bash
aws sts get-caller-identity --profile staging
./cin7-watermark.sh --stage staging --profile staging --poller so
./check-ctc-status.sh --stage staging --profile staging
```

Expect the watermark at `2026-08-28T01:35:45.769Z`. **Restore it at teardown, read it back.**
`--poller so` on every call, the flag defaults to `item`.

Poller schedule is DISABLED and stays that way. TC3 and TC21 do not need the schedule the way TC1
does, so a manual `invoke-so-poller.sh` is correct here. State in the result that each cycle was
manual.

## The counter vocabulary, from R5's raw cycle log

R5 captured a complete `Cin7SOPollerCycleComplete` line, so this slice knows exactly which counters
exist and can name the one it expects to move rather than hunting:

```
ordersFetched  created  updated  cancelled  staleSkipped  echoSkipped
skippedLocallyTerminal  skippedCounted  skippedZeroUnitOrders  pendingCreates
oversized  skippedZeroQty  skippedNoSizes  packingBrandMisses  skippedStages
watermarkAdvanced  newWatermark
```

`updated` and `cancelled` are new since the 1160 deploy and both read 0 in R5's cycle. Note where they
sit in every cycle this slice runs.

## Setup

Baseline every one of the four orders before touching the watermark:

* transaction row list, `../../BUSY-1159/scripts/list-transaction-rows.sh`
* `wmsSentAt` on each shipment header
* row counts, `inspect-ctc-order.sh`

Print all of it in the result. Every case below is diffed against it.

## Cases

### TC3, reset the watermark behind orders already sent

Trigger: set the watermark to `2026-09-04T02:22:25Z`, one second before `WOR19169A`'s
`modifiedDate`, so all four fall inside the window. Confirm with a direct Cin7 GET over the poller's
actual window (watermark minus its own 5 minute lookback, to invoke time) how many orders that window
holds, **before** invoking. R5 found the poller's real window ran wider than the watermark implied and
swept in two orders that were not intended.

Then one manual invoke.

Expect: nothing written, nothing re-sent. `wmsSentAt` unchanged on all four, no new transaction rows.

Under 1160 the mechanism should now be the version guard, and the counter that should move is
`staleSkipped`, since a replayed revision at an equal or older modified date is stale by definition.

Capture: the full cycle-complete line, `wmsSentAt` before and after on all four, transaction rows
before and after, and which counter moved by how much.

Fails if: any order re-sends, or a second transaction row appears.

### TC21, re-poll unchanged outside the dedupe window

Trigger: the same action as TC3 but more than 5 minutes after the last send, so the dedupe window is
not what suppresses it. R4's cycle completed at `02:48:02.509Z`, so any run today is already well
outside it. Say the elapsed time in the result.

Expect: no second transaction row, no second send.

### TC21b, name the guard

This is the case, not a footnote to TC21.

TC21b's expected result is that the guard that suppressed the replay is **named**. It was recorded
PASS on an unnamed suppression, and the 2026-09-02 audit corrected it to INCONCLUSIVE. **An unnamed
suppression is a FAIL here.** Do not repeat that error.

Four candidate mechanisms, and the evidence that distinguishes them:

1. **the version guard**, which should move `staleSkipped`
2. **the idempotency key** (event, brand, order reference, Cin7 modified date), which should move
   `echoSkipped`
3. **`skippedLocallyTerminal`**, an order already in a terminal state on our side
4. **a create-only branch that does nothing on a present order**, which was slice 09's suspicion and
   which BUSY-1160 should have removed

Say which one fired, from a counter that moved plus a log line, not by elimination.

**R5 makes a fifth outcome live and it is the one to watch for.** R5 measured two orders that were
fetched and then vanished with every counter at zero and no log line at all. If the four orders here
are suppressed the same way, with `ordersFetched=4` and every skip counter at zero, that is not a
guard. That is the same silent drop, now reproduced on ECOM rather than wholesale, and it is a much
bigger finding than TC21b. Stop and tell JJ if that happens.

Capture: counters before and after, transaction rows before and after, and the literal log line if one
exists. If nothing is logged by any of the four mechanisms, record INCONCLUSIVE and list what you
looked for.

### The version guard, replay direction only

Trigger: covered by TC3. State the outcome as version-guard evidence separately from TC3's own row,
because the two cases are asking different questions of the same action: TC3 asks whether anything
re-sends, the guard case asks whether the stored last-modified value is what stopped it.

Capture: the order's stored last-modified value, read before and after the cycle.

**The other direction is parked.** A genuine later edit in a new modified-date tick needs a Cin7
revision. Record the guard as HALF MEASURED and say plainly that a guard which blocks everything and
a guard which discriminates are not distinguished by this slice. That distinction matters: a guard
that blocks everything presents in production as silently stale shipments.

## Data handling

R1 hit this and it is worth stating as a rule. Do not use `cut -c`, `head -c` or any width-based
truncation as redaction on log output. Select fields explicitly with `--query` or `jq` and print only
those. Width truncation on a line containing customer data prints customer data.

## Teardown

* Restore the watermark to `2026-08-28T01:35:45.769Z` and read it back.
* Confirm the poller schedule is still DISABLED.
* Leave all four orders in place. R6 reads them in the SCALE UI.

## Write results to

`results/R3-update-semantics-no-cin7-write.md`.

Include proposed new wording for TC3, TC21 and TC21b's Expected Result columns, since 1160 changed
what the correct mechanism is even where the observable outcome is unchanged. The QA doc edit happens
in R7.

Update `STATE.md` before you finish.

## Stop and ask JJ if

* the four orders vanish from the cycle with every counter at zero, reproducing R5's silent drop on
  ECOM orders. That would make the drop general rather than wholesale-specific and it is the most
  important thing this pass could find.
* any order re-sends.
* `updated` or `cancelled` moves on a replay, which would mean a replayed revision is being treated
  as a real one.
* the poller's actual window sweeps in references beyond the four, since other people's fixtures then
  moved.
