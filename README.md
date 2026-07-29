# Regulatory Reporting — Orkes Conductor

Periodic prudential reporting for an Indonesian commercial bank — the monthly submission
of a **Laporan Bulanan Bank Umum (LBU)** to the regulator, with the edit-check suite,
the prudential ratio calculation, maker-checker sign-off, and breach escalation that have
to happen before a file is allowed to leave the building.

Four workflow definitions — two reusable children under two orchestrators:

| Workflow | Role |
|---|---|
| **`prudential_ratios`** | *Child.* Single source of truth for KPMM/CAR, CET1, Tier 1, NPL gross & net, RIM, LCR, NSFR, GWM and BMPK — and for the limits themselves |
| **`report_validation`** | *Child.* The regulator's edit-check suite. What the **file** says, as opposed to what the bank's position is |
| `regulatory_report_submission` | Validate → both children in parallel → route → checker → memo → transmit → receipt |
| `breach_remediation` | Recompute → map breaches to remedial actions → Board / Committee → action plan + notification draft |

```
regulatory_report_submission ──┬──> report_validation
                               ├──> prudential_ratios      (2 callers)
                               └──> breach_remediation ──> prudential_ratios
```

Plus **`reporting-ui/`** — a reporting console over both orchestrators, served by a
zero-dependency backend-for-frontend proxy that keeps the Conductor key/secret server-side.
Tabs per flow, scenario presets read from the sample files, a live task trace, a prudential
ratio strip with the regulatory limits marked on each meter, and a cross-flow approval queue.
See [reporting-ui/README.md](reporting-ui/README.md).

```bash
cd reporting-ui && cp .env.example .env   # fill in credentials
node server.js                            # -> http://localhost:4400
```

It also deploys to AWS as-is — Amplify Hosting for the static console, a Lambda Function URL
for the proxy, Conductor credentials held as Amplify secrets. `amplify.yml` here is the
monorepo build spec; see [reporting-ui/AMPLIFY_DEPLOY.md](reporting-ui/AMPLIFY_DEPLOY.md).

```
validate → gate → ┌─ report_validation ─┐ → route ─┬─ AUTO     → transmit
                  └─ prudential_ratios ─┘          ├─ REVIEW   → checker WAIT → transmit
                        (FORK_JOIN)                ├─ BREACH   → breach_remediation
                                                   │            → checker WAIT → transmit
                                                   └─ REJECTED → returned, never transmitted
        → transmittal memo (LLM) → PDF → transmit → receipt → notify
```

## Why two children, not one validator

The tempting split is "one workflow that checks the report." It doesn't survive contact
with the domain, because two genuinely different questions are being asked at the same
time, of two different subjects:

- **`report_validation` asks whether the *file* is fit to transmit.** Do the mandatory
  forms exist, does it tie to the general ledger, does the balance sheet balance, are the
  reporting codes (sandi) real, are mandatory fields populated. Its failures are the
  preparer's to fix, and they are *blocking* — a file that doesn't reconcile cannot be sent
  at all.
- **`prudential_ratios` asks whether the *bank* is within its limits.** CAR against the
  minimum for its risk profile, NPL, LCR, BMPK. Its failures are not the preparer's fault
  and are **not** a reason to withhold the report — quite the opposite. A bank that has
  breached its CAR is *more* obliged to report, not less.

Those two verdicts combine into one route, and the combination is the whole point. The
demo proves both directions:

- `sample_rejected.json` — every ratio is green, and the report is still **not transmitted**,
  because the file fails seven edit checks.
- `sample_breach.json` — the file is **perfect**, scores 100 on every edit check, and the
  submission still escalates to the Board, because the bank's CAR is 7.6%.

Getting that backwards is the classic failure: a reporting system that blocks submission
when the ratios look bad. That hides a breach from the regulator, which is a far more
serious offence than the breach itself.

`prudential_ratios` is called by **both** orchestrators, and `breach_remediation` calls it
again rather than trusting the figures the submission flow passed it — a remediation case
recomputes from source, because it may be raised days later, standalone, from corrected data.

## The ratio model (`prudential_ratios`)

Deterministic and explainable — every breach carries the metric, the actual, the limit, a
severity, and the governing regulation, so the escalation path and the action plan are both
derivable from the output rather than hard-coded downstream.

### Capital

```
Tier 1        = CET1 + AT1
Total capital = Tier 1 + Tier 2
Total RWA     = ATMR credit + market + operational
CAR (KPMM)    = Total capital / Total RWA
```

The required CAR is not a constant — it is assembled per bank:

| Component | Value |
|---|---|
| Minimum by risk profile (1 / 2 / 3 / 4–5) | 8% / 9% / 10% / 11% |
| Capital conservation buffer (KBMI 3–4) | +2.5% |
| Countercyclical buffer | +0–2.5% (input; BI has held this at 0%) |
| D-SIB surcharge (bucket 1 / 2 / 3 / 4) | +1% / +1.5% / +2% / +2.5% |

The demo bank is risk profile 2, KBMI 3, D-SIB bucket 2 → **9 + 2.5 + 0 + 1.5 = 13%** required,
against a 9% hard minimum. That gap is deliberate and load-bearing: see *Buffer shortfall*
below. CET1 ≥ 4.5% and Tier 1 ≥ 6% are checked independently.

### Asset quality, liquidity, concentration

| Metric | Formula | Limit | Regulation |
|---|---|---|---|
| NPL gross | (kol 3+4+5) / total loans | ≤ 5% | POJK 40/POJK.03/2019 |
| NPL net | (kol 3+4+5 − CKPN) / total loans | ≤ 5% | POJK 40/POJK.03/2019 |
| CKPN coverage | CKPN / NPL | watch < 50% | — |
| RIM | (loans + corporate bonds) / (DPK + securities issued) | 84–94% | PBI 21/12/PBI/2019 |
| LCR | HQLA / net cash outflow 30d | ≥ 100% | POJK 42/POJK.03/2015 |
| NSFR | ASF / RSF | ≥ 100% | POJK 50/POJK.03/2017 |
| GWM Rupiah | reported | ≥ 9% | PADG BI |
| BMPK single borrower | exposure / capital | ≤ 20% | POJK 32/POJK.03/2018 |
| BMPK group | group exposure / capital | ≤ 25% | POJK 32/POJK.03/2018 |
| BMPK related party | aggregate / capital | ≤ 10% | POJK 32/POJK.03/2018 |

### Severity, and what it drives

| Severity | Triggered by | Consequence |
|---|---|---|
| `CRITICAL` | CAR/CET1/Tier 1 below **minimum**, LCR < 100%, NPL net > 5%, any BMPK breach | Board escalation, mandatory notification, action plan in 5 days |
| `HIGH` | CAR below **required incl. buffers**, NSFR < 100%, GWM shortfall | Committee escalation, action plan in 14 days |
| `MEDIUM` | NPL gross > 5% alone, RIM outside 84–94% | Monitoring only |
| watch | Within ~1pp / 10% of a limit | Surfaces in the memo, does not escalate |

**Buffer shortfall is `HIGH`, not `CRITICAL`, and does not trigger mandatory notification.**
A bank at 12.8% against a 13% requirement has not broken the 9% minimum — it has lost its
freedom to distribute dividends until the buffer is rebuilt. Treating that as a breach of
the minimum would be both wrong and needlessly alarming; treating it as nothing would let
a bank pay a dividend it isn't entitled to.

## The edit-check suite (`report_validation`)

Blocking errors stop the file. Warnings require a human explanation but do not.

| Code | Check | Kind |
|---|---|---|
| `E01_FORM_MISSING` | Every required form present | blocking |
| `E02_NO_RECORDS` | Report contains data rows | blocking |
| `E03_GL_RECON` | Total assets tie to the general ledger within tolerance | blocking |
| `E04_BALANCE` | Assets = liabilities + equity | blocking |
| `E05_LOAN_XREF` | Loan total ties to the credit ledger | blocking |
| `E06_INVALID_SANDI` | No unrecognised reporting codes | blocking |
| `E07_NULL_MANDATORY` | No empty mandatory fields | blocking |
| `E08_DUPLICATE` | No duplicate rows | blocking |
| `W01_VARIANCE` | Total assets moved > 15% vs prior period | warning |
| `W02_LATE` | Past the submission deadline | warning |
| `W03_DEADLINE_NEAR` | ≤ 1 day to deadline | warning |
| `W04_RESUBMISSION` | Corrected ≥ 2 times this period | warning |

**Late is a warning, not a blocker.** A report that has missed its deadline still has to be
submitted — lateness attracts an administrative sanction, it does not cancel the obligation.
Blocking a late file would turn a fine into a continuing violation. It routes to a checker,
sets `sanctionRisk`, and goes out.

## Routing

`determine_route` combines both verdicts, in this order:

| Order | Condition | Route | Transmitted? |
|---|---|---|---|
| 1 | Any blocking edit-check error | `REJECTED` | **No** — returned to preparer |
| 2 | Mandatory notification, or compliance `BREACH*` | `BREACH` | Yes, with disclosure, after remediation + checker |
| 3 | Warnings, late, minor non-compliance, or watch | `REVIEW` | Yes, after checker WAIT |
| 4 | Otherwise | `AUTO` | Yes, straight through |

## Breach remediation

`breach_remediation` maps every breach code to the specific remedial actions its regulation
demands — a capital restoration plan and dividend suspension for `CAR_MIN`, the Contingency
Funding Plan and daily LCR reporting for `LCR_MIN`, an exposure reduction schedule and a stop
on new facilities for `BMPK_*` — deduplicated across breaches, with deadlines computed from
the pinned `asOfDate`:

| Tier | Trigger | Owner | Notify within | Action plan within | Target cure |
|---|---|---|---|---|---|
| `BOARD` | any `CRITICAL` | Direksi & Dewan Komisaris | 1 day | 5 days | 90 days |
| `COMMITTEE` | worst is `HIGH` | Komite Manajemen Risiko | 5 days | 14 days | 180 days |
| `MONITOR` | `MEDIUM` or clean | SKMR | — | 30 days | 180 days |

## Running it

Credentials are read the same way as the sibling demos (server URL + app key/secret in
`../credit-score-demo/credit-ui/.env`, or your own Conductor CLI config).

Register the children first — the orchestrators reference them by name and version:

```bash
npx @conductor-oss/conductor-cli workflow create prudential_ratios.json
npx @conductor-oss/conductor-cli workflow create report_validation.json
npx @conductor-oss/conductor-cli workflow create breach_remediation.json
npx @conductor-oss/conductor-cli workflow create regulatory_report_submission.json

npx @conductor-oss/conductor-cli workflow start -w regulatory_report_submission -f sample_clean.json
```

| Sample | Edit-check | Ratios | Route | Outcome |
|---|---|---|---|---|
| `sample_clean.json` | PASS (100) | CAR 20%, all green | `AUTO` | Transmitted straight through, receipt issued |
| `sample_review.json` | PASS_WITH_WARNINGS (90) | `WATCH` — related party 9.6% | `REVIEW` | Checker WAIT — assets +21.97%, 1 day to deadline |
| `sample_breach.json` | **PASS (100)** | CAR 7.6%, NPL net 5.24%, LCR 85.71% | `BREACH` | Board, 4 breaches, 14 remedial actions |
| `sample_bmpk_breach.json` | PASS (100) | CAR 20% — but BMPK 24% / 42% / 12% | `BREACH` | Board, concentration only |
| `sample_rejected.json` | **FAIL (0)** — 7 errors | all green | `REJECTED` | **Not transmitted**, returned to preparer |
| `sample_breach_case.json` | — | drives `breach_remediation` standalone | — | Board tier, action plan by 2026-07-15 |

Every sample pins `asOfDate: 2026-07-10` (or `2026-07-14` for the deadline warning) against a
`2026-07-15` deadline, so the day-count maths and every outcome above are reproducible.

### Signalling the WAIT gates

`sample_review.json` and both breach samples pause `RUNNING` on a WAIT. Complete it with the
task reference name for the branch — `checker_ref` on the REVIEW path, `breach_checker_ref`
on the BREACH path:

```bash
curl -X POST "$CONDUCTOR_SERVER_URL/tasks/{workflowId}/checker_ref/COMPLETED" \
  -H "Content-Type: application/json" -H "X-Authorization: $TOKEN" \
  -d '{"decision":"APPROVE","note":"Kenaikan aset dari akuisisi portofolio, dokumen terlampir","reviewedBy":"Kepala SKK"}'
```

`decision` is `APPROVE` or `REJECT`; anything else on the REVIEW path is treated as
*approve with explanation*. A `REJECT` sets `RETURNED_TO_PREPARER` and the report is never
transmitted. Inside `breach_remediation` the gates are `board_ref` and `committee_ref`, which
take `approvedBy` and `note`.

## Two design points worth demoing

**The report goes out even when the news is bad.** The only route that withholds a file is
`REJECTED`, and it is reached solely through the edit-check suite — never through a ratio
breach. `sample_breach.json` transmits with `APPROVED_WITH_BREACH_DISCLOSURE`. This is the
single most important property of the design, and it is the one a naive implementation gets
wrong, because "stop if something is wrong" feels like the safe default. It isn't: concealing
a breach from the supervisor is the offence, not the breach.

**The two children disagree productively.** They run in parallel in a `FORK_JOIN`, know
nothing about each other, and neither can veto the other. `determine_route` is the only place
their verdicts meet, and all it does is test four conditions in a fixed order. Adding a third
opinion — say, an external data-quality service — means adding a fork branch and one clause,
not rewriting a validator.

## Path to production

The workflow shape does not change — only a few task bodies do:

| Demo (now) | Production |
|---|---|
| Balance-sheet aggregates passed in per run | `HTTP` against the data warehouse / reporting mart at cut-off |
| `report_validation` INLINE edit checks | The regulator's own published validation rules, or the ANTASENA/APOLO offline validator invoked over `HTTP` |
| `prudential_ratios` INLINE | Risk engine / RWA calculator; the ratio definitions stay here as the control point |
| `transmit_report` INLINE, synthetic receipt | `HTTP` to the ANTASENA/APOLO gateway with the signed file, real receipt persisted |
| Checker WAIT signalled by curl | Reporting workbench posting the completion, `reviewedBy` bound to SSO, maker ≠ checker enforced |
| `prepare_notification` INLINE | `EVENT` to the notification sink |
| Manual start per period | `CRON`-scheduled per report code off the regulatory calendar |

The channel mapping in `transmit_report` (LBU-family → ANTASENA, ratio reports → APOLO) is
illustrative; the real routing follows the reporting calendar and the current BI–OJK
integrated reporting arrangements, which move.

## Gotchas handled while building this

- **Arrays into an INLINE task arrive as Java-`List`-backed proxies** where the reflective JS
  APIs misbehave. `largeExposures`, `submittedForms`, `requiredForms` and the breach list are
  each serialized with `JSON_JQ_TRANSFORM` + `tojson` first (`stringify_exposures`,
  `stringify_forms`, `stringify_breaches`), and the INLINE task `JSON.parse`s a real string.
- **Arrays into LLM messages** get Java-`toString`'d into `{k=v}` garbage. Breach lists, watch
  items, remedial actions, route reasons and missing forms are all joined into readable strings
  by JQ before reaching a prompt. `prudential_ratios` exposes `breachSummary` as a workflow
  output so all three of its callers get the joined text for free instead of each re-joining it.
- **`outputParameters` must not reference tasks inside a `SWITCH` branch** — on any run that
  took a different branch the reference dangles. Every branch writes through `SET_VARIABLE`,
  and the workflow outputs read `workflow.variables.*`. The two WAIT branches also need
  *distinct* task reference names (`checker_ref` vs `breach_checker_ref`); reusing one name
  across branches is rejected at registration.
- **The LLM must never say the regulator accepted the report.** Transmission and acceptance
  are different events — the workflow can only achieve the first. Both system prompts forbid
  asserting acceptance, approval or receipt by the authority, and `transmit_report` returns
  the deliberately unambiguous `TRANSMITTED_AWAITING_REGULATOR_ACCEPTANCE`. Re-check this
  whenever a prompt changes.
- **Order matters in `determine_route`.** Blocking errors are tested before breaches; if the
  file cannot be trusted, its ratios are not evidence of anything and escalating on them would
  raise a breach case off numbers that failed reconciliation.
- **Receipt numbers are derived, not random.** `transmit_report` hashes `reportId + code +
  period` into the sequence so re-running a sample reproduces its receipt — a `new Date()`
  would make every demo run differ.

## Demo data — fictional

⚠ PT Bank Delta Nusantara, its counterparties and every figure in the `sample_*.json` files
are invented for demonstration and do not refer to any real bank, borrower or position. The
ratio formulas and limits follow the shape of Indonesian prudential regulation but are
simplified for the demo and are **not** a compliance reference — thresholds, buffer settings
and the reporting calendar change, and the authoritative text is the POJK/PBI itself.
