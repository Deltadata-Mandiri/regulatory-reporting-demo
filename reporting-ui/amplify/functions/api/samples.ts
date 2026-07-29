/*
 * Scenario presets, bundled from the SAME sample_*.json files in the repo root
 * that the CLI demo uses. server.js reads them with fs.readFileSync at runtime;
 * a bundled Lambda can't reach the repo, so we import the real files (esbuild
 * bundles them in) — the console still cannot drift from the samples.
 *
 * Which files belong to which flow, and their labels, come from flows.json —
 * the same place server.js gets them. Only the import list is repeated here,
 * because a bundler needs static import paths it can see at build time.
 *
 * Paths resolve up to the repo root:
 *   amplify/functions/api/ -> ../../../ = reporting-ui/ -> ../../../../ = repo root
 */
import { FLOWS } from './flows';

import sample_clean from '../../../../sample_clean.json';
import sample_review from '../../../../sample_review.json';
import sample_breach from '../../../../sample_breach.json';
import sample_bmpk_breach from '../../../../sample_bmpk_breach.json';
import sample_rejected from '../../../../sample_rejected.json';
import sample_breach_case from '../../../../sample_breach_case.json';

export type Sample = { id: string; label: string; input: unknown };

// filename -> bundled contents. Keys must match the entries in flows.json.
const BY_FILE: Record<string, unknown> = {
  'sample_clean.json': sample_clean,
  'sample_review.json': sample_review,
  'sample_breach.json': sample_breach,
  'sample_bmpk_breach.json': sample_bmpk_breach,
  'sample_rejected.json': sample_rejected,
  'sample_breach_case.json': sample_breach_case,
};

export function listSamples(flowName: string): Sample[] {
  const flow = FLOWS[flowName];
  if (!flow) return [];
  return flow.samples
    .filter(([file]) => BY_FILE[file] !== undefined)
    .map(([file, label]) => ({
      id: file.replace(/\.json$/, ''),
      label,
      input: BY_FILE[file],
    }));
}
