import { defineBackend } from '@aws-amplify/backend';
import { FunctionUrlAuthType, HttpMethod } from 'aws-cdk-lib/aws-lambda';
import { apiFunction } from './functions/api/resource';

/*
 * DEMO / OPEN deployment.
 *
 * The proxy Lambda is exposed via a public Function URL with NO auth
 * (authType NONE) — matching the local console, which has no login. Anyone with
 * the URL can submit reports and sign the checker / Board / Committee gates.
 *
 * That is acceptable ONLY for a throwaway demo you keep unshared. It is a
 * particularly bad fit for this domain: the whole point of a maker-checker gate
 * is that a second identity signs off, and an unauthenticated Function URL means
 * there is no identity at all. Before this goes anywhere real, put the console
 * behind Cognito (defineAuth), require a signed-in identity for the gate
 * signals, and enforce maker != checker.
 */
const backend = defineBackend({
  apiFunction,
});

const fnUrl = backend.apiFunction.resources.lambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [HttpMethod.ALL],
    allowedHeaders: ['*'],
  },
});

// Surfaced into amplify_outputs.json so the static front-end can discover the
// API base at runtime (see public/app.js -> loadConfig).
backend.addOutput({
  custom: {
    apiBase: fnUrl.url,
  },
});
