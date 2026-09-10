# BUSY-1117 AC4 — is the intended-recipients SSM parameter wired to anything?

**Session:** read-only verification only. Stage `staging`, profile `staging`, region `ap-southeast-2`.
Run 2026-08-19. No writes made — no secret, watermark, alarm, Lambda config, Cin7, Confluence or Jira
touched. This file is scoped to AC4 only; it does not touch `BUSY-1117-RUN-LOG.md` or
`BUSY-1117-FORCED-BREAK-RESULTS.md`, which belong to the concurrent forced-blank-secret session.

**Verdict up front: the SSM parameter does not exist. It is not dead config being ignored — there is
no config there to be wired up.** Separately, and NOT via that parameter, one email subscription now
exists on the alerts topic, added out-of-band. All four alarms checked route their `AlarmActions` to
that topic. The dashboard references neither the parameter nor the topic.

---

## 1. SSM parameter `/catalog/manhattan-observability/alert-emails/staging`

**MEASURED — the parameter does not exist.**

```
$ aws ssm get-parameter --name /catalog/manhattan-observability/alert-emails/staging --profile staging --region ap-southeast-2
An error occurred (ParameterNotFound) when calling the GetParameter operation:
```

Followed up with broader searches to rule out a naming drift (this account has a history of doc names
not matching deployed names — see CLAUDE.md's secret/watermark examples):

```
$ aws ssm get-parameters-by-path --path /catalog/manhattan-observability --recursive --profile staging --region ap-southeast-2
{"Parameters": []}

$ aws ssm get-parameters-by-path --path /catalog --recursive --profile staging --region ap-southeast-2
(no output — nothing under /catalog matches alert/email/observability)

$ aws ssm describe-parameters --profile staging --region ap-southeast-2 \
    --query "Parameters[?contains(Name, 'observability')].Name" --output text
(no output — zero parameters anywhere in the account contain "observability" in the name)

$ aws ssm describe-parameters --profile staging --region ap-southeast-2 \
    --query "Parameters[?contains(Name, 'alert') || contains(Name, 'email')].Name" --output text
/orders/cx_notification_email/staging	/orders/partnerships_notification_email/staging
```

**MEASURED:** the only alert/email-named parameters in the whole account belong to an unrelated
`/orders/` domain. Nothing under any path resembles the QA-doc name. **No type, no value, no
LastModifiedDate to report — there is nothing there.**

---

## 2. SNS subscriptions on `staging-catalog-manhattan-observability-alerts`

**MEASURED — one confirmed email subscription exists, and it does not trace back to the SSM parameter.**

```
$ aws sns list-subscriptions-by-topic \
    --topic-arn arn:aws:sns:ap-southeast-2:398353400186:staging-catalog-manhattan-observability-alerts \
    --profile staging --region ap-southeast-2
{
  "Subscriptions": [
    {
      "SubscriptionArn": "...observability-alerts:e386f94a-2dec-4d3b-bbaf-a4b3d2bdf9bb",
      "Protocol": "email",
      "Endpoint": "james.johnston@universalstore.com.au",
      "TopicArn": "arn:aws:sns:...observability-alerts"
    }
  ]
}
```

`get-subscription-attributes` on that ARN:

```
"PendingConfirmation": "false"
"ConfirmationWasAuthenticated": "false"
"SubscriptionPrincipal": "arn:aws:iam::398353400186:role/aws-reserved/sso.amazonaws.com/.../AWSReservedSSO_AWSPowerUserAccess_..."
```

**MEASURED facts:**
- Exactly **one** subscription exists, protocol `email`, endpoint `james.johnston@universalstore.com.au`.
- It is **confirmed** (`PendingConfirmation: false`) — a click-through happened at some point.
- Its `SubscriptionPrincipal` is an interactive SSO role (`AWSPowerUserAccess`), not a deploy/IaC role
  ARN — i.e., **MEASURED that it was added by a human via console/CLI, not by any automation reading
  the SSM parameter** (which doesn't exist to be read from — see §1).

⚠ **This contradicts CLAUDE.md's "ZERO subscriptions — nothing in staging notifies anyone," last
reconciled 2026-08-18.** That claim is now stale as of this run (2026-08-19) — flagging rather than
silently overwriting it, since CLAUDE.md is user-maintained. **INFERRED:** most likely JJ subscribed
himself manually at some point after the 2026-08-18 reconciliation (the endpoint is JJ's own address),
possibly for exactly this kind of closeout check — but the *why* is UNKNOWN, only the *what* is measured.

**Comparison against what the parameter says it should be: impossible.** The parameter doesn't exist, so
there is no "should be" list to diff the topic's one real subscriber against.

---

## 3. Alarm routing — AlarmActions / OKActions / InsufficientDataActions

**MEASURED**, via `describe-alarms` on all four names in one call — all four resolved (no
`ResourceNotFoundException`, all four returned):

| Alarm | AlarmActions | OKActions | InsufficientDataActions |
|---|---|---|---|
| `staging-catalog-cin7-poller-errors` | → `...observability-alerts` topic | `[]` | `[]` |
| `staging-catalog-cin7-watermark-stale` | → `...observability-alerts` topic | `[]` | `[]` |
| `staging-catalog-manhattan-sender-validation-failures` | → `...observability-alerts` topic | `[]` | `[]` |
| `staging-catalog-manhattan-send-dlq-depth` | → `...observability-alerts` topic | `[]` | `[]` |

**MEASURED: all four route their `AlarmActions` to the alerts topic. None of the four checked has an
empty `AlarmActions` list.** None route "nowhere" on the alarm-transition side. All four have empty
`OKActions` and `InsufficientDataActions` — recovery and missing-data transitions notify nobody for any
of the four, only the ALARM transition does.

So: with the one confirmed subscriber from §2 in place, **all four of these alarms would now actually
reach an inbox on their ALARM transition** — but that reachability exists **despite** the SSM parameter,
not because of it, since nothing reads that parameter to populate the subscriber list.

**Scope note:** this checked only the four alarms named in the task. It is not a full inventory of every
alarm on this bus/pipeline — do not read "all alarms route correctly" from this table, only these four.

---

## 4. Dashboard reference check

**MEASURED — `staging-catalog-manhattan-observability-dashboard` references neither the alerts topic ARN
nor the alert-emails parameter, anywhere in its body.**

```
$ aws cloudwatch get-dashboard --dashboard-name staging-catalog-manhattan-observability-dashboard \
    --profile staging --region ap-southeast-2 --query DashboardBody --output text
```

Body is 21,461 bytes, well-formed, contains a real `"type":"alarm"` widget listing the four alarm ARNs
(including the ones in §3) by CloudWatch alarm ARN (`arn:aws:cloudwatch:...:alarm:...`). Searched the
full body text for:
- the topic ARN literal (`398353400186:staging-catalog-manhattan-observability-alerts`) — **0 matches**
- the string `alert-emails` — **0 matches**

Per the task, AC3's four series are not re-verified here (already PASS). This is scoped to the single
question asked: **the dashboard shows alarm *state* via an alarm widget, but has no textual reference to
the topic or the parameter — it neither confirms nor depends on either.**

---

## Summary verdict for AC4

| Question | Answer | Tag |
|---|---|---|
| Does the SSM parameter exist? | **No** — confirmed absent by direct lookup and by two path/name sweeps of the whole account | MEASURED |
| Is the parameter referenced by anything observable (topic subscriptions, alarm config, dashboard)? | **No** — nothing reads it; it is not merely unwired, it is not present to be wired | MEASURED |
| Does the topic have subscribers? | **Yes, one** — confirmed email subscription to JJ's address, added via an interactive SSO session, not traceable to the SSM parameter | MEASURED |
| Do the four named alarms route to the topic? | **All four**, on `AlarmActions` only; `OKActions`/`InsufficientDataActions` are empty on all four | MEASURED |
| Does the dashboard reference the topic or parameter? | **No**, on either count | MEASURED |

**Plain statement for the QA doc:** the "not substantiated" item was that the intended-recipients SSM
parameter's wiring couldn't be confirmed. It's now closable, but not in the direction the name implies:
**the parameter itself does not exist anywhere in the account**, so it cannot be "wired to" anything —
dead or otherwise. Separately, the alerts topic is no longer at zero subscribers as CLAUDE.md's
2026-08-18 record states — it now has one confirmed manual email subscription, unrelated to the missing
parameter, and all four alarms checked would reach it on their ALARM transition.

**Not substantiated by this pass (flagging rather than guessing):**
- *Why* the parameter was never created — was it ever meant to exist, or is the "SSM parameter" design
  itself the stale artefact (i.e., maybe recipients were always meant to be a hard-coded/manual
  subscription)? UNKNOWN — would need dev/IaC-repo confirmation, out of scope for a read-only AWS check.
- *When* and *why* the one subscription was added, and whether it's meant to be the permanent state or a
  temporary manual add for this investigation. UNKNOWN.
