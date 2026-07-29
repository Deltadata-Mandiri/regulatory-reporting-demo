/*
 * Konsol Pelaporan Regulator — front-end.
 *
 * Talks only to the local proxy (/api/*). It never sees Conductor credentials.
 * Scenario presets are fetched from the proxy, which reads the same
 * sample_*.json files the CLI demo uses, so the console cannot drift from them.
 */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const rupiah = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)))
  ? '—' : 'Rp ' + Math.round(Number(v)).toLocaleString('id-ID');

// Balance-sheet figures run to trillions; spell them short so a tile stays a tile.
function idrCompact(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !isFinite(n)) return '—';
  const a = Math.abs(n), sign = n < 0 ? '−' : '';
  const fmt = (x) => x.toLocaleString('id-ID', { maximumFractionDigits: 2 });
  if (a >= 1e12) return `${sign}Rp ${fmt(a / 1e12)} T`;
  if (a >= 1e9) return `${sign}Rp ${fmt(a / 1e9)} M`;
  return rupiah(n);
}

const pct = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)))
  ? '—' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + '%';

// Fields surfaced as editable inputs per flow. Everything else in the preset
// payload (largeExposures, the form lists, the buffer settings) is sent through
// untouched. Hints name the check or ratio each field moves, so the console
// doubles as a way to prove a rule fires.
const FORM_FIELDS = {
  submission: [
    { section: 'Laporan' },
    { k: 'reportCode', label: 'Kode Laporan', type: 'select', opts: ['LBU', 'LHBU', 'LCR', 'NSFR', 'KPMM', 'BMPK'] },
    { k: 'period', label: 'Periode Data', type: 'text', hint: 'YYYY-MM' },
    { k: 'asOfDate', label: 'Tanggal Proses', type: 'text', hint: 'dipatok agar hasil deterministik' },
    { k: 'submissionDeadline', label: 'Batas Waktu', type: 'text', hint: 'lewat = W02, terlambat tetap dikirim' },
    { k: 'recordCount', label: 'Jumlah Baris', type: 'number', hint: '0 = E02 blocking' },
    { k: 'resubmissionCount', label: 'Jumlah Koreksi', type: 'number', hint: '>=2 = W04' },

    { section: 'Edit-check' },
    { k: 'reportTotalAssets', label: 'Total Aset (laporan)', type: 'number' },
    { k: 'glTotalAssets', label: 'Total Aset (buku besar)', type: 'number', hint: 'beda = E03 blocking' },
    { k: 'reportTotalLiabilities', label: 'Total Kewajiban', type: 'number' },
    { k: 'reportTotalEquity', label: 'Total Ekuitas', type: 'number', hint: 'aset ≠ kewajiban+ekuitas = E04' },
    { k: 'priorPeriodTotalAssets', label: 'Total Aset Periode Lalu', type: 'number', hint: 'deviasi >15% = W01' },
    { k: 'invalidCodeCount', label: 'Sandi Tidak Valid', type: 'number', hint: '>0 = E06 blocking' },

    { section: 'Permodalan, kualitas aktiva & likuiditas' },
    { k: 'cet1Capital', label: 'Modal CET1', type: 'number', hint: 'turunkan → KPMM di bawah minimum' },
    { k: 'tier2Capital', label: 'Modal Tier 2', type: 'number' },
    { k: 'rwaCredit', label: 'ATMR Kredit', type: 'number' },
    { k: 'totalLoans', label: 'Total Kredit', type: 'number' },
    { k: 'kol5Balance', label: 'Baki Debet Kol 5', type: 'number', hint: 'naikkan → NPL' },
    { k: 'lossAllowance', label: 'CKPN', type: 'number', hint: 'turunkan → NPL net' },
    { k: 'hqla', label: 'HQLA', type: 'number', hint: 'turunkan → LCR < 100%' },
    { k: 'netCashOutflow30d', label: 'Arus Kas Keluar 30h', type: 'number' },
  ],
  remediation: [
    { section: 'Kasus' },
    { k: 'caseId', label: 'Nomor Kasus', type: 'text' },
    { k: 'triggerSource', label: 'Pemicu', type: 'select', opts: ['STANDALONE_REVIEW', 'PERIODIC_SUBMISSION', 'SUPERVISORY_REQUEST'] },
    { k: 'period', label: 'Periode Data', type: 'text', hint: 'YYYY-MM' },
    { k: 'asOfDate', label: 'Tanggal Proses', type: 'text', hint: 'dasar perhitungan semua tenggat' },

    { section: 'Angka sumber (dihitung ulang)' },
    { k: 'riskProfile', label: 'Profil Risiko', type: 'number', hint: '1–5 → minimum KPMM 8–11%' },
    { k: 'kbmi', label: 'KBMI', type: 'number', hint: '>=3 → buffer konservasi 2,5%' },
    { k: 'cet1Capital', label: 'Modal CET1', type: 'number' },
    { k: 'tier2Capital', label: 'Modal Tier 2', type: 'number' },
    { k: 'rwaCredit', label: 'ATMR Kredit', type: 'number' },
    { k: 'kol5Balance', label: 'Baki Debet Kol 5', type: 'number' },
    { k: 'lossAllowance', label: 'CKPN', type: 'number' },
    { k: 'hqla', label: 'HQLA', type: 'number' },
  ],
};

const FLOW_KEYS = ['submission', 'remediation'];

const state = {
  flows: {},
  presets: { submission: [], remediation: [] },
  payload: { submission: null, remediation: null },
  wfid: { submission: null, remediation: null },
  poll: { submission: null, remediation: null },
};

// API base. Empty string = same-origin (local `node server.js`).
let API_BASE = '';

async function loadConfig() {
  try {
    const res = await fetch('./amplify_outputs.json', { cache: 'no-store' });
    if (!res.ok) return;
    const cfg = await res.json();
    const base = cfg && cfg.custom && cfg.custom.apiBase ? String(cfg.custom.apiBase) : '';
    API_BASE = base.replace(/\/+$/, '');
  } catch (_) { /* no config file — assume same-origin */ }
}

async function api(path, options) {
  const res = await fetch(API_BASE + path, options);
  const json = await res.json().catch(() => ({ error: 'Respons tidak dapat dibaca' }));
  if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
  return json;
}

/* ------------------------------------------------------------------ tabs */
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.remove('active'));
  $$('.panel').forEach((x) => x.classList.remove('active'));
  t.classList.add('active');
  $(`.panel[data-panel="${t.dataset.tab}"]`).classList.add('active');
  if (t.dataset.tab === 'queue') loadQueue();
}));

/* --------------------------------------------------------------- presets */
function renderPresets(flow) {
  const row = $(`.preset-row[data-presets="${flow}"]`);
  row.innerHTML = '';
  state.presets[flow].forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'preset' + (i === 0 ? ' active' : '');
    b.textContent = p.label;
    b.addEventListener('click', () => {
      $$('.preset', row).forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.payload[flow] = JSON.parse(JSON.stringify(p.input));
      renderForm(flow);
      renderRaw(flow);
    });
    row.appendChild(b);
  });
  if (state.presets[flow][0]) {
    state.payload[flow] = JSON.parse(JSON.stringify(state.presets[flow][0].input));
    renderForm(flow);
    renderRaw(flow);
  }
}

function renderForm(flow) {
  const host = $(`.form[data-form="${flow}"]`);
  const payload = state.payload[flow] || {};
  host.innerHTML = '';
  for (const f of FORM_FIELDS[flow]) {
    if (f.section) {
      const s = document.createElement('div');
      s.className = 'form-sub';
      s.textContent = f.section;
      host.appendChild(s);
      continue;
    }
    const wrap = document.createElement('div');
    wrap.className = 'field' + (f.wide ? ' wide' : '');
    const val = payload[f.k] === undefined || payload[f.k] === null ? '' : payload[f.k];
    let control;
    if (f.type === 'select') {
      control = document.createElement('select');
      for (const o of f.opts) {
        const opt = document.createElement('option');
        opt.value = o; opt.textContent = o === '' ? '(kosong)' : o;
        if (String(val) === o) opt.selected = true;
        control.appendChild(opt);
      }
    } else if (f.type === 'textarea') {
      control = document.createElement('textarea');
      control.rows = 2; control.value = val;
    } else {
      control = document.createElement('input');
      control.type = f.type === 'number' ? 'number' : 'text';
      control.value = val;
    }
    control.addEventListener('input', () => {
      const raw = control.value;
      state.payload[flow][f.k] = (f.type === 'number' && raw !== '') ? Number(raw) : raw;
      renderRaw(flow);
    });
    const lbl = document.createElement('span');
    lbl.className = 'lbl'; lbl.textContent = f.label;
    wrap.appendChild(lbl);
    wrap.appendChild(control);
    if (f.hint) {
      const h = document.createElement('span');
      h.className = 'hint'; h.textContent = f.hint;
      wrap.appendChild(h);
    }
    host.appendChild(wrap);
  }
}

function renderRaw(flow) {
  $(`[data-rawview="${flow}"]`).textContent = JSON.stringify(state.payload[flow], null, 2);
}

$$('[data-raw]').forEach((b) => b.addEventListener('click', () => {
  $(`[data-rawview="${b.dataset.raw}"]`).classList.toggle('hidden');
}));

/* ------------------------------------------------------------------- run */
$$('[data-run]').forEach((b) => b.addEventListener('click', async () => {
  const flow = b.dataset.run;
  b.disabled = true; b.textContent = 'Menjalankan…';
  try {
    const { workflowId } = await api('/api/' + flow, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.payload[flow]),
    });
    state.wfid[flow] = workflowId;
    $(`[data-wfid="${flow}"]`).textContent = workflowId;
    $(`[data-result="${flow}"]`).innerHTML = '';
    startPolling(flow);
  } catch (e) {
    $(`[data-result="${flow}"]`).innerHTML =
      `<div class="result-head bad"><strong>Gagal menjalankan</strong> ${esc(e.message)}</div>`;
  } finally {
    b.disabled = false; b.textContent = 'Jalankan';
  }
}));

function startPolling(flow) {
  clearInterval(state.poll[flow]);
  const tick = async () => {
    try {
      const wf = await api(`/api/${flow}/${state.wfid[flow]}`);
      renderTrace(flow, wf);
      renderResult(flow, wf);
      if (wf.status !== 'RUNNING' && wf.status !== 'PAUSED') clearInterval(state.poll[flow]);
      if (wf.awaitingGate) clearInterval(state.poll[flow]); // waiting on a human
    } catch (_) { clearInterval(state.poll[flow]); }
  };
  tick();
  state.poll[flow] = setInterval(tick, 1500);
}

function renderTrace(flow, wf) {
  const host = $(`.trace[data-trace="${flow}"]`);
  if (!wf.tasks.length) { host.innerHTML = '<p class="muted">Belum ada task.</p>'; return; }
  host.innerHTML = wf.tasks.map((t) => `
    <div class="trace-row ${t.status === 'IN_PROGRESS' ? 'waiting' : ''}">
      <span class="st ${esc(t.status)}">${esc(t.status)}</span>
      <span class="tname">${esc(t.ref)}</span>
      <span class="ttype">${esc(t.type)}</span>
    </div>`).join('');
}

/* --------------------------------------------------------------- results */
function kv(pairs) {
  const rows = pairs.filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('');
  return rows ? `<dl class="kv">${rows}</dl>` : '';
}

function list(title, items, cls) {
  if (!Array.isArray(items) || !items.length) return '';
  return `<div class="note ${cls || ''}"><strong>${esc(title)}</strong>
    <ul class="list">${items.map((x) => `<li>${esc(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('')}</ul></div>`;
}

/* Ratio stat tile + bullet meter.
   Severity is carried by three channels at once — the fill colour, a glyph and
   a word — because green and amber are only ΔE 4.8 apart under protanopia, so
   hue alone would not distinguish "dalam ketentuan" from "perlu perhatian". */
const STATUS_GLYPH = { ok: '✓', warn: '!', bad: '✕' };

function ratioTile(t) {
  const v = Number(t.value);
  if (t.value === null || t.value === undefined || !isFinite(v)) return '';
  let status, limitText, marks = [], scaleMax;

  if (t.dir === 'band') {
    status = (v < t.low || v > t.high) ? 'bad' : 'ok';
    limitText = `target ${t.low}–${t.high}%`;
    scaleMax = Math.max(v, t.high) * 1.2;
    marks = [t.low, t.high];
  } else if (t.dir === 'max') {
    status = v > t.limit ? 'bad' : (v > t.limit * 0.9 ? 'warn' : 'ok');
    limitText = `maks ${t.limit}%`;
    scaleMax = Math.max(v, t.limit) * 1.35;
    marks = [t.limit];
  } else { // 'min' — optional hardMin makes a buffer shortfall amber, not red
    const hard = t.hardMin != null ? t.hardMin : t.limit;
    status = v < hard ? 'bad' : (v < t.limit ? 'warn' : 'ok');
    limitText = t.hardMin != null ? `min ${hard}% · wajib ${t.limit}%` : `min ${t.limit}%`;
    scaleMax = Math.max(v, t.limit) * 1.35;
    marks = t.hardMin != null && t.hardMin !== t.limit ? [t.hardMin, t.limit] : [t.limit];
  }

  const statusText = t.statusText && t.statusText[status]
    ? t.statusText[status]
    : { ok: 'Dalam ketentuan', warn: 'Perlu perhatian', bad: 'Pelampauan' }[status];
  const fillPct = Math.max(2, Math.min(100, (v / scaleMax) * 100));
  const markHtml = marks
    .filter((m) => isFinite(m) && m > 0 && m < scaleMax)
    .map((m) => `<span class="ratio-mark" style="left:${((m / scaleMax) * 100).toFixed(2)}%"></span>`)
    .join('');

  return `<div class="ratio">
    <div class="ratio-top">
      <span class="ratio-label">${esc(t.label)}</span>
    </div>
    <div class="ratio-value">${esc(Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 }))}<span class="ratio-unit">%</span></div>
    <div class="ratio-meter ${status}">
      <span class="ratio-fill ${status}" style="width:${fillPct.toFixed(2)}%"></span>
      ${markHtml}
    </div>
    <div class="ratio-foot">
      <span class="ratio-status ${status}">${STATUS_GLYPH[status]} ${esc(statusText)}</span>
      <span class="ratio-limit">${esc(limitText)}</span>
    </div>
  </div>`;
}

function ratioStrip(o) {
  const tiles = [
    ratioTile({ label: 'KPMM (CAR)', value: o.car, dir: 'min', limit: o.requiredCar, hardMin: o.minCarByProfile,
                statusText: { warn: 'Buffer kurang' } }),
    ratioTile({ label: 'NPL gross', value: o.nplGross, dir: 'max', limit: 5 }),
    ratioTile({ label: 'NPL net', value: o.nplNet, dir: 'max', limit: 5 }),
    ratioTile({ label: 'LCR', value: o.lcr, dir: 'min', limit: 100 }),
    ratioTile({ label: 'NSFR', value: o.nsfr, dir: 'min', limit: 100 }),
    ratioTile({ label: 'RIM', value: o.rim, dir: 'band', low: 84, high: 94,
                statusText: { bad: 'Di luar target' } }),
  ].join('');
  return tiles ? `<div class="section-label">Rasio prudensial</div><div class="ratios">${tiles}</div>` : '';
}

/* Findings state their kind in words — the colour is reinforcement, not the message. */
function findings(items, kind) {
  if (!Array.isArray(items) || !items.length) return '';
  const cls = kind === 'error' ? 'bad' : 'warn';
  const word = kind === 'error' ? 'KESALAHAN' : 'PERINGATAN';
  return items.map((f) => `
    <div class="finding ${cls}">
      <span class="finding-kind">${word}</span>
      <span class="finding-code">${esc(f.code || '')}</span>
      <span class="finding-detail">${esc(f.detail || '')}</span>
      ${f.rule ? `<span class="finding-reg">${esc(f.rule)}</span>` : ''}
    </div>`).join('');
}

function breachRows(items) {
  if (!Array.isArray(items) || !items.length) return '';
  return items.map((b) => `
    <div class="finding bad">
      <span class="finding-kind">${esc(b.severity || '')}</span>
      <span class="finding-code">${esc(b.code || '')}</span>
      <span class="finding-detail">${esc(b.metric || '')} — ${esc(b.actual)} vs batas ${esc(b.limit)}</span>
      ${b.regulation ? `<span class="finding-reg">${esc(b.regulation)}${b.note ? ' · ' + esc(b.note) : ''}</span>` : ''}
    </div>`).join('');
}

function memoBlock(md, pdf, label) {
  if (!md) return '';
  return `<details class="memo"><summary>${esc(label)}${pdf ? ' (+ PDF)' : ''}</summary>
    <div class="memo-body">${esc(md)}</div>
    ${pdf ? `<div class="muted" style="margin-top:8px">PDF: <a href="${esc(pdf)}" target="_blank" rel="noopener">${esc(pdf)}</a></div>` : ''}
  </details>`;
}

const TONE = {
  APPROVED_FOR_TRANSMISSION: 'ok',
  APPROVED_WITH_EXPLANATION: 'ok',
  APPROVED_WITH_BREACH_DISCLOSURE: 'warn',
  RETURNED_TO_PREPARER: 'bad',
  REQUEST_INVALID: 'bad',
  ACTION_PLAN_APPROVED_BY_BOARD: 'warn',
  ACTION_PLAN_APPROVED_BY_COMMITTEE: 'warn',
  UNDER_MONITORING: 'ok',
};

function renderResult(flow, wf) {
  const host = $(`[data-result="${flow}"]`);
  const o = wf.output || {};

  if (wf.awaitingGate) { host.innerHTML = renderGate(flow, wf); wireGate(flow, wf); return; }
  if (wf.status === 'RUNNING') { host.innerHTML = '<p class="muted">Berjalan…</p>'; return; }

  if (flow === 'submission') return renderSubmission(host, wf, o);
  return renderRemediation(host, wf, o);
}

function renderSubmission(host, wf, o) {
  const status = o.submissionStatus || wf.status;
  const tone = TONE[status] || (wf.status === 'FAILED' ? 'bad' : 'info');
  const tx = o.transmission || {};

  let body = `<div class="result-head ${tone}">
    <strong>${esc(status)}</strong>
    <span class="pill info">jalur ${esc(o.routeTaken || '—')}</span>
    ${o.complianceStatus ? `<span class="pill ${o.complianceStatus === 'COMPLIANT' ? 'ok' : (o.complianceStatus === 'WATCH' ? 'warn' : 'bad')}">${esc(o.complianceStatus)}</span>` : ''}
    ${tx.transmitted ? '' : '<span class="pill bad">TIDAK DIKIRIM</span>'}
  </div>`;

  body += kv([
    ['Laporan', `${esc(o.reportName || o.reportCode || '')} · ${esc(o.period || '')}`],
    ['Bank', esc(o.bankName || '')],
    ['Alasan jalur', esc(o.routeReason || '')],
    ['Edit-check', o.validationStatus
      ? `${esc(o.validationStatus)} · skor ${esc(o.validationScore)}` : null],
    ['Batas waktu', o.daysToDeadline != null
      ? (o.lateSubmission ? `terlambat ${Math.abs(o.daysToDeadline)} hari` : `sisa ${o.daysToDeadline} hari`) : null],
    ['Keputusan', o.reviewDecision ? `${esc(o.reviewDecision)} oleh ${esc(o.reviewedBy || '')}` : null],
    ['Catatan reviewer', esc(o.reviewNote || '')],
    ['Surplus modal', o.capitalSurplusIDR != null ? idrCompact(o.capitalSurplusIDR) : null],
    ['Tanda terima', tx.receiptNumber
      ? `<span class="receipt">${esc(tx.receiptNumber)}</span> · ${esc(tx.channel || '')}` : null],
    ['Status transmisi', esc(tx.transmissionStatus || '')],
    ['Remediasi', o.remediationStatus && o.remediationStatus !== 'NOT_REQUIRED' ? esc(o.remediationStatus) : null],
  ]);

  body += ratioStrip(o);

  if (Array.isArray(o.blockingErrors) && o.blockingErrors.length) {
    body += `<div class="section-label">Kesalahan blocking — laporan tidak dikirim</div>`;
    body += findings(o.blockingErrors, 'error');
  }
  if (Array.isArray(o.validationWarnings) && o.validationWarnings.length) {
    body += `<div class="section-label">Peringatan edit-check</div>`;
    body += findings(o.validationWarnings, 'warning');
  }
  if (Array.isArray(o.breaches) && o.breaches.length) {
    body += `<div class="section-label">Pelampauan rasio</div>`;
    body += breachRows(o.breaches);
  }

  if (tx.transmitted && Array.isArray(o.breaches) && o.breaches.length) {
    body += `<div class="note warn"><strong>Laporan tetap disampaikan meski terdapat pelampauan.</strong>
      Menahan laporan karena rasionya buruk akan menyembunyikan pelampauan dari otoritas — pelanggaran yang
      jauh lebih berat daripada pelampauannya sendiri. Yang menahan laporan hanyalah kegagalan edit-check.</div>`;
  }
  if (!tx.transmitted && status === 'RETURNED_TO_PREPARER') {
    body += `<div class="note bad"><strong>Berkas dikembalikan kepada penyusun.</strong>
      ${esc(tx.reason || 'Laporan tidak memenuhi edit-check wajib.')}</div>`;
  }
  if (tx.sanctionRisk) {
    body += `<div class="note warn"><strong>Berpotensi sanksi administratif.</strong>
      Laporan disampaikan melewati batas waktu. Keterlambatan tidak membatalkan kewajiban penyampaian.</div>`;
  }

  body += memoBlock(o.transmittalMemoMarkdown, o.transmittalMemoPdf, 'Nota dinas yang dihasilkan LLM');
  host.innerHTML = body;
}

function renderRemediation(host, wf, o) {
  const status = o.remediationStatus || wf.status;
  const tone = TONE[status] || (wf.status === 'FAILED' ? 'bad' : 'info');

  let body = `<div class="result-head ${tone}">
    <strong>${esc(status)}</strong>
    ${o.handlingTier ? `<span class="pill info">tingkat ${esc(o.handlingTier)}</span>` : ''}
    ${o.worstSeverity && o.worstSeverity !== 'NONE' ? `<span class="pill bad">${esc(o.worstSeverity)}</span>` : ''}
    ${o.mandatoryNotification ? '<span class="pill bad">WAJIB LAPOR OTORITAS</span>' : ''}
  </div>`;

  body += kv([
    ['Kasus', `${esc(o.caseId || '')} · ${esc(o.triggerSource || '')}`],
    ['Bank', `${esc(o.bankName || '')} · periode ${esc(o.period || '')}`],
    ['Status kepatuhan', esc(o.complianceStatus || '')],
    ['Jumlah pelampauan', o.breachCount != null ? String(o.breachCount) : null],
    ['Batas lapor otoritas', esc(o.notificationDeadline || '')],
    ['Batas rencana tindak', esc(o.actionPlanDeadline || '')],
    ['Target pemulihan', esc(o.targetCureDate || '')],
    ['Disetujui', o.approvedBy ? esc(o.approvedBy) : null],
    ['Catatan', esc(o.approvalNote || '')],
  ]);

  if (Array.isArray(o.breaches) && o.breaches.length) {
    body += `<div class="section-label">Pelampauan rasio</div>`;
    body += breachRows(o.breaches);
  }
  body += list('Langkah perbaikan yang ditetapkan', o.remedialActions);
  body += list('Ketentuan yang dilampaui', o.regulations, 'warn');
  body += memoBlock(o.actionPlanMarkdown, o.actionPlanPdf, 'Rencana tindak yang dihasilkan LLM');
  host.innerHTML = body;
}

/* ------------------------------------------------------------------ gate */
function renderGate(flow, wf) {
  const g = wf.gate;
  const p = wf.gatePacket || {};

  const fields = Object.entries(g.enums || {}).map(([name, opts]) => `
    <div class="field">
      <span class="lbl">${esc(name)}</span>
      <select data-gf="${esc(name)}">${opts.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>
    </div>`).join('')
    + (g.numbers || []).map((n) => `
    <div class="field"><span class="lbl">${esc(n)}</span><input type="number" data-gf="${esc(n)}" value="0" /></div>`).join('')
    + (g.dates || []).map((d) => `
    <div class="field"><span class="lbl">${esc(d)}</span><input type="text" data-gf="${esc(d)}" placeholder="YYYY-MM-DD" /></div>`).join('')
    + (g.strings || []).map((s) => s === 'note'
      ? `<div class="field wide"><span class="lbl">note</span><textarea rows="2" data-gf="note"></textarea></div>`
      : `<div class="field"><span class="lbl">${esc(s)}</span><input type="text" data-gf="${esc(s)}" value="${esc((g.defaults || {})[s] || '')}" /></div>`
    ).join('');

  const ctx = kv([
    ['Laporan', p.reportCode ? `${esc(p.reportCode)} · ${esc(p.period || '')}` : null],
    ['Nomor', esc(p.reportId || p.caseId || '')],
    ['Disusun oleh', esc(p.preparedBy || '')],
    ['Alasan', esc(p.routeReason || '')],
    ['Edit-check', esc(p.validationStatus || '')],
    ['Status kepatuhan', esc(p.complianceStatus || '')],
    ['Keparahan', esc(p.worstSeverity || '')],
    ['Penanggung jawab', esc(p.owner || '')],
    ['Sisa hari batas waktu', p.daysToDeadline != null ? String(p.daysToDeadline) : null],
    ['Batas lapor otoritas', esc(p.notificationDeadline || '')],
    ['Batas rencana tindak', esc(p.actionPlanDeadline || '')],
    ['Status remediasi', esc(p.remediationStatus || '')],
  ]);

  return `<div class="gate">
    <h3>${esc(g.label)}</h3>
    <div class="gate-sub">Menunggu keputusan pada <code>${esc(g.ref)}</code></div>
    ${ctx}
    ${p.instruction ? `<div class="note">${esc(p.instruction)}</div>` : ''}
    ${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}
    ${p.warningsText && p.warningsText !== 'Tidak ada' ? `<div class="note warn"><strong>Peringatan edit-check</strong><br>${esc(p.warningsText)}</div>` : ''}
    ${p.watchSummary && p.watchSummary !== 'Tidak ada' ? `<div class="note warn"><strong>Rasio mendekati ambang</strong><br>${esc(p.watchSummary)}</div>` : ''}
    ${p.breachSummary && p.breachSummary !== 'Tidak ada pelampauan' ? `<div class="note bad"><strong>Pelampauan</strong><br>${esc(p.breachSummary)}</div>` : ''}
    <div class="form" style="margin-top:10px">${fields}</div>
    <div class="form-actions"><button class="btn primary" data-gate-submit>Kirim Keputusan</button></div>
    <div data-gate-err></div>
  </div>`;
}

function wireGate(flow, wf) {
  const host = $(`[data-result="${flow}"]`);
  const btn = $('[data-gate-submit]', host);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const body = {};
    $$('[data-gf]', host).forEach((el) => { body[el.dataset.gf] = el.value; });
    btn.disabled = true; btn.textContent = 'Mengirim…';
    try {
      await api(`/api/${flow}/${wf.workflowId}/signal/${wf.gate.ref}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      startPolling(flow);
    } catch (e) {
      $('[data-gate-err]', host).innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
      btn.disabled = false; btn.textContent = 'Kirim Keputusan';
    }
  });
}

/* ----------------------------------------------------------------- queue */
async function loadQueue() {
  const host = $('#queueList');
  host.innerHTML = '<p class="muted">Memuat…</p>';
  try {
    const { items } = await api('/api/queue');
    $('#queueCount').textContent = items.length;
    $('#queueCount').classList.toggle('zero', items.length === 0);
    if (!items.length) { host.innerHTML = '<p class="muted">Tidak ada pekerjaan yang menunggu keputusan.</p>'; return; }
    host.innerHTML = items.map((it) => `
      <div class="q-item">
        <div class="q-head">
          <strong>${esc(it.subject)}</strong>
          <span class="pill info">${esc(it.flowLabel)}</span>
          <span class="pill info">${esc(it.gate.label)}</span>
          ${it.severity && it.severity !== '—' ? `<span class="pill bad">${esc(it.severity)}</span>` : ''}
        </div>
        <div class="q-meta">
          <span>${esc(it.reference)}</span>
          ${it.daysToDeadline != null ? `<span>sisa ${esc(it.daysToDeadline)} hari</span>` : ''}
          ${it.deadline ? `<span>tenggat ${esc(it.deadline)}</span>` : ''}
          <span>${esc(it.workflowId)}</span>
        </div>
        ${it.reason ? `<div class="q-reason">${esc(it.reason)}</div>` : ''}
        <div class="q-actions">
          <button class="btn ghost small" data-open="${esc(it.flow)}|${esc(it.workflowId)}">Buka di tab ${esc(it.flowLabel)}</button>
        </div>
      </div>`).join('');
    $$('[data-open]', host).forEach((b) => b.addEventListener('click', () => {
      const [flow, id] = b.dataset.open.split('|');
      openExecution(flow, id, true);
    }));
  } catch (e) {
    host.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
  }
}
$('#queueRefresh').addEventListener('click', loadQueue);

/* Deep link: ?flow=submission&wf=<id> opens an existing execution. The queue's
   open button uses the same path, so a case can be handed over by URL. */
function openExecution(flow, id, push) {
  if (!state.flows[flow]) return;
  state.wfid[flow] = id;
  $(`[data-wfid="${flow}"]`).textContent = id;
  $(`.tab[data-tab="${flow}"]`).click();
  if (push) history.replaceState(null, '', `?flow=${encodeURIComponent(flow)}&wf=${encodeURIComponent(id)}`);
  startPolling(flow);
}

/* ------------------------------------------------------------------ boot */
(async () => {
  try {
    await loadConfig();
    state.flows = await api('/api/flows');
    for (const [k, f] of Object.entries(state.flows)) {
      const tag = $(`.wf-tag[data-wf="${k}"]`);
      if (tag) tag.textContent = `${f.workflow} v${f.version}`;
    }
    for (const flow of FLOW_KEYS) {
      const { samples } = await api(`/api/${flow}/samples`);
      state.presets[flow] = samples;
      renderPresets(flow);
    }
    const q = new URLSearchParams(location.search);
    if (q.get('flow') && q.get('wf')) openExecution(q.get('flow'), q.get('wf'), false);
    loadQueue();
  } catch (e) {
    document.body.insertAdjacentHTML('afterbegin',
      `<div class="note bad" style="margin:16px 28px">Gagal memuat konsol: ${esc(e.message)}</div>`);
  }
})();
