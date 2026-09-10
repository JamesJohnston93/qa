# QA Re-plan — BUSY-1114 / 1115 / 1116 are bundled on staging

**Confirmed 2026-08-05 (JJ + empirical).** Staging is **not** running the isolated 1114 tracer bullet the three QA docs assume. All three tasks are deployed **together**: full field mapping and the `/ProductOptions` trigger-fan-in (1115) and the watermark-resilience paths (1116) are live alongside the 1114 core path.

**Evidence:** a `preview-cin7-sync.sh` dry run over a ~70-min watermark window returned **755 would-emit records — 64 `[primary]`** (the target 8-product / 8-option batch, exactly) **+ 691 `[trigger]`** pulled in from **100 distinct products** whose options ticked recently (stock/price) but were otherwise untouched for weeks.

**Decision (JJ):** we will **not** test any ticket in isolation — the end state we care about is the whole item integration running together, which is exactly what ships to prod, so there's no real-world loss in validating the combined deploy. Run one combined pass; keep **AC traceability** so 1114/1115/1116 can each still be signed off in Jira.

Per-ticket QA docs (system of record, JJ owns): [1114](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1859387394) · [1115](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1859354640) · [1116](https://universalstore.atlassian.net/wiki/spaces/QD/pages/1859354632). This doc is the overlay that adjusts them for the bundle — it does not replace them.

---

## 1. What the bundle changes (assumptions now stale)

1. **Scope carve-outs don't hold.** Each doc's "explicitly out of scope here — owned by another ticket" is moot on staging: a single watermark rewind exercises the 1114 core path, 1115 full mapping + trigger-fan-in, and 1116 resilience **all at once**. Test them as one combined pass, not three sequential ones.
2. **"Mandatory fields only / missing fields expected" (1114) is stale.** Full mapping is live, so records arrive **complete**. A record missing size/colour/weight is no longer automatically fine — judge it against the LLD §5 full field table (1115 TC1/TC2), not the tracer-bullet carve-out.
3. **Cin7 API budget is now the top operational risk.** Trigger-fan-in makes every rewind far heavier than a tracer-bullet assumption — 70 minutes pulled 755 records via 100 extra product reads. The shared **5,000/day cap** (one prod token, all stages) can be eaten quickly. **Preview before *every* rewind, not just deliberate wide ones**, and measure baseline usage first.
4. **The `/ProductOptions` trigger path is live and firing.** The 691 `[trigger]` records came from products whose *options* changed while the *product* `modifiedDate` didn't — empirical signal that **OQ-2 resolves "option edits do NOT bump product `modifiedDate`"**, so the trigger source stays. That makes 1115 **TC3/TC4 in-scope and testable** (not N/A). Confirm OQ-2 formally, but plan for the trigger being real.
5. **The "craft test products in Cin7 staging" blocker (1115) is invalid** — same correction as 1114: there is no Cin7 staging and prod is read-only. Products of a needed shape (fully-populated / missing weight / missing dims / no barcode / blank `productOptionCode` / blank `categoryId`) must be **found in real prod** (`find-cin7-item.sh`, `find-cin7-product-by-id.sh`) or **bus-injected** synthetic (`desc` not `description`, `additional_eans: []`), not created in Cin7.
6. **One watermark, one lever.** All three tasks' watermark-driven tests share the single SSM parameter — they **cannot run concurrently**. Serialize, and snapshot/restore the watermark around the whole pass.
7. **Forced-failure blast radius is wider.** Invalidating the Cin7 secret or forcing an endpoint failure now takes down the **combined** CTC pipeline on staging — and all three tasks' testing at once. Coordinate with co-testers on staging before any destructive test.

## 2. Guardrails for the combined pass

- **Budget:** capture baseline Cin7 usage; `preview-cin7-sync.sh` before every `--set`; keep windows as narrow as the test allows; `--unset` between tests, not just at the end.
- **Sequence the budget-heavy / destructive tests deliberately** (see §3) — the 1116 full-catalog reset is the single biggest budget event and should come last and bounded.
- **Serialize** all watermark-driven cases; only one in flight at a time.
- **Snapshot the watermark** before the pass; restore (or `--unset`) after.
- **Coordinate on staging** — heads-up co-testers before any forced-failure/reset; the whole combined pipeline is affected.
- **Reconcile resource names first** (QA-doc/LLD vs scripts — see the 1114 plan §3); confirm deployed poller name + cadence.
- **Keep AC traceability** — tag each observation with the ticket + AC it satisfies so 1114/1115/1116 can be signed off individually from one combined run.

## 3. Proposed combined sequence

Run as one pass, cheap→expensive, non-destructive→destructive, watermark restored throughout.

**Phase 0 — Setup (shared).** Reconcile names + confirm cadence/poller; `check-status.sh` clean (0/0); snapshot watermark; baseline Cin7 usage; scout real reference products for every shape 1115 needs (`find-cin7-item.sh` / `find-cin7-product-by-id.sh`) so later phases don't each pay a fresh discovery cost.

**Phase 1 — Core delivery + mapping (1114 AC1 + 1115 AC1/AC2/AC4/AC6).** One narrow, previewed rewind onto a known real product → confirm it lands as `Company=CTC`, one item per option, **and** verify the full §5 field mapping, item-class `CTC-000` fallback, empty `<XRefs/>` acceptance, trigger-fan-in building the record from the **full product read** (not the options response), and the eligibility skip. One rewind covers many TCs because the bundle exercises them together.

**Phase 2 — Defaults & metrics (1115 AC3/AC5).** Find real products missing weight / dimensions → default-and-report; **check the actual CloudWatch metric dimension** (carried-over BUSY-1113 gap: sender metrics may have no `Company` dimension — the doc's `Company=CTC` may hold only at log level). 429 handling (TC10/TC11) — **mock at the `libs/cin7` boundary**, do not try to breach Cin7's real limit on the shared budget.

**Phase 3 — Watermark advance + resilience (1114 AC2/AC3 + 1116 AC1/AC2).** Watermark advances to max `modifiedDate` on a clean cycle; then forced failures per stage (`/Products`, `/ProductOptions`, mid-emit) leave it **byte-for-byte unchanged**; re-covered/overlap duplicates converge to a single SCALE upsert. **Destructive — do last of the live tests, coordinate, restore.** Confirm what mid-emit fault hook exists (1116 TC3) before scheduling it; some of this is only integration-testable.

**Phase 4 — Re-sync runbook (1116 AC3/AC4).** The full-catalog reset (set watermark to an old date) is the **biggest budget event** and, with trigger-fan-in live, may **not** fit "one cycle within rate limits" as the 1116 doc assumes — it can approach the daily cap. **Start bounded** (a modest look-back), measure request count + duration, then extrapolate for the runbook rather than firing a true full reset blind. Verify idempotency (before/after SCALE item state). Author + link the runbook.

**Phase 5 — Teardown.** Restore/`--unset` the watermark; `check-status.sh` back to 0/0; purge any send-DLQ left by forced-failure tests; record measured budget/duration.

## 4. Open items to confirm

- Deployed poller name + EventBridge cadence (ticket 15-min vs LLD 2-min vs README 3-min).
- Resource-name reconciliation (QA-doc/LLD vs scripts).
- OQ-2 formal resolution (evidence says trigger stays).
- Mid-emit fault hook for 1116 TC3.
- The BUSY-1113 `Company`-dimension metric gap — does the defaulted-weight metric inherit it?

_Resolved: the tickets will **not** be split back out for isolated testing — the combined deploy is the intended validation target (matches prod)._
