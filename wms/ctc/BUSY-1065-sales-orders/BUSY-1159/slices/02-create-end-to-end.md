# Slice 02, create end to end

**Ticket:** BUSY-1159
**Cases:** TC1, TC1b, TC2, TC8
**Depends on:** slice 01 (access confirmed, baseline captured in fixtures.md)
**Estimated:** one session, with two waits of a few minutes

An order can be create tested only once, because the feed creates on first sight and `clean-ctc-order.sh` refuses staging. Choose the order deliberately and record it before starting.

## Preconditions

* Slice 01 passed, `AWS_PROFILE` known.
* Poller schedule rule enabled:
```bash
aws events describe-rule --name staging-orders-cin7-so-poller-rule --profile "$AWS_PROFILE" --region ap-southeast-2 --query 'State'
```
* Every product option code on the chosen order exists in the SCALE staging item master. Spot check first. A missing code fails the whole shipment and would be read as a flow defect.

## Setup

```bash
cd ~/Desktop/QA/wms/ctc
./find-cin7-sales-order.sh --group 'Retail - Ecomm' --max-pages 2 --with-contact
```
Choose one order. Record its reference, `modifiedDate`, `branchId`, `projectName` and line items in `fixtures.md`. Prefer an Australian delivery address, since an international one is a deliberate hard error.

Set the watermark to a few minutes before that `modifiedDate`, keeping the window narrow:
```bash
./cin7-watermark.sh --stage staging --profile "$AWS_PROFILE" --poller so --set 2026-08-27T01:00:00.000Z --confirm
./cin7-watermark.sh --stage staging --profile "$AWS_PROFILE" --poller so
```
The second call is not optional. `--set` without `--confirm` is a dry run, and SSM pickup has been seen to lag by more than one cycle on this project.

## Cases

### TC1, unattended create
Trigger: wait for the next scheduled cycle. **Do not invoke anything by hand.** A manual invoke invalidates this case and TC11.
Expect: one cycle summary with `created` at least 1 and `watermarkAdvanced: true`, no alert line, then the sender logging `accepted=1 rejected=0`, then the Shipment visible in SCALE staging under the reference with the leading `#` stripped.
Capture:
```bash
aws logs filter-log-events --log-group-name /aws/lambda/staging-orders-cin7-so-poller \
  --profile "$AWS_PROFILE" --region ap-southeast-2 --start-time <epoch-ms> \
  --filter-pattern '{ $.metric = "Cin7SOPollerCycleComplete" }'

aws logs filter-log-events --log-group-name /aws/lambda/staging-shipping-manhattan-send-shipment \
  --profile "$AWS_PROFILE" --region ap-southeast-2 --start-time <epoch-ms> \
  --filter-pattern '<reference>'
```
Record the cycle summary counters and the `ManhattanRequestOutcome` line. Redact the XML excerpt before it leaves the result file.
Fails if: nothing is created, or the sender reports rejections, or SCALE holds no Shipment. Rule out the item master first.

### TC1b, latency
Trigger: none, this reads TC1's evidence.
Expect: gap from the order's Cin7 `modifiedDate` to `wmsSentAt` around 3 minutes, and no more than 5.
Capture: both values and the computed gap.
Fails if: over 5 minutes. Record which of the two log groups the delay sits between, since that is what makes the finding actionable.

### TC2, CTC stamps and no reallocation
Trigger:
```bash
./inspect-ctc-order.sh --stage staging --profile "$AWS_PROFILE" --reference <reference-without-#>
```
Expect: order row carrying `origin` as `CTC#CIN7_SO#<reference>`, `store CTC`, `orderType ECOM`, the Cin7 id, `allocatedStore` as the branch id, `warehouse`, `packingBrand`, `carrier UNASSIGNED`, `status OPEN`, and a scheduled ship date. Shipment header carrying `company CTC`, `brand CTC`, `status OPEN`, `holdStatus false`, the same warehouse and carrier, and `wmsSentAt`. Shipment items one per unit, `company CTC`, a line item id set, and **no** `quantity` field.
Capture: the full stamp set, and the absence of the reference from any reallocation log.
Fails if: a stamp is missing on read back. That is the silently dropped attribute failure mode, since unknown attribute saving is off.

### TC8, exactly one of everything
Trigger: the same `inspect-ctc-order.sh` output, plus the cycle summary from TC1.
Expect: one order row, one transaction row, one shipment header. The feed log shows a single event emitted.
Capture: the row counts.

### Capture job, the first staging send
This is the first ECOM send to SCALE staging, and the LLD defers three things to exactly this moment rather than designing them: the mandatory field set per order type, the valid `CommentType` values, and the XML element ordering rule. Whatever SCALE accepts or rejects here is the answer, and it belongs back in the LLD's per-type matrix.
Capture: which elements were present in the accepted document, any element SCALE named in a rejection, the `CommentType` value used if the order carried `internalComments`, and confirmation that the XSD sequence ordering was accepted. Record these under a separate heading in the result file, not mixed into TC1's evidence, and flag them for Lachlan.
This is not a pass or fail. It is the design answering itself.

## Teardown

Leave the watermark where the poller advanced it. Do not reset it in this slice, slice 03 needs the current value. Disable the schedule rule if no further slice runs today, and say so in the result file.

## Scripts

Anything with logic in it gets saved to `scripts/` and indexed in `SCRIPTS.md` before it is run. Read `SCRIPTS.md` and `../../tools/SCRIPTS-INDEX.md` first, extending an existing script beats writing an overlapping one. Header format and rules are in `CLAUDE.md`. Name every script you saved in the result file, with its review state.

## Write results to

`results/02-create-end-to-end.md`, and write the reference, `modifiedDate` and `wmsSentAt` into `fixtures.md`. Slices 03 and 06 read them from there.

## Also hand to the manual list

TC1a, the SCALE UI mapping read on this same Shipment.
