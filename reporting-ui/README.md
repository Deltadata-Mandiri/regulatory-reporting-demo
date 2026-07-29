# Konsol Pelaporan Regulator

A regulatory reporting console over the four Conductor workflows in the parent directory,
served by a **zero-dependency backend-for-frontend proxy** that keeps the Orkes app
key/secret server-side. The browser never receives credentials — it only talks to
`/api/*` on this proxy.

```bash
cp .env.example .env    # fill in CONDUCTOR_SERVER_URL / AUTH_KEY / AUTH_SECRET
node server.js          # -> http://localhost:4400
```

Node ≥ 18 (uses the built-in `fetch` and `http`). Nothing to install to run locally — the
`devDependencies` in `package.json` are only needed to deploy.

To deploy it to AWS instead (Amplify Hosting for the static console, a Lambda Function URL
for the proxy), see **[AMPLIFY_DEPLOY.md](AMPLIFY_DEPLOY.md)**. Same front-end, same
allowlist; only the proxy's host changes.

## What's in it

| Tab | Drives |
|---|---|
| **Penyampaian Laporan** | `regulatory_report_submission` — the full pipeline, with the checker gate |
| **Remediasi Pelampauan** | `breach_remediation` standalone, with the Board / Committee gate |
| **Antrean Persetujuan** | Every running execution parked on a human gate, across both flows |

Scenario presets are read by the proxy from the **same `sample_*.json` files the CLI demo
uses**, so the console and the command line can never drift apart. Editable form fields are
a curated subset — every hint names the check or ratio that field moves (`>0 = E06 blocking`,
`turunkan → KPMM di bawah minimum`), so the console doubles as a way to prove a rule fires.
Everything else in the preset (the exposure list, the form schedules, the buffer settings)
is passed through untouched.

## The ratio strip

The result panel leads with six prudential ratios as stat tiles with bullet meters: the fill
is the reported value, the rules on the track are the regulatory limits, and for CAR there are
**two** marks — the hard minimum for the bank's risk profile and the higher figure required
once buffers are added.

Severity is carried by three channels at once — fill colour, a glyph, and a word
(`✓ Dalam ketentuan` / `! Buffer kurang` / `✕ Pelampauan`). That is not decoration. The
green and amber in this palette measure only **ΔE 4.8 apart under protanopia**, so hue alone
would not separate "within limits" from "needs attention" for a red-green colourblind
reviewer. The same rule applies to the finding rows, which state `KESALAHAN` or `PERINGATAN`
in words rather than relying on the red/amber background.

A buffer shortfall renders amber, not red — a bank at 12.8% against a 13% requirement has not
broken the 9% minimum, it has lost its freedom to distribute dividends. The tile says so.

## Security posture

The allowlist lives in **`flows.json`**, read by both the local `server.js` and the deployed
Lambda. One copy on purpose: an allowlist that drifts between local and deployed is a real
vulnerability, not a cosmetic inconsistency.

The proxy is an **allowlist, not a relay**. It will only:

- start the two workflows named in `FLOWS` (overridable by env var, not by the browser);
- signal the four gate refs those flows declare — `checker_ref`, `breach_checker_ref`,
  `board_ref`, `committee_ref`;
- accept a `decision` value the gate itself declares.

Anything else is refused *before* a Conductor call is made:

```
invalid decision : {"error":"Invalid decision \"SEND_ANYWAY\" for breach_checker_ref. Allowed: APPROVE, REJECT"}
undeclared gate  : {"error":"Unknown gate \"some_other_ref\" for submission"}
unknown flow     : {"error":"Unknown endpoint"}
path traversal   : 404
```

Static file serving is confined to `public/` by a normalised-prefix check.

## Not production

- **No authentication.** `reviewedBy` and `approvedBy` are free text. Bind them to SSO and
  enforce **maker ≠ checker** before this is anything but a demo — right now the same person
  can prepare and approve, which is the exact control a reporting workflow exists to impose.
- The queue scans at most 12 running executions per flow; a real console pages.
- Polling is a 1.5s interval, and stops as soon as an execution finishes or parks on a gate.
- A remediation started as a **child** of a submission also appears in the queue. That is
  deliberate: its Board gate is real work regardless of who started it.
