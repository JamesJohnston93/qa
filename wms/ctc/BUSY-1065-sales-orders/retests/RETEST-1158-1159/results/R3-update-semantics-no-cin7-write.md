# Result: Slice R3, update semantics, the half that needs no Cin7 revision

**Ticket:** BUSY-1159, AC6
**Verdict:** Baseline captured for all four orders. **TC3, TC21, TC21b and the version guard's replay
half were NOT run.** Between R9 finishing (03:43:46Z) and this slice starting (~03:55Z), a large
dispatch batch moved through Cin7 (roughly 90-100 orders, `03:25:06Z` to `03:26:29Z`) that splits the
four target orders across a boundary no single watermark window can bridge without an unacceptable
sweep. Stopped before touching the watermark, same stop condition R8 hit, and one this slice names
explicitly: "the poller's actual window sweeps in references beyond the four, since other people's
fixtures then moved."

## Preconditions

MEASURED. Staging identity confirmed. Watermark `2026-08-28T01:35:45.769Z`, matches expectation.
`check-ctc-status.sh`: unchanged from every prior check, poller schedule DISABLED, stage-5 DLQ 0,
stage-2 DLQ 2 (the same non-CTC pair, carried since R0).

## Setup, baseline captured before anything else

| Reference | TRANSACTION rows | ORDERS rows | SHIPMENTS rows | `wmsSentAt` |
|---|---|---|---|---|
| `261842` | 1 (`CREATE_ORDER`) | 4 (1 ORDER, 1 ITEM, 1 ADDRESS, 1 TRANSACTION) | 4 | 2026-09-04T02:48:43.898Z |
| `261843` | 1 (`CREATE_ORDER`) | 4 | 4 | 2026-09-04T02:48:39.505Z |
| `261844` | 1 (`CREATE_ORDER`) | 4 | 4 | 2026-09-04T02:48:42.083Z |
| `WOR19169A` | 1 (`CREATE_ORDER`) | 4 | 4 | 2026-09-04T02:48:48.194Z |

Every one exactly one transaction row, one order row, one item row, one address row, one shipment
header, `status OPEN` throughout. This is the baseline every case below would have diffed against.

## What changed between R9 and this slice starting

R9's run (03:43:46Z) already showed `261842`, `261843` and `261844` at `Dispatched` (revised since
R4 sent them). Re-checking live Cin7 state directly for all four immediately before setting anything:

```
#261842      Dispatched   2026-09-04T03:26:26Z
#261843      Dispatched   2026-09-04T03:25:27Z
#261844      Dispatched   2026-09-04T03:26:27Z
#WOR19169A   Processing   2026-09-04T02:22:26Z   (unchanged since R4 created it)
```

**`WOR19169A` still has not moved, over 90 minutes after R4 created it, while its three siblings from
the same cycle all dispatched.** INFERRED, not measured: `WOR19169A` is the one Worship-branded order
of the four (the other three are THRILLS), so a brand-specific difference in whatever process just
dispatched the batch is one possible explanation; not confirmed, worth naming rather than leaving
unremarked.

## Why TC3/TC21/TC21b were not run

The slice's own method: set the watermark one second before the earliest target's `modifiedDate`,
confirm the poller's real window (watermark minus its own 5 minute lookback, to invoke time) before
committing, then one manual invoke.

**Following that method exactly surfaced the problem before anything was touched.** A window bounded
one second before `WOR19169A`'s `modifiedDate` (`2026-09-04T02:22:25Z`, lookback-adjusted to
`02:17:25Z`) was counted directly against Cin7: **103 orders** (100 on page 1, 3 on page 2), not four.
Between `02:17:25Z` and roughly `03:26:29Z`, a large batch of orders across both CTC branches moved to
`Dispatched` in a tight burst (`03:25:06Z` to `03:26:29Z`, by timestamp density almost certainly one
warehouse batch-dispatch job, not organic one-at-a-time activity) - `261843`, `261837`, `261838`,
`261839`, `261842`, `261844` and roughly 90-plus other references from this plan's earlier sessions and
otherwise all sit inside that burst.

**No watermark placement captures all four targets without also capturing that burst.** The burst runs
directly through the middle of where three of the four targets now sit
(`261843@03:25:27Z` ... `261844@03:26:27Z`); `WOR19169A@02:22:26Z` sits over an hour before it. A
watermark late enough to skip the burst (after `03:26:29Z`) excludes `WOR19169A` and all three others.
A watermark early enough to include `WOR19169A` necessarily includes the entire burst, because the
poller processes everything between the watermark and invoke time with no upper bound.

**This is materially different from R5's "two extra orders" or even R8's wholesale case.** These ~100
orders have never been polled by this system (the schedule has been off since 2026-08-28, and every
prior invoke this pass used a window narrow enough to exclude them). A window this wide would not be
"re-checking an update guard" - it would be a **mass first-time CREATE** for roughly 100 previously
untouched references, each triggering the full downstream fan-out this plan has spent five sessions
characterising one or four orders at a time. Not attempted.

## Fails if / Stop and ask JJ

**Stopping, per this slice's own listed condition:** "the poller's actual window sweeps in references
beyond the four, since other people's fixtures then moved." They did, in volume, not just the two R5
saw. Nothing was written: no watermark change, no invoke, no schedule change.

**This is worth surfacing beyond just this slice.** R8 stopped for the same class of reason (a
223-order sweep) less than fifteen minutes before this slice started. Two slices in a row hitting a
blast-radius stop suggests the "narrow window" assumption this whole revised plan runs on may not hold
right now, whatever is producing this order volume (a scheduled batch job, other testing, real traffic)
is active in this shared environment today. Recommend checking again once traffic looks quieter, rather
than treating this as a one-off.

## Recommendation

* Re-run R3 once a watermark window can be found that holds close to just the four targets. Given
  `WOR19169A` is now separated from its three siblings by the burst, that may mean running it as two
  separate narrower attempts (the three dispatched siblings in one window, `WOR19169A` alone in
  another) rather than the original "all four in one cycle" design, if a clean window for each
  presents itself.
* Consider adding a coarse volume check to the start of any future watermark-setting case in this
  plan: count the real window before committing, as this slice's own method already requires, and treat
  "much larger than the target count" as a hold rather than proceeding, which is what happened here.

## Teardown

None needed. Nothing was changed: watermark still `2026-08-28T01:35:45.769Z` (confirmed read back),
poller schedule still `DISABLED` (confirmed).
