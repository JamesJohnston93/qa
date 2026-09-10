# Results, slice 15 non-PASS sweep 1

Started 2026-09-09 from a Cowork session. **This session cannot reach AWS**: there is no `aws` CLI on
the machine's Cowork shell, so `inspect-lambda-code.sh`, `check-ctc-consumer-guards.sh` and every
DynamoDB and CloudWatch read still need JJ's IDE session. What this session could reach, for the first
time on this epic, is the **monorepo checkout** at `~/Repos/monorepo`.

**Read the checkout caveat before using anything below.** The checkout is on branch
`UNI-1167-cc-reminder-master`, HEAD `dfa2d638d` dated **2026-02-12**, and **has no git remote
configured**, so it cannot be fetched forward. It predates the CTC build entirely: no `cin7`, no
`orders-cin7`, no `so-poller` and no `ctc` path exists anywhere in it. The BUSY-1159 build is PR
\#1568. So this checkout evidences **the pre-CTC shape of the existing UNI consumers**, which is
exactly what the §3 consumer-guard audit is a stance about, and it evidences **nothing** about what
the CTC build changed.

Every claim below is tagged. Nothing here moves a verdict on its own.

---

## S2. TC2, the no-reallocation half

**Ran:** source read only, no AWS. **Route changed from the slice as written**, per the 2026-09-09
LLD re-verification: the LLD asserts reallocation-not-triggered through §11.3 and §11.6 tests, not
through a live log silence, so the search went to source.

### The slice's step 4 premise is false

Slice 15 S2 step 4 offered, as the stronger outcome, "if no reallocation consumer is wired in staging
at all ... reallocation cannot trigger because nothing is subscribed."

**There are three reallocation-related consumers wired, and one of them is on the exact hop the LLD
names.** MEASURED, file and line below. Recording that absence as "MEASURED absence of mechanism"
would have put a false negative in the QA doc.

### The chain, measured

The LLD §3 audit row reads `Reallocation | shipment item creation | Skip`. The trigger in that row is
**correct**. The consumer is one hop further on than the row implies:

`SHIPMENT_ITEM_CREATE` to `create-shipment-items.ts`, which emits a `REALLOCATION` transaction, to
`create-transaction.ts`, which re-emits it as detail type `TRANS_REALLOCATION`, to
`allocate-shipment-items.ts`, which calls the allocator API.

* `services/shipping/lib/constructs/shipment-event-handler.ts:797` maps both
  `'ALLOCATE_SHIPMENT_ITEMS'` and `'TRANS_REALLOCATION'` onto the same worker. MEASURED.
* `services/shipping/lambda/shipment/create-transaction.ts:55-62` re-emits any event as
  `TRANS_${event.event}`. MEASURED.
* `services/shipping/lambda/orders/order-created.ts:75` is what produces `SHIPMENT_ITEM_CREATE` in the
  first place, from `ORDER_CREATED`. MEASURED. That is the hop LLD §9.3 says CTC ECOM rides unchanged.

### The load-bearing finding

`services/shipping/lambda/shipment/create-shipment-items.ts` has exactly **two** branches and no
third. Verified by direct read, not from a summary:

* line 67, `if (isB2BTransfer) { ... }`, which requires items at `deliveryMethod === 'IBT'` and
  derives brand from a `US#NEWSTORE_B2B#`-shaped origin at line 76.
* the `else` branch, commented **`// Regular orders - trigger reallocation`**, which pushes
  `event: 'REALLOCATION'`, `idempotencyId: \`REALLOCATION#${transaction.SK.split('#')[1]}\``,
  `message_group_id: transaction.PK`.

**`grep -nE "isB2BTransfer|company|CTC"` on that file returns the three `isB2BTransfer` lines and
nothing else.** There is no `company` guard, no `CTC` string and no `origin` filter on the else
branch. MEASURED. `git log` on the file: last touched **2025-12-12**, PR \#1080, so this is the
pre-CTC version.

A CTC ECOM order is not a B2B transfer. On this version of the file it takes the else branch.

### Why that matters, and it is a document problem before it is a defect

**LLD §11.3 asks for two things that cannot both hold on this version of the file.** It requires that
a CTC ECOM order produce native records "and **reallocation is not triggered**", and in the same
paragraph that QA "**Assert that `create-shipment-items` is unmodified**, a CTC order and a UNI order
of the same size produce structurally identical item records."

The reallocation emit lives inside `create-shipment-items`. If the file is unmodified, a CTC ECOM
order emits `REALLOCATION`. If the CTC build added a guard so that it does not, the file is modified
and the second assertion is the one that fails. §9.2's "the reallocation path is never entered for CTC
orders" and §3's `Skip` stance both depend on which happened.

INFERRED, and the inference is about the document, not the build: one of §11.3's two clauses is wrong
as written. Which one is a question for Kian, and it is cheap to settle, see below.

### What this does to TC2

The row's reallocation half was PASS-with-an-INFERRED-caveat, resting on absence in poller and sender
logs pulled for another purpose. That inference is now **unsafe in the other direction**: the
mechanism exists, sits on the hop CTC ECOM rides, and carries no company guard on the version of the
file this checkout holds.

**Proposed:** split the row. TC2 keeps the stamps half at PASS, MEASURED. A new **TC2b** carries the
no-reallocation half at **INCONCLUSIVE**, with a named decisive test replacing the log hunt.

### The decisive test, and it is cheap

Per LLD §3 the transaction chain "persists the audit record in the order's partition" at
`SK = TRANSACTION#<epoch-ms>`. A `REALLOCATION` event therefore leaves an audit record carrying
`idempotencyId` prefixed `REALLOCATION#` **in the same partition TC2 already read**.

So TC2b closes with a DynamoDB read, no log group, no event-bus rule walk, no lambda name sweep:

1. For each of the nine R13 references (`#262208`, `#262210`, `#262211`, `#262216`, `#262217`,
   `#262219`, `#262221`, `#262222`, `#262223`), query the order partition for `TRANSACTION#` records
   and report any whose `idempotencyId` begins `REALLOCATION#`. Field allowlist only.
2. Present on any of them: **reallocation IS triggered for CTC ECOM orders.** That is a FAIL against
   AC7 and against LLD §9.2, not a partial pass, and it is a real defect rather than a doc correction.
3. Absent on all nine: the CTC build guarded it, so §11.3's "assert `create-shipment-items` is
   unmodified" is the clause that is wrong. Confirm with `inspect-lambda-code.sh` against
   `staging-shipping-v2-create-shipment-items` (or whatever the deployed name is) searching for
   `company` and `CTC`, which also tells Kian's question apart from a guess.

Step 1 alone is decisive for the verdict. Step 3 is what makes the correction raisable.

**Both steps need AWS, so both are JJ's IDE session.** Nothing further is runnable from Cowork.

### Tagging summary

| Claim | Tag |
|---|---|
| Three reallocation consumers are wired; the slice's "nothing subscribed" outcome is unreachable | MEASURED, Feb 2026 checkout |
| The chain is shipment item creation to `create-shipment-items` to `TRANS_REALLOCATION` to `allocate-shipment-items` | MEASURED, Feb 2026 checkout |
| `create-shipment-items` carries no `company`, `CTC` or `origin` guard on the reallocation branch | MEASURED, Dec 2025 version of the file |
| A CTC ECOM order takes the else branch on that version | MEASURED from the branch condition |
| One of LLD §11.3's two clauses is wrong as written | INFERRED |
| What the deployed build does | **UNKNOWN.** The checkout has no remote and predates PR \#1568 |

## S1, S3, S4, S5

Not run. S1 is reduced to one step and S3 gained one, per the 2026-09-09 re-verification. All four
need AWS or a manual SCALE read.
