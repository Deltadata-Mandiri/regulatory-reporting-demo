/*
 * Regulatory reporting credentials proxy — Lambda Function URL handler.
 *
 * Amplify Gen 2 port of server.js. Same job: keep the Orkes Conductor app
 * key/secret SERVER-SIDE and forward only allowlisted calls (see flows.ts).
 * The browser talks to the Function URL's /api/* routes and never sees creds.
 *
 * Node 20 runtime — uses the built-in global fetch.
 */
import { FLOWS, gateContract, type Flow } from './flows';
import { listSamples } from './samples';

const CONFIG = {
  serverUrl: (process.env.CONDUCTOR_SERVER_URL || '').replace(/\/+$/, ''),
  authKey: process.env.CONDUCTOR_AUTH_KEY || '',
  authSecret: process.env.CONDUCTOR_AUTH_SECRET || '',
};

// ---------------------------------------------------------------------------
// Conductor token cache + authenticated fetch (auto-refresh on 401).
// A warm Lambda reuses the cached token across invocations.
// ---------------------------------------------------------------------------
let cachedToken: string | null = null;

async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const res = await fetch(`${CONFIG.serverUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId: CONFIG.authKey, keySecret: CONFIG.authSecret }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  cachedToken = ((await res.json()) as { token: string }).token;
  return cachedToken;
}

async function conductor(pathAndQuery: string, options: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getToken();
  const res = await fetch(`${CONFIG.serverUrl}${pathAndQuery}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Authorization': token,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 && retry) {
    cachedToken = null; // token likely expired — refresh once
    return conductor(pathAndQuery, options, false);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Handlers (mirror server.js)
// ---------------------------------------------------------------------------
function flowOr404(name: string): Flow {
  if (!Object.prototype.hasOwnProperty.call(FLOWS, name)) throw new Error(`Unknown flow: ${name}`);
  return FLOWS[name];
}

async function startFlow(flowName: string, input: unknown) {
  const flow = flowOr404(flowName);
  const res = await conductor(
    `/workflow/${encodeURIComponent(flow.workflow)}?version=${encodeURIComponent(flow.version)}`,
    { method: 'POST', body: JSON.stringify(input) }
  );
  const text = (await res.text()).trim();
  if (!res.ok) throw new Error(`Start failed (${res.status}): ${text}`);
  // Orkes returns the workflowId as a bare string (sometimes JSON-quoted).
  return { workflowId: text.replace(/^"|"$/g, ''), workflow: flow.workflow };
}

function openGate(flow: Flow, wf: any) {
  if (!Array.isArray(wf.tasks)) return null;
  for (const t of wf.tasks) {
    if (!Object.prototype.hasOwnProperty.call(flow.gates, t.referenceTaskName)) continue;
    if (t.status === 'IN_PROGRESS' || t.status === 'SCHEDULED') return t;
  }
  return null;
}

async function getFlow(flowName: string, id: string) {
  const flow = flowOr404(flowName);
  const res = await conductor(`/workflow/${encodeURIComponent(id)}?includeTasks=true`);
  const text = await res.text();
  if (!res.ok) throw new Error(`Status failed (${res.status}): ${text}`);
  const wf = JSON.parse(text);
  const gateTask = openGate(flow, wf);
  return {
    workflowId: wf.workflowId,
    workflowType: wf.workflowType,
    status: wf.status,
    awaitingGate: gateTask ? gateTask.referenceTaskName : null,
    gate: gateTask ? gateContract(flow, gateTask.referenceTaskName) : null,
    gatePacket: gateTask ? gateTask.inputData || {} : null,
    tasks: (wf.tasks || []).map((t: any) => ({
      ref: t.referenceTaskName,
      type: t.taskType,
      status: t.status,
      subWorkflowId: t.subWorkflowId || null,
    })),
    reasonForIncompletion: wf.reasonForIncompletion || null,
    output: wf.output || {},
  };
}

async function signalFlow(flowName: string, id: string, ref: string, body: any) {
  const flow = flowOr404(flowName);
  if (!Object.prototype.hasOwnProperty.call(flow.gates, ref)) {
    throw new Error(`Unknown gate "${ref}" for ${flowName}`);
  }
  const g = flow.gates[ref];
  const payload: Record<string, unknown> = {};
  for (const [field, allowed] of Object.entries(g.enums || {})) {
    const v = String((body && body[field]) || '');
    if (!allowed.includes(v)) {
      throw new Error(`Invalid ${field} "${v}" for ${ref}. Allowed: ${allowed.join(', ')}`);
    }
    payload[field] = v;
  }
  for (const f of g.strings || []) payload[f] = String((body && body[f]) || '');
  for (const f of g.numbers || []) payload[f] = Number((body && body[f]) || 0);
  for (const f of g.dates || []) {
    const v = String((body && body[f]) || '');
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${f} must be YYYY-MM-DD`);
    payload[f] = v;
  }
  for (const [f, dflt] of Object.entries(g.defaults || {})) {
    if (!payload[f]) payload[f] = dflt;
  }
  const res = await conductor(
    `/tasks/${encodeURIComponent(id)}/${encodeURIComponent(ref)}/COMPLETED`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Signal failed (${res.status}): ${text}`);
  return { ok: true, ref, payload };
}

// Work queue: every running execution currently parked on a human gate. A
// remediation started as a child of a submission shows up here too — its Board
// gate is real work regardless of who started it.
const QUEUE_SCAN_LIMIT = 12;

async function getQueue() {
  const items: unknown[] = [];
  for (const [flowName, flow] of Object.entries(FLOWS)) {
    if (Object.keys(flow.gates).length === 0) continue;
    let ids: string[] = [];
    try {
      const res = await conductor(
        `/workflow/running/${encodeURIComponent(flow.workflow)}?version=${encodeURIComponent(flow.version)}`
      );
      if (res.ok) ids = (await res.json()) as string[];
    } catch (_) {
      ids = [];
    }
    if (!Array.isArray(ids)) ids = [];
    for (const id of ids.slice(0, QUEUE_SCAN_LIMIT)) {
      try {
        const wf = await getFlow(flowName, id);
        if (!wf.awaitingGate) continue;
        const p: any = wf.gatePacket || {};
        items.push({
          flow: flowName,
          flowLabel: flow.label,
          workflowId: id,
          gate: wf.gate,
          subject: p.reportCode ? `${p.reportCode} · ${p.period || ''}`.trim() : p.caseId || '—',
          reference: p.reportId || p.caseId || '—',
          severity: p.worstSeverity || p.complianceStatus || p.validationStatus || '—',
          reason: p.routeReason || p.instruction || p.breachSummary || '',
          deadline: p.notificationDeadline || p.actionPlanDeadline || null,
          daysToDeadline: p.daysToDeadline != null ? p.daysToDeadline : null,
        });
      } catch (_) {
        /* skip anything we can't read */
      }
    }
  }
  return { items, scannedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Function URL router (payload format 2.0)
// ---------------------------------------------------------------------------
const NAMES = Object.keys(FLOWS).join('|');
const RE_SAMPLES = new RegExp(`^/api/(${NAMES})/samples$`);
const RE_START = new RegExp(`^/api/(${NAMES})$`);
const RE_SIGNAL = new RegExp(`^/api/(${NAMES})/([^/]+)/signal/([^/]+)$`);
const RE_STATUS = new RegExp(`^/api/(${NAMES})/([^/]+)$`);

function json(statusCode: number, obj: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}

function parseBody(event: any): any {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw new Error('Invalid JSON body');
  }
}

export const handler = async (event: any) => {
  const method: string = event?.requestContext?.http?.method || 'GET';
  const url: string = (event?.rawPath || '/').split('?')[0];

  try {
    if (url === '/api/flows' && method === 'GET') {
      return json(
        200,
        Object.fromEntries(
          Object.entries(FLOWS).map(([k, f]) => [
            k,
            {
              workflow: f.workflow,
              version: f.version,
              label: f.label,
              gates: Object.fromEntries(Object.keys(f.gates).map((r) => [r, gateContract(f, r)])),
            },
          ])
        )
      );
    }
    if (url === '/api/queue' && method === 'GET') return json(200, await getQueue());

    let m: RegExpMatchArray | null;
    if ((m = url.match(RE_SAMPLES)) && method === 'GET') {
      return json(200, { samples: listSamples(m[1]) });
    }
    if ((m = url.match(RE_SIGNAL)) && method === 'POST') {
      return json(200, await signalFlow(m[1], m[2], m[3], parseBody(event)));
    }
    if ((m = url.match(RE_START)) && method === 'POST') {
      return json(200, await startFlow(m[1], parseBody(event)));
    }
    if ((m = url.match(RE_STATUS)) && method === 'GET') {
      return json(200, await getFlow(m[1], m[2]));
    }
    if (url.startsWith('/api/')) return json(404, { error: 'Unknown endpoint' });
    return json(404, { error: 'Not found' });
  } catch (err: any) {
    console.error('[api error]', err?.message);
    return json(502, { error: err?.message || 'Proxy error' });
  }
};
