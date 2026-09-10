# Cin7 write access — coverage plan

> ## 🚫 NOT ACTIONABLE. Writes are PROHIBITED and the tooling must NOT be built until JJ explicitly asks.
>
> JJ's instruction, 2026-08-18: the absence of write tooling is currently **a feature, not a gap**.
> Do not build `cin7-testset.sh`, do not scaffold it, do not add a write flag to an existing script,
> and do not offer to. **Every Cin7 script stays GET-only.**
>
> **Mandatory disclosure when writes are eventually approved:** before *each* edit, state the product
> id and slot · the field with its current and new value · the exact verb, URL and full payload · the
> blast radius · how it reverts and whether cleanly. Then wait. **One edit, one disclosure, one
> approval — no batching, no "while I was there".**
>
> ### ⚠ Two things have changed since this plan was written (2026-08-13)
>
> 1. **1115 is closed** and **Plan A closed the whitespace question as a harness artefact**, so the
>    two biggest reasons this plan existed are gone. W17 is no longer needed.
> 2. **The four allowlisted products are all structurally ineligible** — see §2. **The §4 end-to-end
>    pass cannot work as written.**

---

## 1. Containment rules — hard, no exceptions

1. **Never POST-to-create, never DELETE.**
2. **Every write addresses a product by `id` from the four-id allowlist in §2.** Any other id: refuse,
   exit non-zero. No override flag, no env var — un-bypassable by accident.
3. **Snapshot before the first write** (W1) into `fixtures/`. Only route back.
4. **Read-modify-write, always.** A partial payload may clear fields you didn't intend — which is also
   the mechanism behind the runbook's *"`SAVE` doesn't clear cleared fields"* caveat (and note that
   caveat is now **QA-confirmed** — see W3).
5. **Writes count against the shared 5,000/day cap**; read-modify-write costs 2 calls per edit.
6. **Option-code edits on the burner only.** A code change mints a **new** SCALE item and strands the
   old one — no de-provisioning path has been tested. Register every code minted.
7. **Watermark discipline unchanged** — snapshot, keep the floor tight, `--unset --confirm` at every stop.

---

## 2. The allowlist — recorded 2026-08-18

| Product id | Code | Name | Options | Product status | Suggested slot |
|---|---|---|---|---|---|
| **6202** | `TEST1` | `test Product` | **1** | Public | **P3 burner** — the only product whose option codes may change (1 option = 1 orphan per code edit) |
| **6203** | `TEST2` | `testProduct` | 4 | Public | **P1 golden** — fully-populated fixture; codes never change |
| **6204** | `TEST3` | `testProduct` | 4 | Public | **P2 boundary** — field-value probes; codes never change |
| **6205** | `TEST4` | `testProduct` | 4 | Public | **P4 reserve** — pristine negative control; never edited |

Ids confirmed by JJ. **Slot assignment is a proposal pending his confirmation.**

### ⚠⚠ All four are structurally ineligible. The poller will NEVER emit them as they stand.

Every option on all four is **`optionStatus=Disabled`**, and eligibility requires
`Product.status=Public` **AND** `ProductOption.status=Primary`. These are the exact products Phase 1
used as the eligibility-gate negative examples — PW5 (`optionStatus=Disabled`, 6202–6205) and PW7
(each contributed **zero** emitted records, 100% of options skipped).

**Consequences:**

- **§4's end-to-end pass cannot work as written.** No content edit will make a record flow.
- **Any test needing a record to reach SCALE must first flip an option `Disabled → Primary`** — itself
  a write, which changes the product's meaning as a fixture and must be reverted afterwards. **Plan it
  deliberately as the first step (it is W19), don't discover it mid-pass.**
- **Sequence therefore becomes:** snapshot → flip one option to `Primary` → confirm it emits → run the
  content tests → flip back → confirm reverted.

✅ **Risk revised DOWN.** These are purpose-made test products (`TEST1`–`TEST4`, `testProduct`), not
real merchandise. The earlier warning about breaking live stock/order links inside Cin7 is **much less
severe than originally stated**. The genuine remaining cost of an option-**code** edit is a permanently
orphaned SCALE staging item.

---

## 3. Step 0 — snapshot and probe reversibility before trusting anything

**Stop and reassess if W2 or W3 comes back badly** — a clobbering update or an un-clearable field
narrows everything, and it's better learned on the boundary product with a baseline in hand.

| ID | Test | Why | Verdict shape |
|---|---|---|---|
| **W1** | Full-object GET of all four → `fixtures/cin7-testset-baseline-<ts>.json`, committed | The only restore path and the reference for every diff | Four files, byte-stable on a second GET |
| **W2** | **Confirm the write verb and payload shape.** Echo in dry-run, send one no-op-shaped edit to 6204, diff against W1 | Everything downstream assumes this works as we think. **Unverified by us** | Exact verb, endpoint, required fields, whether a partial payload clobbers |
| **W3** | **Is a cleared field actually cleared in Cin7?** Set `barcode` to `""`, `weight` to `0`, a custom field | ⚠ **Note the SCALE side is already answered: `SAVE` is additive and does NOT clear** (measured 2026-08-18, `QA-UP2-TEST` retained `Green`). This probes the **Cin7** half — whether Cin7 itself even accepts a clear | Per field: clears / silently retains / rejects |
| **W4** | **Does a no-op write bump `modifiedDate`?** | Decides whether a cheap "touch" trigger exists | Bumps / doesn't |
| **W5** | **Does an option-level edit bump the parent's `modifiedDate`?** | Already answered "no" by read-only diagnostics on 25 real options (OQ-2); this would confirm deliberately | Parent moves / doesn't |
| **W6** | **Reversibility register** — per field: reversible cleanly / with residue / one-way | Prevents discovering mid-pass that a field can't be put back | A table in the results file |

---

## 4. End-to-end pass — REQUIRES the status flip first

**No longer load-bearing** (1115 is closed), but still the only way to get **one genuinely populated
real record**, which the final QA pass could never find: **no CTC product in Cin7 production carries
dimension data at all** — 0 of ~3,257 records.

**Revised sequence:** snapshot 6203 → **flip one option `Disabled → Primary`** → confirm it emits at
all → populate that option fully (real weight and dims, populated barcode, real size/colour, a
`categoryIdArray[0]` mapping to a real class) → GET back to confirm the fixture → tight watermark floor
→ assert · then **flip back and prove the revert**.

**Assertions:** fan-out count = eligible option count · `message_group_id` matches · every XML element
against the authored value · **`missing_fields: []` and zero `ManhattanDefaultedField`** ·
`accepted=N rejected=0`.

| ID | Test | Expected |
|---|---|---|
| **W7** | Edit a **product-level** field | All eligible options re-emit — N records from one edit |
| **W8** | Edit **one option** | Only that option emits, or all of them. **Unmeasured**, and it drives volume and coalescing |
| **W9** | Two edits inside one ~3-min flush | `received=M coalesced=N` with **M and N predicted in advance** |
| **W10** | Two edits to different products back to back | Do they share an identical `modifiedDate`? Gives the timestamp-collision frequency OV2 could not measure |

---

## 5. Still worth doing, in priority order

Most of the original plan is superseded. What retains value:

| ID | Test | Why it still matters |
|---|---|---|
| **W19** | **Flip `Product.status` and `ProductOption.status` deliberately, both directions** | **Now the prerequisite for everything else**, not an optional extra — see §2. Also confirms the eligibility gate from the positive side, which live evidence has only ever shown negatively |
| **W12** | **Is `modifiedDate` stamped at transaction start or commit?** Compare the returned value against recorded send/receive times | **The one remaining blind spot in the overlap accept.** Every doc lists it as "vendor behaviour, not observable from our side" — with write access it is |
| **W22** | **Item lifecycle / de-provisioning.** Option `Primary → Disabled`, product `Public → inactive`, then check SCALE | **No AC covers this and it's a real operational gap.** Does a discontinued item deactivate in Manhattan or stay active forever? **The DC team will pick stock for a dead SKU if it strands.** Pairs directly with the confirmed `SAVE`-is-additive finding: **things that stop being true in Cin7 don't stop being true in SCALE.** Reverse immediately after |
| **W26** | **Cin7's own field limits** — push `Desc` past 100, `Size` past 25 in Cin7 | If Cin7 caps below Manhattan's limit, some sender-side limit findings are unreachable in production, which changes their severity. **Feeds the missing LLD §5 length column** |
| **W24 / W25** | **XML-hostile characters and unicode on the real path** | CS3/CS4 passed but **bus-injected only** — escaping has never been tested with content that arrived through the poller |
| **W27** | **Numeric edges** — zero, negative, very large weight; non-numeric or absent dims | ERR4 showed `roundToSchemaPrecision` has **no type guard at all** |
| **W29** | **Real failure traffic for 1117** — over-length `Size` on the real path, then check the alarm and dashboard | Every 1117 finding rests on injected traffic or an idle environment. The alarm turned out to exist and be correctly wired, so this proves the path end to end minus the missing SNS subscription |
| **W30** | **`cin7-watermark-stale` false-positive trap, proven** — a controllable edit makes the poller advance on demand | Staging is idle, so the alarm has been permanently unhelpful. This shows it clearing, which the runbook claims and nobody has demonstrated |
| **W21** | **Defaults matrix** — blank each mapped field in turn, verify the default **and** a `ManhattanDefaultedField` per field | WT1 covered **weight only**; every other default is asserted from code-reading |
| **W28** | **Over-length `Size` / `item_code` via the real poller** | Confirms the injection harness is representative — the same question that turned out to matter for whitespace |
| **W23** | **`item_code` rename** on the burner | Confirms there is no rename path — worth knowing before the DC team does a code cleanup. Also the same hazard as the double-space code already in SCALE: trim it and you get a second item |

**Dropped as no longer needed:** **W17** (whitespace shapes — closed as a harness artefact by Plan C
check 6) · **W11, W13** (answered by OV5 and OV2 respectively) · **W16, W18, W20** (their ACs closed) ·
**W14, W15** (would only strengthen an accept that already holds).

---

## 6. What write access still doesn't fix

| Item | Why |
|---|---|
| **1114 TC1** — brand-new product end to end | Requires create. Out of scope permanently |
| **1115 AC3** — `Company=CTC` metric dimension | Wording or code issue; `Dimensions: []` measured three times |
| **1115 AC5** — 429 / `Retry-After` | Needs mocking at the `libs/cin7` boundary. **Do not provoke a real 429** — shared quota |
| **1116 TC1/TC2/ERR1** — forced endpoint failure | Infrastructure, not fixture shape. Five levers assessed, none available |
| **`send-dlq-depth` fresh fire** | Saturated in ALARM since 08-10 |
| **End-to-end alert chain** | Alerts topic has zero subscriptions |
| **1116 AC4 — the LLD link** | A Confluence edit by Lachlan / Kian |
| **The `PutEvents` blind spot** | Needs a source-code answer — no fixture shape reaches it. That's Plan B |

---

## 7. Tooling spec — for whenever JJ approves it

**`cin7-testset.sh`** — the only sanctioned write path.

- **Hard-coded allowlist: 6202, 6203, 6204, 6205.** Any other id: refuse, exit non-zero. **No override
  flag, no env var.** This is the containment control and must be un-bypassable by accident.
- **Dry-run by default**, `--confirm` to write. Dry run prints the exact verb, URL and full payload —
  which is also what satisfies the disclosure requirement.
- **Read-modify-write enforced internally** — the caller passes only the fields to change; the script
  GETs, merges, PUTs the whole object. This is what stops a partial payload clobbering the fixture.
- `snapshot` / `restore` / `diff` against `fixtures/`. `restore` is a write and needs `--confirm`.
- Append-only `fixtures/write-log.jsonl`: timestamp sent, timestamp response, product id, field,
  before, after, returned `modifiedDate`. **W12 is computed from this log — build the logging in from
  the first write or the measurement is lost.**
- Refuses `DELETE` and any create-shaped call outright, regardless of arguments.

**`cin7-codes-register.md`** — every `item_code` ever minted on 6202, with date and the case that
minted it. Orphan SCALE items are permanent; an unregistered one is a mystery in three weeks.

---

## 8. Reporting

Results to **`CIN7-WRITE-ACCESS-RESULTS.md`** in `testing-tools/`, one section per W case: method,
authored input, observed output quoted from logs, verdict, and an explicit **MEASURED vs INFERRED**
marker.

**Header must carry:** the slot assignment · the four Lambda `LastModified` values · the confirmed
write verb from W2 · the reversibility register from W6 · DLQ baseline and final · every code minted ·
**and confirmation that every option status flipped was flipped back.**

**Do not edit Confluence or Jira — JJ pushes those.**
