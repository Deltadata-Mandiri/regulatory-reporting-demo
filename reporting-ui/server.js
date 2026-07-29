/*
 * Konsol Pelaporan Regulator — credentials proxy (backend-for-frontend)
 *
 * Purpose: keep the Orkes Conductor app key/secret SERVER-SIDE. The browser
 * never receives credentials — it only talks to this proxy's /api/* routes.
 * The proxy performs the Orkes key/secret -> token exchange and forwards
 * whitelisted calls to Conductor.
 *
 * Only the workflows and gates declared in FLOWS below are reachable, and a
 * signal is rejected unless its decision value is one that gate declares. A
 * request naming anything else is rejected before a Conductor call is made,
 * so the browser cannot use this proxy as an open relay to the cluster.
 *
 * Both orchestrators are served by this ONE process. breach_remediation is
 * reachable in its own right because a breach case is also raised standalone,
 * days later, from corrected figures — and because a remediation started as a
 * child of a submission still parks on a Board gate that somebody has to clear.
 *
 * Zero external dependencies: pure Node (>=18) using the built-in fetch + http.
 * Run:  node server.js   (after filling in .env)
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Minimal .env loader (no dotenv dependency). Real process.env wins over file.
// ---------------------------------------------------------------------------
function loadEnv(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch (_) { /* no .env file — rely on real env vars */ }
}
loadEnv(path.join(__dirname, '.env'));

const CONFIG = {
  serverUrl: (process.env.CONDUCTOR_SERVER_URL || '').replace(/\/+$/, ''),
  authKey: process.env.CONDUCTOR_AUTH_KEY || '',
  authSecret: process.env.CONDUCTOR_AUTH_SECRET || '',
  port: parseInt(process.env.PORT || '4400', 10),
};

// The ONLY workflows this proxy will start or signal. Acts as the allowlist.
// Loaded from flows.json, which the deployed Lambda reads too — an allowlist
// that drifts between local and deployed is a security bug, so there is exactly
// one copy of it. Per-environment overrides come from WF_<KEY>[_VERSION].
const FLOWS = Object.fromEntries(
  Object.entries(require('./flows.json'))
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, f]) => {
      const env = 'WF_' + key.toUpperCase();
      return [key, {
        ...f,
        workflow: process.env[env] || f.workflow,
        version: process.env[env + '_VERSION'] || f.version,
      }];
    })
);

if (!CONFIG.serverUrl || !CONFIG.authKey || !CONFIG.authSecret) {
  console.warn('\n[!] Missing Conductor credentials. Copy .env.example to .env and fill in');
  console.warn('    CONDUCTOR_SERVER_URL / CONDUCTOR_AUTH_KEY / CONDUCTOR_AUTH_SECRET.\n');
}

// ---------------------------------------------------------------------------
// Conductor token cache + authenticated fetch (auto-refresh on 401).
// ---------------------------------------------------------------------------
let cachedToken = null;

async function getToken() {
  if (cachedToken) return cachedToken;
  const res = await fetch(`${CONFIG.serverUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId: CONFIG.authKey, keySecret: CONFIG.authSecret }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  cachedToken = (await res.json()).token;
  return cachedToken;
}

async function conductor(pathAndQuery, options = {}, retry = true) {
  const token = await getToken();
  const res = await fetch(`${CONFIG.serverUrl}${pathAndQuery}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
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
// API handlers
// ---------------------------------------------------------------------------
function flowOr404(name) {
  if (!Object.prototype.hasOwnProperty.call(FLOWS, name)) throw new Error(`Unknown flow: ${name}`);
  return FLOWS[name];
}

// Scenario presets are read from the sample_*.json files in the repo root, so
// the console and the CLI demo always run byte-identical inputs.
const REPO_DIR = path.join(__dirname, '..');

function listSamples(flowName) {
  const flow = flowOr404(flowName);
  return flow.samples
    .map(([file, label]) => {
      try {
        return {
          id: file.replace(/\.json$/, ''),
          label,
          input: JSON.parse(fs.readFileSync(path.join(REPO_DIR, file), 'utf8')),
        };
      } catch (_) { return null; }
    })
    .filter(Boolean);
}

async function startFlow(flowName, input) {
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

function openGate(flow, wf) {
  if (!Array.isArray(wf.tasks)) return null;
  for (const t of wf.tasks) {
    if (!Object.prototype.hasOwnProperty.call(flow.gates, t.referenceTaskName)) continue;
    if (t.status === 'IN_PROGRESS' || t.status === 'SCHEDULED') return t;
  }
  return null;
}

function gateContract(flow, ref) {
  const g = flow.gates[ref];
  return {
    ref, label: g.label, enums: g.enums || {},
    strings: g.strings || [], numbers: g.numbers || [], dates: g.dates || [],
    defaults: g.defaults || {},
  };
}

async function getFlow(flowName, id) {
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
    gatePacket: gateTask ? (gateTask.inputData || {}) : null,
    tasks: (wf.tasks || []).map((t) => ({
      ref: t.referenceTaskName, type: t.taskType, status: t.status,
      subWorkflowId: t.subWorkflowId || null,
    })),
    reasonForIncompletion: wf.reasonForIncompletion || null,
    output: wf.output || {},
  };
}

async function signalFlow(flowName, id, ref, body) {
  const flow = flowOr404(flowName);
  if (!Object.prototype.hasOwnProperty.call(flow.gates, ref)) {
    throw new Error(`Unknown gate "${ref}" for ${flowName}`);
  }
  const g = flow.gates[ref];
  const payload = {};
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
  const items = [];
  for (const [flowName, flow] of Object.entries(FLOWS)) {
    if (Object.keys(flow.gates).length === 0) continue;
    let ids = [];
    try {
      const res = await conductor(
        `/workflow/running/${encodeURIComponent(flow.workflow)}?version=${encodeURIComponent(flow.version)}`
      );
      if (res.ok) ids = await res.json();
    } catch (_) { ids = []; }
    if (!Array.isArray(ids)) ids = [];
    for (const id of ids.slice(0, QUEUE_SCAN_LIMIT)) {
      try {
        const wf = await getFlow(flowName, id);
        if (!wf.awaitingGate) continue;
        const p = wf.gatePacket || {};
        items.push({
          flow: flowName,
          flowLabel: flow.label,
          workflowId: id,
          gate: wf.gate,
          subject: p.reportCode ? `${p.reportCode} · ${p.period || ''}`.trim() : (p.caseId || '—'),
          reference: p.reportId || p.caseId || '—',
          severity: p.worstSeverity || p.complianceStatus || p.validationStatus || '—',
          reason: p.routeReason || p.instruction || p.breachSummary || '',
          deadline: p.notificationDeadline || p.actionPlanDeadline || null,
          daysToDeadline: p.daysToDeadline != null ? p.daysToDeadline : null,
        });
      } catch (_) { /* skip anything we can't read */ }
    }
  }
  return { items, scannedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Tiny HTTP server: static files + /api routes
// ---------------------------------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const NAMES = Object.keys(FLOWS).join('|');
const RE_SAMPLES = new RegExp(`^/api/(${NAMES})/samples$`);
const RE_START = new RegExp(`^/api/(${NAMES})$`);
const RE_SIGNAL = new RegExp(`^/api/(${NAMES})/([^/]+)/signal/([^/]+)$`);
const RE_STATUS = new RegExp(`^/api/(${NAMES})/([^/]+)$`);

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/api/flows' && req.method === 'GET') {
      return sendJson(res, 200, Object.fromEntries(
        Object.entries(FLOWS).map(([k, f]) => [k, {
          workflow: f.workflow, version: f.version, label: f.label,
          gates: Object.fromEntries(Object.keys(f.gates).map((r) => [r, gateContract(f, r)])),
        }])
      ));
    }
    if (url === '/api/queue' && req.method === 'GET') return sendJson(res, 200, await getQueue());
    let m;
    if ((m = url.match(RE_SAMPLES)) && req.method === 'GET') {
      return sendJson(res, 200, { samples: listSamples(m[1]) });
    }
    if ((m = url.match(RE_SIGNAL)) && req.method === 'POST') {
      return sendJson(res, 200, await signalFlow(m[1], m[2], m[3], await readBody(req)));
    }
    if ((m = url.match(RE_START)) && req.method === 'POST') {
      return sendJson(res, 200, await startFlow(m[1], await readBody(req)));
    }
    if ((m = url.match(RE_STATUS)) && req.method === 'GET') {
      return sendJson(res, 200, await getFlow(m[1], m[2]));
    }
    if (url.startsWith('/api/')) return sendJson(res, 404, { error: 'Unknown endpoint' });
    return serveStatic(req, res);
  } catch (err) {
    console.error('[api error]', err.message);
    return sendJson(res, 502, { error: err.message });
  }
});

server.listen(CONFIG.port, () => {
  console.log(`\nKonsol Pelaporan Regulator  ->  http://localhost:${CONFIG.port}`);
  console.log(`Proxying to Conductor: ${CONFIG.serverUrl || '(not configured)'}`);
  console.log(`Credentials: key ${CONFIG.authKey ? 'loaded' : 'MISSING'}, secret ${CONFIG.authSecret ? 'loaded' : 'MISSING'} (server-side only)`);
  for (const [k, f] of Object.entries(FLOWS)) {
    const gates = Object.keys(f.gates);
    console.log(`  ${k.padEnd(12)} -> ${f.workflow} v${f.version}  (gates: ${gates.length ? gates.join(', ') : 'none'})`);
  }
  console.log('');
});
