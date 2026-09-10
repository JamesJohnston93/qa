# The re-sync runbook — what to do with it (1116 AC4 close-out)

**Page:** [CTC Item Poller Backfill / Re-sync Runbook](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1845100600/CTC+Item+Poller+Backfill+Re-sync+Runbook) · id `1845100600` · author Kian · published **2026-08-03**, unchanged since
**Reviewed against QA's measured record:** 2026-08-19 · **Verdict: content PASSES. Only the link is missing.**

---

## 1. Content review — AC4 asks for four things, and all four are there

| AC4 requires | In the runbook? |
|---|---|
| Reset procedure | ✅ *Procedure* §1–6, with both Console and CLI paths |
| Expected duration | ✅ 7-day worked example: 3 cycles, ~6 minutes total, per-cycle durations as % of the 300s timeout |
| Request budget | ✅ *Request budget* — 5,000/day shared cap, cost per page/chunk, 90 requests for the 7-day reset |
| When to use it | ✅ Intro (initial load / replay / drift are one operation) + *If the poller is timing out* |

**It also corroborates QA independently**, which is worth saying out loud in the sign-off:

- **"No overlap window. The poller queries from the watermark's exact value"** — *Deployed configuration*.
  **Kian's runbook and the LLD directly contradict each other, and the runbook is the one that's right.**
- **Schedule: 3 minutes** — confirms the cadence against the ticket's 15 and the LLD's 2.
- **Emission is batched ≤10 per call** — confirms LLD correction 4.9 from the dev side.
- **7-day reset = 90 requests / 17,886 records** — matches the figure in our cost model exactly.

So AC4 is **not** a content gap. It is one hyperlink.

---

## 2. What I want you to do — in order

### 2.1 Get the LLD link in (this is the AC4 close)

Three edits to **LLD page 1765736449**. Paste-ready text below. **Fastest path: put this text straight
into the chase message so Lachlan or Kian only has to click Edit → paste → Publish.** If you hold edit
rights on the BUSY space and would rather not wait, it's a three-minute job — but tell them you did it,
because §13 is their delivery table.

**Add to §3.4 (Watermark), as a new bullet at the end:**

> * **Re-sync / backfill procedure:** [CTC Item Poller Backfill / Re-sync Runbook](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1845100600/CTC+Item+Poller+Backfill+Re-sync+Runbook) — reset procedure, request budget, expected duration, page-cap handling and when to use it.
> * ⚠ **Correction (QA-measured, 2026-08-18):** the poller queries from the watermark's **exact value**, inclusive `>=`, with **no `− 5 minutes` overlap** — measured across 14 cycles, Δ = 0s every time, zero bare `>` in full retained history. The runbook's *Deployed configuration* section states the same. The `watermark − 5 min` text above is wrong and the QA/UAT list in §14 inherits the error.

**Add to §8 (Error handling), as a new bullet:**

> * **Recovery from drift.** Where SCALE and Cin7 diverge, the sanctioned recovery is a watermark reset per the [Backfill / Re-sync Runbook](https://universalstore.atlassian.net/wiki/spaces/BUSY/pages/1845100600/CTC+Item+Poller+Backfill+Re-sync+Runbook). ⚠ **Convergence holds for values that are present in Cin7, not for deletions** — Manhattan's `SAVE` is additive, so a field cleared in Cin7 does **not** clear in SCALE and no re-sync will fix it (QA-measured 2026-08-18).

**Replace the BUSY-1116 row in §13:**

> | [BUSY-1116](https://universalstore.atlassian.net/browse/BUSY-1116) | Watermark resilience: exit-early failure semantics proven under forced failures; re-sync runbook **published 2026-08-03 and linked from §3.4 / §8** (§3.4, §8) | [BUSY-1114](https://universalstore.atlassian.net/browse/BUSY-1114) |

### 2.2 Then close it out on your side

- [ ] **1116 TC8** ("published **AND** linked") → **PASS** once §3.4/§8 carry the link. **TC9** (content) →
      **PASS** on the review above; note the amendments in §3 as recommendations, not blockers.
- [ ] **1116 AC4** → PASS. That takes the ticket out of Review, since AC1–AC3 already pass.
- [ ] Add the runbook to the **Relevant Documentation** list on QA DOC - BUSY-1116 (page 1859354632) if it
      isn't there — it's the evidence for TC8/TC9.

### 2.3 Offer the amendments as additions to the repo copy, not a competing page

The page footer says *"Source of truth: the repo copy of this runbook — this page mirrors it."* So
**don't edit the Confluence page directly and don't publish our draft as a rival page** (that's runsheet
item 6.3). Send Kian the list in §3 for the repo copy; the mirror follows.

---

## 3. Runbook amendments — QA's review output

**Four worth making. All post-date 3 August, so none of them is an error on Kian's part.**

- [ ] **R1 — ⚠ `SAVE` does not clear a cleared field. This is the important one.**
      *Safety properties* currently says only *"Manhattan's SAVE upsert is idempotent, so a re-sent record
      is a harmless re-save."* True, but incomplete: **measured 2026-08-18**, `QA-UP2-TEST` was sent
      `colour=Green`, then re-sent with `colour=""`; the XML carried an explicit `<Color></Color>` and
      **SCALE still reads `Green`.** So a re-sync converges **present values only** — anything deleted in
      Cin7 persists in SCALE indefinitely with no signal and no recovery path. **An operator running this
      runbook to "fix drift" will believe it fixed more than it did.** Add it as a caveat under *Safety
      properties*.
      ⚠ **Our earlier docs said the runbook already carried this caveat. It does not** — that claim was
      wrong and this file corrects it.
- [ ] **R2 — the empty-cycle cost is 3 requests, not 2.** *Request budget* says an empty cycle costs 2
      requests (~960/day). Measured floor is **3** — 1 `/Products` page + 1 `/ProductOptions` page + **≥1
      triggered-product chunk**, which fires even on light cycles. Real baseline is **~1,440/day**, ~50%
      higher than the page states. Against a 5,000/day cap shared with the PO and SO pollers, that
      understatement matters.
- [ ] **R3 — the `UNSET` idle trap belongs in the runbook.** *Activation* explains the `UNSET` sentinel and
      `Cin7ItemPollerInactive`, but not the consequence: `cin7-watermark-stale` watches
      `Cin7PollerCycleComplete` **only**, which an inactive cycle never emits — so **a deliberately idle
      poller false-positives the staleness alarm.** Anyone following this runbook and then leaving the
      watermark `UNSET` will get a red alarm that means nothing. **An operator must check whether the
      watermark is simply unset before treating a stale alarm as a real failure.** (1117 AL6.)
- [ ] **R4 — SSM lag is variable in both directions; never re-write impatiently.** Step 3 says the poller
      picks the value up "on its next scheduled cycle — every 3 minutes." Measured extremes: on **2026-08-14**
      a `--set` landed on the very next cycle (~1m39s); on **2026-08-13** an unset reported success and the
      poller ran **11 more active cycles over ~33 minutes**, ~1,108 records beyond the intended window.
      **Always confirm with a direct `get-parameter`; a second impatient write doubles the reset's cost.**

**Two optional:**

- [ ] **R5 — step 6 can now name the SCALE screen.** It currently says *"no direct lookup tool exists yet;
      use SCALE's own UI/search."* You've since found the item lookup screen — drop the path in, and note
      that `DIF Incoming Message Insight` is the **wrong** screen (0 rows with all filters cleared). Same
      capture as runsheet item 4.15.
- [ ] **R6 — "don't reset for one SKU."** A reset re-covers *everything* modified since the floor — it's a
      floor, not a window. Worth one line, since the cheap-cost finding makes resets tempting.

---

## 4. Two side-effects worth knowing

**4.1 — K1 is effectively answered; downgrade the question.** The runbook states the page cap plainly:
**`MAX_PAGES_PER_RUN`, default 30, 250 rows/page, 7,500 rows per endpoint per cycle**, and it documents
the env-var override as an *incident-response lever that a deploy silently resets*. That reconciles with
our three independent reads showing **no `MAX_PAGES_PER_RUN` env var set** — the 30 is the code default,
and no override is in force. So:

- **Contradiction C2 → RESOLVED** (documentation, dev-attested via the runbook — not QA-measured).
- **PW10 → closable as designed**, with the cap's value known and the reason it has never fired
  (max 8 pages observed in ~41 days, against a cap of 30).
- **K1 to Kian shrinks to a one-line confirmation:** *"runbook says default 30 and no env override is
  set — confirming that's still the code default."*
- Bonus: the runbook names the log line for a capped cycle — **`Cin7ItemPollerPageCapHit`** — so the
  never-fired claim is greppable if anyone challenges it.

**4.2 — two more LLD corrections, and the runbook is the evidence.** The LLD's resource names are wrong
where the runbook's are right:

- **Cin7 secret** is `{stage}/catalog/cin7` — LLD §4.2/§7 say `{stage}/cin7`, which **does not exist**.
- **Watermark parameter** is `/catalog/cin7-manhattan/item-watermark/{stage}` — LLD §3.4/§4.2 say
  `/{stage}/cin7-manhattan/watermark`, which **does not exist**.

Both are confirmed against live staging and against Kian's own runbook. Add them to the LLD corrections
hand-over as items 4.16 and 4.17 — anyone automating from the LLD's names today would fail on a
`ParameterNotFound` / `ResourceNotFoundException`.
