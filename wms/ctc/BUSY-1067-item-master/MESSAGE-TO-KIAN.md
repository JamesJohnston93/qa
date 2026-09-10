# To Kian — one message, four parts

**Suggested handling:** send **Part 1 on its own first** (it's the only thing blocking BUSY-1116), then
Parts 2–4 as a follow-up. Splitting them stops the blocker getting buried in a wall of corrections.

---

## PART 1 — the LLD link (this is all that's holding 1116 in Review)

> Hi Kian — BUSY-1116 is fully tested and AC1–AC3 pass. **AC4 is the only thing left, and it's not a code
> or content problem — it's a missing hyperlink.**
>
> AC4 reads *"Runbook page published **and linked from the LLD**"*. Your runbook
> ([CTC Item Poller Backfill / Re-sync Runbook](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1845100600/CTC+Item+Poller+Backfill+Re-sync+Runbook))
> was published 3 August and I've reviewed the content — it covers all four things the AC asks for
> (procedure, duration, request budget, when to use it), so that half is a pass from QA.
>
> But the **LLD** ([CTC Item Master Sync LLD](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1765736449))
> never references it. §3.4 and §8 don't link it, and §13's task table still describes 1116's scope as
> "runbook published and linked from this LLD", so the doc reads as though it hasn't happened. Three small
> edits and AC4 closes. Paste-ready:
>
> **Add to §3.4 (Watermark), new bullet at the end:**
>
> * **Re-sync / backfill procedure:** [CTC Item Poller Backfill / Re-sync Runbook](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1845100600/CTC+Item+Poller+Backfill+Re-sync+Runbook) — reset procedure, request budget, expected duration, page-cap handling, and when to use it.
>
> **Add to §8 (Error handling), new bullet:**
>
> * **Recovery from drift.** Where SCALE and Cin7 diverge, the sanctioned recovery is a watermark reset per the [Backfill / Re-sync Runbook](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1845100600/CTC+Item+Poller+Backfill+Re-sync+Runbook). Note that convergence holds for values that are **present** in Cin7, not for deletions — `SAVE` is additive, so a field cleared in Cin7 does not clear in SCALE (QA-measured 2026-08-18).
>
> **Replace the BUSY-1116 row in §13 with:**
>
> | BUSY-1116 | Watermark resilience: exit-early failure semantics proven under forced failures; re-sync runbook **published 2026-08-03 and linked from §3.4 / §8** (§3.4, §8) | BUSY-1114 |
>
> Happy to make the edits myself if that's easier — just say. I didn't want to touch §13 without asking,
> since it's your delivery table.

---

## PART 2 — LLD corrections (documentation only, no code changes)

> Eight things in the LLD that don't match what's deployed. **None of these is a defect in the build** —
> in every case the code is fine and the document is stale or wrong. Worth fixing because people
> implement and write unit tests from it.
>
> **1. §3.4 — the `watermark − 5 minutes` overlap does not exist.** The deployed query is
> `where=modifiedDate>='<watermark>'` — the watermark's exact value, inclusive `>=`, no buffer subtracted.
> Measured from the literal `where=` clause across 14 cycles, difference = 0s every time, and zero
> occurrences of a bare `>` in the entire retained log history. **Your runbook's "Deployed configuration"
> section already says this correctly** — it's the LLD that's out of step.
> ⚠ **§14 inherits the error:** it lists *"filter includes 5-minute overlap"* as a unit test, so anything
> written to that line is asserting behaviour the poller doesn't have.
>
> **2. §3.3 step 5 — emission is not one `PutEvents` per record.** It's **batched, up to 10 records per
> call** — 2,678 of 2,821 observed batches were exactly 10. Your runbook says this correctly too.
>
> **3. §5 has no field-length column, and the four limits don't behave the same way:**
> `Desc` **100** — truncates silently · `Colour` **25** — truncates silently · `Size` **25** — **errors** ·
> `item_code` **50** — **errors**. All four QA-measured. **Two truncate, two error — the doc shouldn't
> state one behaviour for all of them.**
>
> **4. Cadence is 3 minutes.** §3.2 says 2, the BUSY-1117 ticket says 15. This one has a knock-on: §9's
> alarm rationale ("2 hours ≈ 60 consecutive cycles") and the ticket's ("2 hours ≈ 8 cycles") are both
> derived from the wrong number — at 3 minutes, 8 cycles is 24 minutes and "3 consecutive errors" is 9
> minutes, not 45. **The thresholds are fine as configured; it's the stated reasoning that's wrong.**
>
> **5. §5's source fields follow HLD §5.3, not the LLD's own table** — notably `UserDef1 ← brand`, which
> the LLD omits entirely.
>
> **6. §5 says `DimensionUm` = `M`. It should say `MM`.** `MM` is what the mapper emits and it's correct —
> settled with you and the design council on 7 August. **`M` is a guaranteed Manhattan rejection** (we used
> `dimension_uom=M` deliberately as a poison record in Phase 3), so anyone building to the table as written
> would ship rejected items.
>
> **7. The Cin7 secret is `{stage}/catalog/cin7`.** §4.2/§7 say `{stage}/cin7`, which **does not exist**.
> Your runbook has the right one.
>
> **8. The watermark parameter is `/catalog/cin7-manhattan/item-watermark/{stage}`.** §3.4/§4.2 say
> `/{stage}/cin7-manhattan/watermark`, which **does not exist**. Again, the runbook is right.
>
> On 7 and 8 — anyone scripting against the LLD's names today gets `ResourceNotFoundException` /
> `ParameterNotFound`. Those two are the most likely to actually bite someone.

---

## PART 3 — runbook amendments for the repo copy

> Four suggestions for the runbook. **All of them are things we measured *after* you published on 3 August,
> so none is an error on your part.** The page says the repo copy is source of truth, so I haven't touched
> the Confluence mirror.
>
> **1. ⚠ `SAVE` does not clear a field that's been cleared in Cin7 — this is the one I'd most want added.**
> "Safety properties" currently says `SAVE` is idempotent, which is true but incomplete. Measured 18 August:
> we sent a test item `colour=Green`, then re-sent it with `colour=""`. The XML carried an explicit
> `<Color></Color>` and **SCALE still reads `Green`.** So a re-sync converges **present values only** —
> anything deleted in Cin7 persists in SCALE indefinitely, with no signal and no recovery path. Someone
> running this runbook to "fix drift" will reasonably believe it fixed more than it did.
>
> **2. The empty-cycle cost is 3 requests, not 2.** "Request budget" says 2 (~960/day). The measured floor
> is 3 — one `/Products` page, one `/ProductOptions` page, and **at least one triggered-product chunk**,
> which fires even on light cycles. Real baseline is **~1,440/day**. Against a 5,000/day cap shared with the
> PO and SO pollers, the understatement is worth correcting.
>
> **3. The `UNSET` idle trap is worth a warning.** "Activation" explains the `UNSET` sentinel and
> `Cin7ItemPollerInactive`, but not the consequence: `cin7-watermark-stale` watches
> `Cin7PollerCycleComplete` **only**, and an inactive cycle never emits it — so **a deliberately idle poller
> false-positives the staleness alarm.** It caught us repeatedly during testing. Suggested line: *before
> treating a stale-watermark alarm as a real failure, check whether the watermark is simply `UNSET`.*
>
> **4. SSM pickup lag varies in both directions — don't re-write impatiently.** Step 3 says the poller picks
> the value up on its next cycle. On 14 August a set landed on the very next cycle (~1m39s). On 13 August an
> unset reported success and the poller ran **11 more active cycles over ~33 minutes** (~1,108 records past
> the intended stop), confirmed by direct SSM reads. Worth saying: **confirm with a direct `get-parameter`,
> and never write a second time out of impatience** — that's how a reset's cost doubles.
>
> Two smaller ones if you're in there anyway: step 6 says *"no direct lookup tool exists yet"* — I've since
> found the SCALE item lookup screen and can give you the navigation path; and a line saying **don't reset
> for a single SKU** (the watermark is a floor, not a window, so a reset re-covers everything since) would
> be useful now that we know resets are cheap.

---

## PART 4 — five questions

> Last thing — five questions I can't answer from outside the code. **Only the fourth affects a verdict**;
> the rest are for the handover record.
>
> **1. `MAX_PAGES_PER_RUN` — your runbook says the default is 30, and I've confirmed no environment-variable
> override is set on the deployed poller. Just confirming 30 is still the code default.**
>
> **2. Does the poller check `PutEvents`' `FailedEntryCount`?** The `Pushed {"Entries":[…]}` line logs the
> outbound request *before* the call, and `FailedEntryCount` appears zero times in the full retained history
> — so from outside, a complete success and a partial failure look identical. Reconciliation is clean
> (31,731 emitted = 31,731 received, hour by hour, whole lifetime), so this is defence-in-depth, not a
> defect. Worth logging it even when it's zero?
>
> **3. Is the missing `weight` type guard known and accepted?** A non-numeric weight isn't caught by
> `validateItemDownload` at all — it dies deeper as `TypeError: value.toFixed is not a function` in
> `roundToSchemaPrecision`, so **no validation reason gets logged**. The other four triggers each have a
> named check in front of them. It's a diagnosability thing, not a risk — the buffer's bisection contains it
> either way.
>
> **4. Is the sender's coalesce out-of-order-safe — does a newer `read_at` win regardless of arrival order?**
> This is the only thing keeping a sub-claim under 1116 AC2 at PARTIAL. We proved no duplicates after a
> retry, and that two sequential updates land in the order sent, but nothing ever inverted arrival order.
>
> **5. (optional) Does the poller collapse each run of whitespace in `item_code` to a single underscore when
> building `message_group_id`** — i.e. `{company}#re.sub(r"\s+","_",code)`? It only upgrades our evidence
> grade; the conclusion doesn't change either way.
