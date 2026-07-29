import { defineFunction, secret } from '@aws-amplify/backend';

/*
 * The regulatory reporting credentials proxy, as a Lambda.
 *
 * This is the Amplify Gen 2 port of server.js. The three Conductor credentials
 * are stored as Amplify SECRETS (never in the repo, never sent to the browser)
 * and injected as environment variables at deploy time. The workflow allowlist
 * — which workflows and gates this proxy will touch — lives in flows.json, the
 * same file the local server reads.
 *
 * Set the secrets before deploying:
 *   npx ampx sandbox secret set CONDUCTOR_SERVER_URL
 *   npx ampx sandbox secret set CONDUCTOR_AUTH_KEY
 *   npx ampx sandbox secret set CONDUCTOR_AUTH_SECRET
 */
export const apiFunction = defineFunction({
  name: 'reporting-proxy',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 30, // the queue scan touches several running executions
  memoryMB: 512,
  environment: {
    CONDUCTOR_SERVER_URL: secret('CONDUCTOR_SERVER_URL'),
    CONDUCTOR_AUTH_KEY: secret('CONDUCTOR_AUTH_KEY'),
    CONDUCTOR_AUTH_SECRET: secret('CONDUCTOR_AUTH_SECRET'),
    // Override the flows.json defaults per environment if you register the
    // workflows under different names or bump a version.
    WF_SUBMISSION: 'regulatory_report_submission',
    WF_SUBMISSION_VERSION: '1',
    WF_REMEDIATION: 'breach_remediation',
    WF_REMEDIATION_VERSION: '1',
  },
});
