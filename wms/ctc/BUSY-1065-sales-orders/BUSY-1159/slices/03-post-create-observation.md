# Slice 03, post create observation

**Ticket:** BUSY-1159
**Cases:** TC3, TC4, TC12, TC13
**Depends on:** slice 02 (reference and watermark value in fixtures.md and results/02)
**Estimated:** one session, one wait of a few minutes

Nothing here creates anything. Every case observes the order slice 02 already put through.

## Preconditions

* The slice 02 order is live in SCALE with `wmsSentAt` set.
* Poller schedule rule enabled.
* Run within the same day as slice 02 so the consumer log windows still cover the create.

## Setup

```bash
cd ~/Desktop/QA/wms/ctc
export AWS_PROFILE=<staging-profile>
REF=<reference-without-#>        # from fixtures.md
./cin7-watermark.sh --stage staging --profile "$AWS_PROFILE" --poller so   # record current value first
```

## Cases

### TC3, replay is idempotent
Trigger: set the watermark back to the value slice 02 used, then wait one cycle.
```bash
./cin7-watermark.sh --stage staging --profile "$AWS_PROFILE" --poller so --set <slice-02-value> --confirm
./cin7-watermark.sh --stage staging --profile "$AWS_PROFILE" --poller so
```
Expect: cycle summary shows the order fetched and `created: 0`. No new sender log line, `wmsSentAt` unchanged, still one order row, one transaction row, one shipment header.
Capture: the cycle summary counters, and `inspect-ctc-order.sh` output compared against slice 02's.
Fails if: a second shipment, a second send, or a changed `wmsSentAt`.

### TC4, create on first sight only
Trigger: none beyond TC3. This is TC1 and TC3 read together.
Expect: the order is left alone on the second sighting. If it happened to change in Cin7 between the two cycles, the SCALE shipment is still unchanged.
Capture: whether the order did in fact change in Cin7 between cycles, since an unchanged order makes this a weaker result. Tag MEASURED or INFERRED accordingly.
Fails if: an update reaches SCALE. Note the opposite is **not** a failure. Update is BUSY-1160 and its absence must not be raised here.

### TC12, consumer guard sweep
Trigger:
```bash
./check-ctc-consumer-guards.sh --stage staging --profile "$AWS_PROFILE" --reference "$REF" --since-min 120
```
Allow at least 10 minutes after the create before trusting any negative result. Some consumers log late.
Expect: every guarded consumer reported as skipped, whether by an explicit skip marker or by silence. The Manhattan sender is the one that should have run.
Capture: the per consumer verdict. The Segment row is the one that matters most, because a CTC ecom order carries a real customer email and the incidental empty email guard that protects purchase orders does not fire here.
Fails if: Segment, CX notifications, pickslip, dc-packing, Shopify, NewStore or reallocation acted on the order. These are BUSY-1158's acceptance criteria, so record the finding against BUSY-1158 and flag it to Kian immediately rather than filing it under this ticket.

### TC13, echo guard hash written
**Raised in priority.** The LLD makes this hash the only thing standing between the confirmation leg and an alert storm, and no ticket in the epic says who writes it. BUSY-1160's description does not mention it at all.

Trigger:
```bash
aws dynamodb get-item --table-name staging-orders-v2 --profile "$AWS_PROFILE" --region ap-southeast-2 \
  --key '{"PK":{"S":"<order PK from inspect output>"},"SK":{"S":"<order SK>"}}' \
  --query 'Item.lastEmittedPayloadHash'
```
If the key shape from `inspect-ctc-order.sh` differs, use that output rather than guessing.
Expect: `lastEmittedPayloadHash` present on the order row, populated on create.
Capture: present or absent, and the attribute name actually used if it differs from the LLD's.
Why it matters, in full: picked stages are eligible by design (see TC14). When the confirmation leg writes `Fully Picked` into Cin7 on the first pick, it bumps `modifiedDate`, so the next poll re-reads the order as live work. What stops that poll re-sending it is the payload hash showing the mapped payload is unchanged. Without the hash, every first pick becomes a fresh SAVE against a shipment SCALE is actively picking, which SCALE rejects, which alerts. The two mechanisms only work as a pair.
Fails if: absent. Not a BUSY-1159 acceptance criterion, so record it as a finding for Lachlan against the LLD and note that no epic ticket currently owns it. Severity is low today, because the confirmation leg does not exist yet, and high the moment it does.

## Teardown

Leave the watermark at its advanced value. Disable the schedule rule if no further slice runs today.

## Scripts

Anything with logic in it gets saved to `scripts/` and indexed in `SCRIPTS.md` before it is run. Read `SCRIPTS.md` and `../../tools/SCRIPTS-INDEX.md` first, extending an existing script beats writing an overlapping one. Header format and rules are in `CLAUDE.md`. Name every script you saved in the result file, with its review state.

## Write results to

`results/03-post-create-observation.md`
