# Deploying the console to AWS Amplify (Gen 2)

The console runs two ways from one codebase:

| | Local | Deployed |
|---|---|---|
| Proxy | `server.js` — plain Node, zero dependencies | `amplify/functions/api/handler.ts` — Lambda behind a Function URL |
| Credentials | `.env` (gitignored) | Amplify **secrets**, injected as env vars at deploy time |
| Allowlist | `flows.json` | **the same `flows.json`**, bundled in by esbuild |
| Front-end | served by `server.js` from `public/` | Amplify Hosting serves `public/` as a static site |
| API base | same-origin | `amplify_outputs.json` → `custom.apiBase` → the Function URL |

`public/app.js` calls `loadConfig()` on boot: if `amplify_outputs.json` is present it uses
`custom.apiBase` as the API base, otherwise it assumes same-origin. That one branch is the
only difference the front-end knows about.

## One-time setup

```bash
cd reporting-ui
npm install
```

Store the Conductor credentials as secrets — they never enter the repo and are never sent
to the browser:

```bash
npx ampx sandbox secret set CONDUCTOR_SERVER_URL     # https://<cluster>.orkesconductor.io/api
npx ampx sandbox secret set CONDUCTOR_AUTH_KEY
npx ampx sandbox secret set CONDUCTOR_AUTH_SECRET
```

For a branch deployment set the same three in the Amplify console under
**Hosting → Secrets** for that branch.

## Run a sandbox

```bash
npx ampx sandbox          # watches and redeploys
# or
npx ampx sandbox --once
```

This writes `amplify_outputs.json` in `reporting-ui/`. To exercise the *deployed* Lambda
from the local static console, copy it where the front-end can fetch it:

```bash
cp amplify_outputs.json public/amplify_outputs.json
```

Both files are gitignored. Delete `public/amplify_outputs.json` to go back to the local
`server.js` proxy.

## Branch deployment

`amplify.yml` at the repo root is a monorepo build spec with `appRoot: reporting-ui`.
Point an Amplify app at the repository and it will:

1. `npm install`, then `npx ampx pipeline-deploy` — builds the Lambda and the Function URL;
2. copy the generated `amplify_outputs.json` into `public/`;
3. publish `public/` as the static site.

Tear a sandbox down with `npx ampx sandbox delete`.

## The workflows still have to exist

The proxy only orchestrates — it does not register anything. Create the four workflow
definitions on the Conductor cluster first (children before orchestrators):

```bash
npx @conductor-oss/conductor-cli workflow create prudential_ratios.json
npx @conductor-oss/conductor-cli workflow create report_validation.json
npx @conductor-oss/conductor-cli workflow create breach_remediation.json
npx @conductor-oss/conductor-cli workflow create regulatory_report_submission.json
```

If you register them under different names or bump a version, override
`WF_SUBMISSION` / `WF_SUBMISSION_VERSION` / `WF_REMEDIATION` / `WF_REMEDIATION_VERSION`
in `amplify/functions/api/resource.ts` rather than editing `flows.json` — the JSON holds
the defaults, the environment holds the per-deployment overrides.

## One allowlist, not two

`flows.json` is read by **both** runtimes. That is deliberate: it is a security allowlist —
which workflows may be started, which gate refs may be signalled, and which `decision`
values are accepted — and a copy that drifts between the local proxy and the deployed one
is a real vulnerability, not a cosmetic inconsistency. `amplify/functions/api/flows.ts`
imports it; `server.js` requires it; esbuild inlines it into the bundle.

The only thing repeated between the two is the *static import list* in `samples.ts`, because
a bundler needs import paths it can see at build time. The filenames and labels themselves
still come from `flows.json`.

## ⚠ The Function URL is public

`backend.ts` exposes the Lambda with `authType: FunctionUrlAuthType.NONE` and
`allowedOrigins: ['*']`, mirroring the local console, which has no login either. Anyone
with the URL can submit reports and sign the checker, Board and Committee gates.

That is acceptable only for a throwaway demo you keep unshared, and it is a **particularly
poor fit for this domain**: the entire purpose of a maker-checker gate is that a second,
identifiable person signs off. An unauthenticated Function URL means there is no identity
at all, so `reviewedBy` and `approvedBy` are decorative strings. Before this is used for
anything real:

- put the console behind Cognito (`defineAuth`) and switch the Function URL to `AWS_IAM`;
- require a signed-in identity for every gate signal, and bind `reviewedBy` / `approvedBy`
  to it rather than trusting the request body;
- enforce **maker ≠ checker** — the preparer must not be able to approve their own report;
- restrict `allowedOrigins` to the Hosting domain.
