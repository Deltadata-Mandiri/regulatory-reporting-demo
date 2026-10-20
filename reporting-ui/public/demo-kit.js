/*
 * BDN demo kit — sign-in with sample users, shared header, role gates,
 * activity drawer and Orkes execution links for every template demo.
 *
 * Load order, in <head>:
 *   <link rel="stylesheet" href="demo-kit.css">
 *   <script src="demo-config.js"></script>   // window.DEMO_CONFIG, per demo
 *   <script src="demo-kit.js"></script>      // this file — exposes window.DemoKit
 *
 * Source of truth is template-usecase/_kit/; each demo carries a synced copy
 * (_kit/sync.sh) because each one deploys as its own Amplify app.
 *
 * This is a *simulation* boundary, as in the Unified AI Platform: the consoles'
 * proxies are unauthenticated, so the sign-in decides which persona the console
 * acts as — whose name goes into reviewedBy/approvedBy, which approval panels
 * unlock, which runs are "mine" — not who may reach the API. The Conductor
 * workflows themselves are live.
 */
(function () {
  'use strict';

  var CFG = window.DEMO_CONFIG || {};
  var KEY = 'bdnkit.' + (CFG.key || 'demo');
  var UI = String(CFG.conductorUi || 'https://partner-deltadata.orkesconductor.io').replace(/\/+$/, '');
  var LANG = CFG.lang === 'en' ? 'en' : 'id';
  var PERSONAS = CFG.personas || [];
  var ROLES = CFG.roles || {};

  var T = {
    id: {
      signInTitle: 'Masuk ke konsol',
      signInLead: 'Akun Anda menentukan peran Anda di alur kerja: siapa yang mengajukan, siapa yang memutuskan, dan nama siapa yang tercatat di jejak audit Orkes.',
      signIn: 'Masuk', signingIn: 'Memeriksa…', username: 'Nama pengguna', password: 'Kata sandi',
      demoAccounts: 'Akun demo — klik untuk mengisi kedua kolom',
      badLogin: 'Nama pengguna atau kata sandi salah.',
      demoNote: 'Simulasi demo: kata sandi semua akun adalah',
      flows: 'Workflow Orkes yang dijalankan:',
      signOut: 'Keluar', activity: 'Aktivitas', orkes: 'Orkes Conductor',
      drawerTitle: 'Eksekusi Workflow', mine: 'Milik saya', all: 'Semua pengguna',
      allInOrkes: 'Semua eksekusi di Orkes ↗', open: 'Buka', openOrkes: 'Lihat di Orkes',
      none: 'Belum ada eksekusi. Jalankan salah satu alur — setiap eksekusi tercatat di sini dengan tautan ke Orkes.',
      by: 'oleh', execution: 'Eksekusi Orkes', startedBy: 'dimulai oleh',
      lockedRole: function (a, r) { return a + ' hanya dapat dilakukan oleh ' + r + '.'; },
      lockedAs: function (n, t) { return 'Anda masuk sebagai ' + n + ' (' + t + '). Ganti pengguna untuk melanjutkan:'; },
      lockedMaker: function (a) { return a + ' — prinsip four-eyes (maker–checker).'; },
      lockedMakerBody: 'Anda sendiri yang memulai eksekusi ini, jadi keputusannya harus diambil pengguna lain:',
      decision: 'Keputusan ini',
      ago: function (s) {
        if (s < 60) return s + ' dtk lalu';
        if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
        if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
        return Math.floor(s / 86400) + ' hari lalu';
      },
    },
    en: {
      signInTitle: 'Sign in to the console',
      signInLead: 'Your account decides your part in the workflow: who submits, who decides, and whose name is written into the Orkes audit trail.',
      signIn: 'Sign in', signingIn: 'Checking…', username: 'Username', password: 'Password',
      demoAccounts: 'Demo accounts — click to fill both fields',
      badLogin: 'Wrong username or password.',
      demoNote: 'Demo simulation: every account’s password is',
      flows: 'Orkes workflows this console runs:',
      signOut: 'Sign out', activity: 'Activity', orkes: 'Orkes Conductor',
      drawerTitle: 'Workflow executions', mine: 'Mine', all: 'All users',
      allInOrkes: 'All executions in Orkes ↗', open: 'Open', openOrkes: 'View in Orkes',
      none: 'No executions yet. Run a flow — every execution is recorded here with a link to Orkes.',
      by: 'by', execution: 'Orkes execution', startedBy: 'started by',
      lockedRole: function (a, r) { return a + ' can only be done by ' + r + '.'; },
      lockedAs: function (n, t) { return 'You are signed in as ' + n + ' (' + t + '). Switch user to continue:'; },
      lockedMaker: function (a) { return a + ' — four-eyes principle (maker–checker).'; },
      lockedMakerBody: 'You started this execution yourself, so another user has to decide it:',
      decision: 'This decision',
      ago: function (s) {
        if (s < 60) return s + 's ago';
        if (s < 3600) return Math.floor(s / 60) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        return Math.floor(s / 86400) + 'd ago';
      },
    },
  }[LANG];

  // ------------------------------------------------------------- storage
  // Session per tab (like the UAP); run registry per browser, so a maker's run
  // is waiting in the drawer when the checker signs in on the same machine.
  function sget(store, k, dflt) {
    try { var v = store.getItem(k); return v == null ? dflt : JSON.parse(v); } catch (_) { return dflt; }
  }
  function sset(store, k, v) {
    try { store.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ }
  }
  var ss = window.sessionStorage, ls = window.localStorage;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (w) { return w[0]; }).join('').toUpperCase();
  }
  function av(p) { return '<span class="kit-av">' + esc(initials(p && p.name)) + '</span>'; }
  function persona(id) {
    for (var i = 0; i < PERSONAS.length; i++) if (PERSONAS[i].id === id) return PERSONAS[i];
    return null;
  }
  function roleLabel(r) { return ROLES[r] || r; }

  // ------------------------------------------------------------- session
  function user() {
    var s = sget(ss, KEY + '.session', null);
    return s ? persona(s.id) : null;
  }
  function can(role) {
    var u = user();
    if (!u) return false;
    if (!role) return true;
    var need = [].concat(role);
    return need.some(function (r) { return (u.roles || []).indexOf(r) >= 0; });
  }
  function actor() {
    var u = user();
    return u ? u.name + ' — ' + u.title : '';
  }
  function signInAs(id, reopen) {
    sset(ss, KEY + '.session', { id: id, at: new Date().toISOString() });
    if (reopen) sset(ss, KEY + '.reopen', reopen);
    var url = location.pathname + location.search;
    location.replace(url);
  }
  function signOut() {
    try { ss.removeItem(KEY + '.session'); } catch (_) { /* ignore */ }
    location.replace(location.pathname + location.search);
  }

  // -------------------------------------------------------- run registry
  function runs() { return sget(ls, KEY + '.runs', []); }
  function saveRuns(list) { sset(ls, KEY + '.runs', list.slice(0, 60)); }
  function find(id) {
    var l = runs();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  // Record a workflow this console started. Called right after the start call
  // returns, so the registry knows who the maker was.
  function track(id, meta) {
    if (!id) return;
    meta = meta || {};
    var u = user();
    var list = runs().filter(function (r) { return r.id !== id; });
    list.unshift({
      id: id,
      workflow: meta.workflow || (CFG.workflows ? Object.keys(CFG.workflows)[0] : ''),
      flow: meta.flow || '',
      label: meta.label || '',
      status: meta.status || 'RUNNING',
      by: u ? u.id : '',
      at: new Date().toISOString(),
    });
    saveRuns(list);
    renderCount();
    renderDrawer();
  }
  function update(id, patch) {
    if (!id || !patch) return;
    var list = runs(), hit = false;
    list.forEach(function (r) {
      if (r.id !== id) return;
      Object.keys(patch).forEach(function (k) {
        if (patch[k] !== undefined && patch[k] !== null && patch[k] !== '') { if (r[k] !== patch[k]) hit = true; r[k] = patch[k]; }
      });
    });
    if (hit) { saveRuns(list); renderDrawer(); }
  }
  // Remember an execution this console opened but did not start (from a queue
  // or deep link), so it shows up in the drawer too. Never overwrites the maker.
  function seen(id, meta) {
    if (!id || find(id)) { if (meta) update(id, meta); return; }
    meta = meta || {};
    var list = runs();
    list.unshift({
      id: id, workflow: meta.workflow || '', flow: meta.flow || '', label: meta.label || '',
      status: meta.status || '', by: '', at: new Date().toISOString(),
    });
    saveRuns(list);
    renderCount();
  }
  // Record that the signed-in user decided this run (a checker, an approver),
  // so it counts as theirs in the drawer alongside the runs they started.
  function acted(id, status) {
    var u = user();
    if (!id || !u) return;
    if (!find(id)) seen(id);
    var list = runs();
    list.forEach(function (r) {
      if (r.id !== id) return;
      r.actors = (r.actors || []).filter(function (a) { return a !== u.id; }).concat(u.id);
      if (status) r.status = status;
    });
    saveRuns(list);
    renderCount();
    renderDrawer();
  }
  function mine(r, u) { return !!u && (r.by === u.id || (r.actors || []).indexOf(u.id) >= 0); }
  function makerOf(id) { var r = find(id); return r && r.by ? persona(r.by) : null; }

  // ----------------------------------------------------- Orkes links
  function execUrl(id) { return UI + '/execution/' + encodeURIComponent(id); }
  function defUrl(name, version) {
    return UI + '/workflowDef/' + encodeURIComponent(name) + (version ? '/' + encodeURIComponent(version) : '');
  }
  var LOCK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  var PEOPLE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 5.5 4.8"/></svg>';
  var ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M14 3h7v7"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>';

  // A pill link straight to the execution in the Orkes UI. `label` replaces the
  // id text (e.g. "Orkes") where space is tight.
  function execLink(id, label) {
    if (!id) return '';
    return '<a class="kit-exec" href="' + esc(execUrl(id)) + '" target="_blank" rel="noopener" title="' +
      esc(T.openOrkes) + ' — ' + esc(id) + '">' + ICON +
      (label ? esc(label) : '<code>' + esc(id) + '</code>') + '</a>';
  }

  // The standard strip at the top of a result: which execution, who started it.
  function execBanner(id) {
    if (!id) return '';
    var m = makerOf(id), r = find(id);
    return '<div class="kit-banner"><span class="kit-banner-lbl">' + esc(T.execution) + '</span>' +
      execLink(id) +
      (r && r.workflow ? '<a class="kit-exec" href="' + esc(defUrl(r.workflow)) + '" target="_blank" rel="noopener">' + ICON + '<code>' + esc(r.workflow) + '</code></a>' : '') +
      (m ? '<span class="kit-banner-who">' + esc(T.startedBy) + '</span> ' + av(m) + ' <b>' + esc(m.name) + '</b>' : '') +
      '</div>';
  }

  // ------------------------------------------------------------ role gate
  function switchButtons(role, excludeId) {
    return PERSONAS.filter(function (p) {
      return p.id !== excludeId && [].concat(role).some(function (r) { return (p.roles || []).indexOf(r) >= 0; });
    }).map(function (p) {
      return '<button type="button" class="kit-switch" data-kit-switch="' + esc(p.id) + '">' + av(p) +
        esc(p.name) + ' · ' + esc(p.title) + '</button>';
    }).join('');
  }

  /*
   * Wrap an approval panel. Returns the panel untouched when the signed-in
   * persona holds `role` and did not start `workflowId` themselves; otherwise a
   * locked notice with one-click switches to the personas who may decide.
   * Switching re-opens `workflowId` after the reload (see onOpen).
   */
  function gate(opts) {
    var html = opts.html || '';
    var action = opts.action || T.decision;
    var u = user();
    var role = opts.role;
    var reopen = opts.workflowId ? ' data-kit-reopen="' + esc(opts.workflowId) + '"' +
      (opts.flow ? ' data-kit-reopen-flow="' + esc(opts.flow) + '"' : '') : '';
    if (!can(role)) {
      var names = [].concat(role).map(roleLabel).join(' / ');
      return '<div class="kit-locked"' + reopen + '><div class="kit-locked-ic">' + LOCK + '</div><div>' +
        '<b>' + esc(T.lockedRole(action, names)) + '</b>' +
        '<p>' + esc(T.lockedAs(u ? u.name : '—', u ? u.title : '—')) + '</p>' +
        '<div class="kit-switch-row">' + switchButtons(role) + '</div></div></div>';
    }
    var maker = opts.workflowId && opts.fourEyes !== false ? makerOf(opts.workflowId) : null;
    if (maker && u && maker.id === u.id) {
      return '<div class="kit-locked"' + reopen + '><div class="kit-locked-ic">' + PEOPLE + '</div><div>' +
        '<b>' + esc(T.lockedMaker(action)) + '</b>' +
        '<p>' + esc(T.lockedMakerBody) + '</p>' +
        '<div class="kit-switch-row">' + switchButtons(role, u.id) + '</div></div></div>';
    }
    return html;
  }

  // Same rule for a panel that already exists in the page: hide it and show
  // the notice beside it, or restore it.
  function gateEl(el, opts) {
    if (!el) return true;
    var next = el.nextElementSibling;
    if (next && next.hasAttribute('data-kit-gate')) next.remove();
    var out = gate(Object.assign({}, opts, { html: '' }));
    if (!out) { el.hidden = false; return true; }
    el.hidden = true;
    var holder = document.createElement('div');
    holder.setAttribute('data-kit-gate', '');
    holder.innerHTML = out;
    el.insertAdjacentElement('afterend', holder);
    return false;
  }

  // ------------------------------------------------------------- open hook
  var openHandler = null;
  function onOpen(fn) {
    openHandler = fn;
    var pending = sget(ss, KEY + '.reopen', null);
    if (pending) {
      try { ss.removeItem(KEY + '.reopen'); } catch (_) { /* ignore */ }
      var r = find(pending.id) || pending;
      setTimeout(function () { fn(Object.assign({}, r, pending)); }, 0);
    }
  }

  // --------------------------------------------------------------- chrome
  function renderHeader() {
    var u = user();
    var header = document.createElement('header');
    header.className = 'kit-hero';
    header.innerHTML =
      '<div class="kit-hero-inner">' +
        '<span class="kit-logo">' + esc(CFG.brand || 'BDN') + '</span>' +
        '<span class="kit-divider"></span>' +
        '<span class="kit-eyebrow">' + esc(CFG.app || '') + '</span>' +
        '<span class="kit-bullet">&#9679;</span>' +
        '<span class="kit-title">' + esc(CFG.title || '') + '</span>' +
        '<div class="kit-right">' +
          '<span class="kit-slot" id="kit-slot"></span>' +
          '<a class="kit-btn" href="' + esc(UI + '/executions') + '" target="_blank" rel="noopener">' + ICON + esc(T.orkes) + '</a>' +
          '<button type="button" class="kit-btn" id="kit-activity">' + esc(T.activity) + ' <span class="kit-count zero" id="kit-count">0</span></button>' +
          (u ? '<span class="kit-who">' + av(u) + '<span class="kit-who-text"><b>' + esc(u.name) + '</b><small>' + esc(u.title) + '</small></span></span>' +
            '<button type="button" class="kit-btn" id="kit-signout">' + esc(T.signOut) + '</button>' : '') +
          '<span class="kit-live"><i></i>Live</span>' +
        '</div>' +
      '</div>';

    // The console's own header is replaced; anything in it marked
    // data-kit-header (connection pills, workflow names) moves across.
    var old = document.querySelector('[data-kit-replace]');
    var keep = old ? old.querySelectorAll('[data-kit-header]') : [];
    if (old) old.replaceWith(header); else document.body.insertBefore(header, document.body.firstChild);
    var slot = header.querySelector('#kit-slot');
    Array.prototype.forEach.call(keep, function (n) { slot.appendChild(n); });

    header.querySelector('#kit-activity').addEventListener('click', openDrawer);
    var so = header.querySelector('#kit-signout');
    if (so) so.addEventListener('click', signOut);
    renderCount();
  }

  function renderCount() {
    var el = document.getElementById('kit-count');
    if (!el) return;
    var u = user();
    var n = runs().filter(function (r) { return mine(r, u); }).length;
    el.textContent = n;
    el.className = 'kit-count' + (n ? '' : ' zero');
  }

  var drawer, backdrop, drawerScope = 'mine';
  function buildDrawer() {
    drawer = document.createElement('aside');
    drawer.className = 'kit-drawer';
    drawer.innerHTML =
      '<div class="kit-drawer-head"><h3>' + esc(T.drawerTitle) + '</h3><button class="kit-x" data-kit-close aria-label="close">×</button></div>' +
      '<div class="kit-drawer-tools">' +
        '<button class="kit-seg on" data-kit-scope="mine">' + esc(T.mine) + '</button>' +
        '<button class="kit-seg" data-kit-scope="all">' + esc(T.all) + '</button>' +
        '<a href="' + esc(UI + '/executions') + '" target="_blank" rel="noopener">' + esc(T.allInOrkes) + '</a>' +
      '</div>' +
      '<div class="kit-drawer-body" id="kit-drawer-body"></div>';
    backdrop = document.createElement('div');
    backdrop.className = 'kit-drawer-backdrop';
    document.body.appendChild(drawer);
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', closeDrawer);
    drawer.querySelector('[data-kit-close]').addEventListener('click', closeDrawer);
    drawer.querySelectorAll('[data-kit-scope]').forEach(function (b) {
      b.addEventListener('click', function () { setScope(b.getAttribute('data-kit-scope')); renderDrawer(); });
    });
    drawer.addEventListener('click', function (e) {
      var b = e.target.closest('[data-kit-open]');
      if (!b) return;
      var r = find(b.getAttribute('data-kit-open'));
      if (r && openHandler) { closeDrawer(); openHandler(r); }
    });
  }
  function openDrawer() {
    if (!runs().some(function (r) { return mine(r, user()); })) setScope('all');
    renderDrawer();
    drawer.classList.add('open');
    backdrop.classList.add('open');
  }
  function setScope(scope) {
    drawerScope = scope;
    drawer.querySelectorAll('[data-kit-scope]').forEach(function (x) {
      x.classList.toggle('on', x.getAttribute('data-kit-scope') === scope);
    });
  }
  function closeDrawer() { drawer.classList.remove('open'); backdrop.classList.remove('open'); }

  function statusClass(s) {
    s = String(s || '').toUpperCase();
    if (/RUNNING|PAUSED|PENDING|WAIT|MENUNGGU/.test(s)) return 'run';
    if (/FAIL|TERMINAT|TIMED_OUT|REJECT|BLOCK|DECLINE|TOLAK|BROKEN|SUSPICIOUS|EXIT/.test(s)) return 'bad';
    if (/REVIEW|REFER|HOLD|STEP_UP|WARN|PARTIAL|POSTPONE|ESCALAT|AWAIT/.test(s)) return 'warn';
    if (s) return 'ok';
    return '';
  }

  function renderDrawer() {
    var body = document.getElementById('kit-drawer-body');
    if (!body) return;
    var u = user();
    var list = runs().filter(function (r) { return drawerScope === 'all' || mine(r, u); });
    if (!list.length) { body.innerHTML = '<div class="kit-empty">' + esc(T.none) + '</div>'; return; }
    body.innerHTML = list.map(function (r) {
      var p = persona(r.by);
      var flowName = (CFG.workflows && CFG.workflows[r.workflow]) || r.workflow;
      var secs = Math.max(0, Math.floor((Date.now() - Date.parse(r.at)) / 1000));
      return '<div class="kit-run">' +
        '<div class="kit-run-top"><b>' + esc(r.label || flowName || r.id) + '</b>' +
          (r.status ? '<span class="kit-st ' + statusClass(r.status) + '">' + esc(r.status) + '</span>' : '') + '</div>' +
        '<div class="kit-run-meta">' + esc(flowName) +
          (p ? ' · ' + esc(T.by) + ' ' + av(p) + esc(p.name) : '') + ' · ' + esc(T.ago(secs)) + '</div>' +
        '<div class="kit-run-actions">' +
          (openHandler ? '<button class="kit-mini" data-kit-open="' + esc(r.id) + '">' + esc(T.open) + '</button>' : '') +
          execLink(r.id) +
        '</div></div>';
    }).join('');
  }

  // ------------------------------------------------------------- sign-in
  function renderSignIn() {
    var pw = CFG.password || 'bdn-demo';
    var wrap = document.createElement('div');
    wrap.className = 'kit-signin';
    var flows = Object.keys(CFG.workflows || {}).map(function (w) {
      return '<a href="' + esc(defUrl(w)) + '" target="_blank" rel="noopener">' + esc(w) + ' ↗</a>';
    }).join('');
    wrap.innerHTML =
      '<div class="kit-signin-wrap">' +
        '<div class="kit-signin-brand"><span class="kit-logo">' + esc(CFG.brand || 'BDN') + '</span>' +
          '<span class="kit-eyebrow">' + esc(CFG.app || '') + '</span></div>' +
        '<h1>' + esc(CFG.title || T.signInTitle) + '</h1>' +
        '<p class="kit-lead">' + esc(CFG.lead || T.signInLead) + '</p>' +
        '<div class="kit-signin-grid">' +
          '<section class="kit-card">' +
            '<h2>' + esc(T.signInTitle) + '</h2><p class="kit-sub">' + esc(CFG.bank || 'PT Bank Delta Nusantara') + '</p>' +
            '<p class="kit-err" id="kit-err"></p>' +
            '<form id="kit-form" autocomplete="off">' +
              '<label class="kit-field"><span>' + esc(T.username) + '</span><input id="kit-user" autocapitalize="off" spellcheck="false" placeholder="' + esc(PERSONAS[0] ? PERSONAS[0].id : '') + '"></label>' +
              '<label class="kit-field"><span>' + esc(T.password) + '</span><input id="kit-pass" type="password"></label>' +
              '<button class="kit-primary" id="kit-submit">' + esc(T.signIn) + '</button>' +
            '</form>' +
            '<p class="kit-note">' + esc(T.demoNote) + ' <code>' + esc(pw) + '</code></p>' +
            (flows ? '<div class="kit-flows"><span>' + esc(T.flows) + '</span>' + flows + '</div>' : '') +
          '</section>' +
          '<section>' +
            '<p class="kit-note" style="margin:0 0 10px">' + esc(T.demoAccounts) + '</p>' +
            '<div class="kit-personas">' + PERSONAS.map(function (p) {
              return '<button type="button" class="kit-persona" data-kit-pick="' + esc(p.id) + '">' + av(p) +
                '<span class="kit-persona-body"><b>' + esc(p.name) + '</b>' +
                '<span class="kit-p-title">' + esc(p.title) + (p.unit ? ' · ' + esc(p.unit) : '') + '</span>' +
                '<span class="kit-p-user">' + esc(p.id) + '</span>' +
                '<span class="kit-roles">' + (p.roles || []).map(function (r) { return '<span class="kit-role">' + esc(roleLabel(r)) + '</span>'; }).join('') + '</span>' +
                (p.hint ? '<span class="kit-p-hint">' + esc(p.hint) + '</span>' : '') +
                '</span></button>';
            }).join('') + '</div>' +
          '</section>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    var $u = wrap.querySelector('#kit-user'), $p = wrap.querySelector('#kit-pass'), $e = wrap.querySelector('#kit-err');
    wrap.querySelectorAll('[data-kit-pick]').forEach(function (b) {
      b.addEventListener('click', function () {
        // Fill only, as the UAP does: signing in from a misclick would hide
        // what was filled, which is the thing worth seeing on a demo.
        wrap.querySelectorAll('[data-kit-pick]').forEach(function (x) { x.classList.toggle('sel', x === b); });
        $u.value = b.getAttribute('data-kit-pick');
        $p.value = pw;
        $e.classList.remove('show');
        wrap.querySelector('#kit-submit').focus();
      });
    });
    wrap.querySelector('#kit-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var p = persona($u.value.trim().toLowerCase());
      if (!p || $p.value !== pw) {
        $e.textContent = T.badLogin; $e.classList.add('show'); $p.value = ''; $p.focus();
        return;
      }
      signInAs(p.id);
    });
  }

  // Switch buttons inside gates, anywhere on the page.
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-kit-switch]');
    if (!b) return;
    var lock = b.closest('[data-kit-reopen]');
    signInAs(b.getAttribute('data-kit-switch'), lock ? {
      id: lock.getAttribute('data-kit-reopen'),
      flow: lock.getAttribute('data-kit-reopen-flow') || '',
    } : null);
  });

  // Every console labels its flows with a .wf-tag chip ("collection_case v1").
  // Clicking one opens that workflow's definition in Orkes.
  document.addEventListener('click', function (e) {
    var tag = e.target.closest && e.target.closest('.wf-tag');
    if (!tag) return;
    var name = String(tag.textContent || '').trim().split(/\s+/)[0];
    if (/^[A-Za-z0-9_\-]+$/.test(name)) window.open(defUrl(name), '_blank', 'noopener');
  });

  // ------------------------------------------------------------------ boot
  if (!user()) document.documentElement.classList.add('kit-out');
  if (CFG.lang) document.documentElement.setAttribute('lang', CFG.lang);

  function boot() {
    if (!user()) { renderSignIn(); return; }
    renderHeader();
    buildDrawer();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.DemoKit = {
    user: user, can: can, actor: actor, persona: persona, personas: function () { return PERSONAS.slice(); },
    roleLabel: roleLabel, signOut: signOut, signInAs: signInAs,
    track: track, update: update, seen: seen, acted: acted, runs: runs, makerOf: makerOf,
    execUrl: execUrl, defUrl: defUrl, execLink: execLink, execBanner: execBanner,
    gate: gate, gateEl: gateEl, onOpen: onOpen, esc: esc,
  };
})();
