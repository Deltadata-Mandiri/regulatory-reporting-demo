/*
 * The ONLY workflows and gates this proxy will start or signal — the allowlist.
 *
 * NOT a copy. This reads the SAME reporting-ui/flows.json that server.js reads,
 * bundled in by esbuild at build time. An allowlist that drifts between the
 * local proxy and the deployed one is a security bug rather than a cosmetic
 * one, so there is exactly one copy of it in the repo.
 *
 * Per-environment overrides come from WF_<KEY> and WF_<KEY>_VERSION (set in
 * resource.ts), e.g. WF_SUBMISSION / WF_SUBMISSION_VERSION.
 */
import flowsJson from '../../../flows.json';

export type GateContract = {
  label: string;
  enums: Record<string, string[]>;
  strings?: string[];
  numbers?: string[];
  dates?: string[];
  defaults?: Record<string, string>;
};

export type Flow = {
  workflow: string;
  version: string;
  label: string;
  samples: [string, string][];
  gates: Record<string, GateContract>;
};

export const FLOWS: Record<string, Flow> = Object.fromEntries(
  Object.entries(flowsJson as Record<string, any>)
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, f]) => {
      const env = 'WF_' + key.toUpperCase();
      return [
        key,
        {
          ...f,
          workflow: process.env[env] || f.workflow,
          version: process.env[`${env}_VERSION`] || f.version,
        } as Flow,
      ];
    })
);

export function gateContract(flow: Flow, ref: string) {
  const g = flow.gates[ref];
  return {
    ref,
    label: g.label,
    enums: g.enums || {},
    strings: g.strings || [],
    numbers: g.numbers || [],
    dates: g.dates || [],
    defaults: g.defaults || {},
  };
}
