> **CLOSED 2026-09-09. Do not re-run.** **Q30 closes NEGATIVE.** The deployed poller's
> `ELIGIBLE_STAGES` already includes both picked stages, so a picked order routes to update, never
> to cancel. It also found Q31's CONFIRMED result is stale, measured against a 2026-09-02 build.
> Result: `results/07-poller-cancel-emit-source-read.md`.

# Slice 07, does the poller emit a cancel for a disappeared order

**Question:** Q30, the last thing gating sign-off on this ticket
**Cases:** none directly. It settles a risk that sits under TC15 and TC16
**Depends on:** nothing. `inspect-lambda-code.sh` already exists in `../../tools/`
**Estimated:** short. One download, a handful of greps

Read only. No emit, no watermark write, no Cin7 call, no schedule change.

## Why this slice exists, and why Q30 is not a question for Kian yet

Slice 05 ran Q30's picked-stage arm and got a clean negative **at the layer it could reach**: the
reconciliation handler has no stage logic at all, `sourceStage` is inert metadata, and no DELETE
followed. It then said plainly that this does not settle the risk Q30 names, because the decision is
made upstream in the poller and downstream injection cannot see it. Q30's own register entry names
the two routes that would settle it, and the first is **a source read of the poller**.

**That route was unavailable when slice 05 wrote it, and is available now.** Slice 06 needed the same
thing for TC1b, found that `aws lambda get-function` returns a pre-signed URL to the exact artifact
running in staging, and promoted the technique to `../../tools/inspect-lambda-code.sh`. It already read
this very function's bundle to prove `ShipTo` appears in it zero times.

So Q30 sits at `TRIED 2` with a named, open, cheap route that QA can run. **It does not go to Kian
until this slice has run.** Asking him to check something we can check ourselves in twenty minutes
spends goodwill the real findings on this ticket will need.

## The risk, stated so a pass or a fail is unambiguous

Three measured facts stack into one unmeasured question:

* **Q31, CONFIRMED.** The deployed poller drops `Fully Picked` orders out of its eligible query
  result set, the opposite of dev's stated intent.
* **Slice 05 TC15, MEASURED.** A `CANCEL_ORDER` executes unconditionally: it flips the order and
  sends a header DELETE to SCALE, with no stage check anywhere on the handler side.
* **Slice 05's Q30 arm, MEASURED.** The reconciliation layer has no independent safety net. It
  executes whatever the poller sends.

**The unmeasured link:** when an order the poller was previously tracking stops appearing in its
query results, does it emit `CANCEL_ORDER`? If it does, an order picked in the warehouse would have
its live SCALE job deleted, and nothing downstream would stop it.

## What to read

Use `../../tools/inspect-lambda-code.sh` against `staging-orders-cin7-so-poller`. It downloads the bundle,
greps it, and deletes it afterward. Read the script's header first.

Search for the emit path and the condition that reaches it. Terms worth starting from, and widen from
whatever the first hits show, since the bundle is minified-ish and names may be mangled:

* `CANCEL_ORDER`, to find every site that constructs one
* the watermark and query logic, to find what the poller does with the set of orders it previously
  tracked versus the set the current query returned
* any term suggesting disappearance or reconciliation of the two sets: `missing`, `disappeared`,
  `noLonger`, `wasTracked`, `previously`, `eligib`
* `skippedStages` and `skippedLocallyTerminal`, which are the counters that fire when an order is
  excluded, to see whether exclusion and cancellation share a code path or are separate

## Reads as

* **The poller only emits `CANCEL_ORDER` from an explicit signal**, for example a void flag or an
  explicit cancelled status, and never from an order merely being absent from a query result.
  **Q30 closes negative.** The risk does not exist in the deployed build. Record it, close Q30, and
  this ticket loses its last sign-off blocker.
* **The poller emits `CANCEL_ORDER` on disappearance from the result set.** **Q30 closes positive and
  is a defect finding of real consequence**, because Q31 already proved picked orders disappear from
  that set. Stop, write it up with the code excerpt, and take it to JJ before anything else. This
  would be the most serious finding on the ticket.
* **The bundle is unreadable, or the logic cannot be attributed with confidence.** Say which check
  defeated you and what you saw. Q30 then reaches `EXHAUSTED after 3` with all three routes named,
  and **only then** does it go to Kian, with the two attempts and this one attached.

Do not guess from a plausible-looking function name. A wrong answer here is worse than no answer,
because it would either dismiss a real defect or send dev chasing one that is not there.

## What this slice cannot do

It reads the artifact deployed to staging. It does not prove the same artifact is what will ship, and
it is not a substitute for dev confirming intent. If the read comes back positive, the finding is
"the deployed staging build does this", which is enough to raise and not enough to assert about
production.

## Stop and ask JJ if

* the read comes back positive, before writing any verdict
* the bundle for this function cannot be retrieved or read
* the logic looks like it depends on something outside this function, in which case name the
  function and stop rather than chaining reads

## Write results to

`results/07-poller-cancel-emit-source-read.md`, then update `STATE.md`, Q30 in
`../BUSY-1065-OPEN-QUESTIONS.md` with the outcome and its verification state, and the Sign-off and
Blockers sections of `QA-DOC.md`, since Q30 is named in both.

Tag every claim MEASURED, INFERRED or UNKNOWN. Quote the minimum code needed to support the finding,
never a full function dump, and delete the downloaded package afterward.
