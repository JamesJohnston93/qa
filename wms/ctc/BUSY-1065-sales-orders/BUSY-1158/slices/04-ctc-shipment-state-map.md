# Slice 04, CTC shipment state map

**Ticket:** BUSY-1158
**Cases:** none. This is a read that decides whether TC4e is runnable at all.
**Depends on:** nothing
**Estimated:** ten minutes, not a full session

## Why this exists and what it must not do

Slice 02 read about a dozen consumers as 0 matches and could not call any of them a pass, because
`261115`'s shipment has sat at `OPEN` since it was created. Those consumers react to states it never
reached.

**Do not produce one.** Accepting or fulfilling a CTC shipment in SCALE is out of this pass by
decision, and it belongs to the confirmation leg (BUSY-1015 to BUSY-1017) rather than to this ticket.
This slice only looks for a shipment that already left `OPEN` by itself.

## The read

`scripts/find-warehouse-uni-order.sh` from slice 03 already scans this table and handles the
pagination. **Extend it or copy its scan loop rather than writing a fresh scanner.** Read `SCRIPTS.md`
first, as `CLAUDE.md` requires.

```bash
aws dynamodb scan --table-name staging-shipments --profile staging --region ap-southeast-2 \
  --filter-expression "#c = :c" --expression-attribute-values '{":c":{"S":"CTC"}}' \
  --projection-expression "PK,SK,#s,createdAt" \
  --expression-attribute-names '{"#s":"status","#c":"company"}'
```

Both `status` and `company` go through `--expression-attribute-names`. `status` is a DynamoDB reserved
word, and `company` is close enough to the reserved list that aliasing it costs nothing and removes
the question.

**The table is about 179,000 items and a filter expression does not reduce what is read, only what is
returned.** Slice 03's scan of the same table took one paginated call. Confirm you have consumed every
page before reporting a distribution: a first-page-only count would report "all `OPEN`" from a sample
that happens to hold no others, which is precisely the wrong answer here and indistinguishable from
the right one. State the total item count scanned in the result file so the number can be checked
against slice 03's 178,868.

Save it as `scripts/list-ctc-shipment-states.sh` and print the count per status. It will be run again,
and the distribution is the deliverable.

## Outcomes

1. **At least one CTC shipment is not `OPEN`.** Record its PK, SK, state and when it got there.
   TC4e becomes runnable against it with no fixture work, and a follow-up slice can be written. Say
   which consumers that particular state would exercise, and which it still would not.
2. **Every CTC shipment is `OPEN`.** Record the count and the date range. TC4e stays BLOCKED and this
   scan is the evidence. That is a finding in itself: no CTC record has ever exercised the later half
   of the shipment lifecycle on staging, so nothing downstream of shipment creation is tested for CTC
   by anyone.

Either way, note whether the BUSY-1159 DLQ references (`261070`, `261073`, `261089`) appear. They are
sender failures, not domain rejections, so they will not have moved a shipment out of `OPEN`. Saying
so explicitly saves the next person reaching for them.

## Write results to

`results/04-ctc-shipment-state-map.md`. Short. The status distribution and one paragraph.

## Stop and ask JJ if

* the scan shows a CTC shipment in a state nobody drove deliberately, since that means something
  moved it and we do not know what
