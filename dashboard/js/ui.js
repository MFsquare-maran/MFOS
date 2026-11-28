/* ===================================================================
   ui.js  –  Gemeinsame UI-Bausteine: Icons, Navigation, Top-Leiste,
             Alarm-Leiste, Theme, Toasts, Format-Helfer
   =================================================================== */
(function () {
  'use strict';
  const M = window.MFOS;
  const s = M.state;
  M.$ = (q, r = document) => r.querySelector(q);
  M.$$ = (q, r = document) => Array.from(r.querySelectorAll(q));
  const $ = M.$, $$ = M.$$;

  /* ---------- Format-Helfer ---------- */
  const pad = n => String(n).padStart(2, '0');
  M.fmt = (n, d = 1) => (n == null || isNaN(n)) ? '–' : Number(n).toFixed(d);
  M.fmtTime = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  M.fmtDist = m => m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
  M.fmtDur = sec => {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`;
  };
  M.fmtPos = p => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;

  /* ---------- Icons ---------- */
  const ICONS = {
    map: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    replay: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="m10 9 5 3-5 3z"/>',
    gamepad: '<rect x="3" y="8" width="18" height="10" rx="5"/><path d="M8 11v4M6 13h4"/><circle cx="15" cy="12" r="1"/><circle cx="17.5" cy="14" r="1"/>',
    gauge: '<path d="M4 18a9 9 0 1 1 16 0"/><path d="M12 18V9"/><circle cx="12" cy="18" r="1.3"/>',
    dial: '<path d="M4 18a9 9 0 1 1 16 0"/><path d="m12 18 4-6"/><circle cx="12" cy="18" r="1.3"/>',
    flask:'<path d="M9 3h6M10 3v6L5 19a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-10V3"/><path d="M7.5 15h9"/>',
    lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    folder:'<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    sat: '<path d="M5 19a9 9 0 0 1 14-14"/><path d="M5 13a5 5 0 0 1 6 6"/><circle cx="6" cy="18" r="1.2"/><path d="m14 10 5-5"/>',
    battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/>',
    theme: '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>',
    play: '<path d="m7 4 13 8-13 8z"/>',
    pause: '<path d="M7 4v16M17 4v16"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h0"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>'
  };
  M.icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;
  M.hydrateIcons = (root = document) => $$('i[data-icon]', root).forEach(el => { if (!el.firstChild) el.innerHTML = M.icon(el.dataset.icon); });

  /* ---------- Einheit Geschwindigkeit (km/h <-> m/s) ---------- */
  // Intern ist alles in km/h; umgerechnet wird nur bei der Anzeige und Eingabe.
  M.units = { speed: 'kmh' };
  try { if (localStorage.getItem('mfos-speed-unit') === 'ms') M.units.speed = 'ms'; } catch (e) { /* ignore */ }
  const isMs = () => M.units.speed === 'ms';
  M.spd = kmh => isMs() ? kmh / 3.6 : kmh;
  M.spdUnit = () => isMs() ? 'm/s' : 'km/h';
  M.fmtSpd = (kmh, d) => M.fmt(M.spd(kmh), d == null ? (isMs() ? 2 : 1) : d);
  M.setSpeedUnit = u => {
    M.units.speed = u;
    try { localStorage.setItem('mfos-speed-unit', u); } catch (e) { /* ignore */ }
    $('#unitBtn').textContent = M.spdUnit();
    M.emit('units');
  };

  /* Hinweis, wenn das Gas-Maximum das Tempo staerker begrenzt als die Reisegeschwindigkeit */
  M.updateLimitNote = el => {
    const l = M.speedLimit();
    el.hidden = l.by !== 'gas';
    if (l.by === 'gas') el.textContent = `Das Gas-Maximum (${s.params.maxThrottle} %) begrenzt stärker: nur ca. ${M.fmtSpd(l.kmh)} ${M.spdUnit()} statt ${M.fmtSpd(s.params.cruiseSpeed)} ${M.spdUnit()}.`;
  };

  /* ---------- Parameter-Feld (Mission + Steuerung + Live) ---------- */
  M.readParam = (d, inp) => {                 // Eingabefeld -> gespeicherter Wert
    if (d.type === 'bool') return inp.checked;
    if (d.type === 'select') return inp.value;
    if (d.type === 'speed') return isMs() ? Math.round(Number(inp.value) * 3.6 * 100) / 100 : Number(inp.value);
    return Number(inp.value);
  };
  M.paramField = (d, val, changed = false) => {
    const lbl = `<label>${d.label}${d.hint ? `<small>${d.hint}</small>` : ''}</label>`;
    const cls = 'field' + (changed ? ' changed' : '');
    if (d.type === 'speed') {
      const r = v => Math.round(v * 100) / 100;
      return `<div class="${cls}">${lbl}<div class="inwrap"><input type="number" data-key="${d.key}" min="${r(M.spd(d.min))}" max="${r(M.spd(d.max))}" step="${isMs() ? 0.1 : d.step}" value="${r(M.spd(val))}"><span class="unit">${M.spdUnit()}</span></div></div>`;
    }
    if (d.type === 'bool')
      return `<div class="${cls}">${lbl}<label class="switch"><input type="checkbox" data-key="${d.key}" ${val ? 'checked' : ''}><span></span></label></div>`;
    if (d.type === 'select')
      return `<div class="${cls}">${lbl}<select data-key="${d.key}">${d.options.map(o => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
    return `<div class="${cls}">${lbl}<div class="inwrap"><input type="number" data-key="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${val}"><span class="unit">${d.unit || ''}</span></div></div>`;
  };

  /* ---------- Bestaetigungsdialog ----------
     M.confirm({ title, text, confirmLabel, danger, check, type }) -> Promise<boolean>
     check = Text einer Pflicht-Checkbox, type = Wort, das eingetippt werden muss */
  M.confirm = (o) => new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-back';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${o.title}">
      <h2>${o.title}</h2><p>${o.text || ''}</p>
      ${o.auto ? `<ul class="pf-auto">${o.auto.map(a => `<li class="pf-${a.state}"><b>${{ ok: '✓', warn: '!', fail: '✕' }[a.state]}</b><span>${a.label}</span><em>${a.text}</em></li>`).join('')}</ul>` : ''}
      ${o.checks ? `<div class="pf-checks">${o.checks.map(c => `<label class="chk big"><input type="checkbox" class="mdChk"> ${c}</label>`).join('')}</div>` : ''}
      ${o.auto && o.auto.some(a => a.state === 'fail') ? '<p class="crit-txt small">Gesperrt: Eine Voraussetzung ist nicht erfüllt (✕).</p>' : ''}
      ${o.check ? `<label class="chk big"><input type="checkbox" id="mdCheck"> ${o.check}</label>` : ''}
      ${o.type ? `<p class="small muted">Zur Bestätigung <b>${o.type}</b> eintippen:</p><input type="text" id="mdType" class="cname" autocomplete="off" autocapitalize="characters" spellcheck="false">` : ''}
      <div class="btn-row"><button class="btn ${o.danger ? 'danger' : 'primary'}" id="mdOk" disabled>${o.confirmLabel || 'Bestätigen'}</button>
      <button class="btn ghost" id="mdNo">Abbrechen</button></div></div>`;
    document.body.appendChild(wrap);
    const ok = wrap.querySelector('#mdOk'), chk = wrap.querySelector('#mdCheck'), typ = wrap.querySelector('#mdType');
    const checks = [...wrap.querySelectorAll('.mdChk')], blocked = !!(o.auto && o.auto.some(a => a.state === 'fail'));
    const valid = () => !blocked && (!chk || chk.checked) && checks.every(c => c.checked) && (!typ || typ.value.trim().toUpperCase() === o.type);
    checks.forEach(c => c.addEventListener('change', () => { ok.disabled = !valid(); }));
    const upd = () => { ok.disabled = !valid(); };
    const done = v => { document.removeEventListener('keydown', onKey); wrap.remove(); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') done(false); if (e.key === 'Enter' && valid()) done(true); };
    document.addEventListener('keydown', onKey);
    if (chk) chk.addEventListener('change', upd);
    if (typ) typ.addEventListener('input', upd);
    ok.addEventListener('click', () => { if (valid()) done(true); });
    upd();                                       // Dialog ohne Haken/Eingabe: Knopf sofort aktiv
    wrap.querySelector('#mdNo').addEventListener('click', () => done(false));
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) done(false); });
    (typ || chk || ok).focus();
  });

  /* ---------- Checkliste vor dem Scharfschalten ----------
     kind: 'mission' (Fahrt mit Kurs) | 'tune' (Tuning, Boot faehrt Sprungtests).
     Obere Zeilen prueft das Dashboard aus der Telemetrie (✕ sperrt), die Haken setzt der Mensch.
     Das Boot kennt die Liste nicht, sie ist ein Schritt fuer den Bediener (docs/schnittstelle.md 8a). */
  M.preflightAuto = kind => {
    const P = s.params, row = (label, state, text) => ({ label, state, text });
    const list = [
      row('Verbindung', s.online ? 'ok' : 'fail', s.online ? (s.net.active === 'wifi' ? 'WLAN' : 'LTE') : 'Boot offline'),
      row('GPS', !s.gps.fix ? 'fail' : s.gps.sats < 8 || s.gps.hdop > 2 ? 'warn' : 'ok', s.gps.fix ? `${s.gps.sats} Satelliten, HDOP ${s.gps.hdop.toFixed(1)}` : 'kein Fix'),
      row('Leck-Sensor', s.leak ? 'fail' : 'ok', s.leak ? 'LECK!' : 'trocken'),
      row('Akku', s.power.v <= P.battCrit ? 'fail' : s.power.v <= P.battWarn ? 'warn' : 'ok', `${s.power.v.toFixed(1)} V · ${M.fmt(M.soc(s.power.v), 0)} %`),
      row('ESC-Temperatur', s.temps.esc >= P.escCrit ? 'fail' : s.temps.esc >= P.escWarn ? 'warn' : 'ok', `${s.temps.esc.toFixed(0)} °C`),
      row('Funksignal', s.net.active === 'lte' && s.lte.dbm < -105 ? 'warn' : 'ok', s.net.active === 'lte' ? `${s.lte.dbm.toFixed(0)} dBm` : 'WLAN')
    ];
    const age = Math.round((s.now - s.lastSeen) / 1000);
    list.splice(1, 0, row('Daten aktuell', !s.online || age > 10 ? 'fail' : age > 3 || s.latency > 2000 ? 'warn' : 'ok', `letzte Meldung vor ${age} s, ${Math.round(s.latency)} ms`));
    list.push(
      row('Lage (Roll/Pitch)', Math.max(Math.abs(s.roll), Math.abs(s.pitch)) > 20 ? 'warn' : 'ok', `${s.roll.toFixed(0)}° / ${s.pitch.toFixed(0)}°`),
      row('Innenraum', s.temps.hull >= P.hullWarn ? 'warn' : 'ok', `${s.temps.hull.toFixed(0)} °C`),
      row('Testmodus', s.test.active ? 'fail' : 'ok', s.test.active ? 'aktiv, erst beenden' : 'aus'));
    if (kind === 'mission') {
      const wps = M.resolveWps(s.mission.wps, s.home), dHome = M.geo.dist(s.pos, s.home);
      list.push(row('Kurs', wps.length ? 'ok' : 'fail', wps.length ? `${wps.length} Wegpunkte` : 'keine Wegpunkte geladen'));
      list.push(row('Home-Abstand', dHome > P.geofence ? 'fail' : dHome > P.geofence / 2 ? 'warn' : 'ok', `${M.fmtDist(dHome)} (Geofence ${M.fmtDist(P.geofence)})`));
      if (wps.length) {
        const out = wps.filter(w => M.geo.dist(w, s.home) > P.geofence).length;
        list.push(row('Wegpunkte im Geofence', out ? 'fail' : 'ok', out ? `${out} ausserhalb` : 'alle innerhalb'));
        let len = 0, p = s.pos; wps.forEach(w => { len += M.geo.dist(p, w); p = w; });
        const need = len / Math.max(M.speedLimit().kmh / 3.6, 0.1), have = Math.max(0, P.battCap - s.power.mah) / Math.max(s.power.a * 1000, 1000) * 3600;
        list.push(row('Akku reicht für den Kurs', have < need ? 'fail' : have < need * 1.5 ? 'warn' : 'ok', `${M.fmtDist(len)}, ca. ${M.fmtDur(need)} nötig, Rest ca. ${M.fmtDur(have)}`));
      }
      const pend = [s.mission.sync, s.homeSync, s.paramSync].some(x => x && x !== 'ok');
      list.push(row('Boot hat alles bestätigt', pend ? 'fail' : 'ok', pend ? 'Kurs, Home oder Einstellungen noch nicht bestätigt' : 'Kurs, Home, Einstellungen'));
    }
    return list;
  };
  M.preflightChecks = kind => [
    'Das Wasser um das Boot ist frei (keine Personen, Tiere oder andere Boote), der Propeller ist frei.',
    'Rumpf und Deckel sind dicht geschlossen, der Akku ist fest eingebaut und gesichert.'
  ].concat(kind === 'tune' ? [
    'Fernsteuerung (Sender) ist eingeschaltet, der NOT-AUS ist in Reichweite.',
    'Ich weiss, wie ich das Boot im Notfall zurückhole (Helfer, Rückholleine oder zweites Boot).',
    'Rundherum sind mindestens 50 m freie Wasserfläche: bei Sprungtests fährt das Boot von selbst, auch im Kreis.',
    'Ich beobachte das Boot während der Tests und löse bei auffälligem Verhalten sofort NOT-AUS aus.'
  ] : [
    'Kurs und Home-Position sind geprüft: alle Wegpunkte liegen im Wasser, die Strecke ist frei von Hindernissen.'
  ]);
  M.preflight = kind => M.confirm({
    title: kind === 'tune' ? 'Boot für das Tuning scharf schalten?' : 'Boot scharf schalten?',
    text: kind === 'tune' ? 'Danach fährt das Boot bei jedem Sprungtest von selbst, ohne Mission.' : 'Danach können Mission und Return Home den Antrieb starten.',
    auto: M.preflightAuto(kind), checks: M.preflightChecks(kind), confirmLabel: 'Scharf schalten'
  });

  /* ---------- Toasts ---------- */
  M.toast = (msg, kind = 'info') => {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3600);
  };

  /* ---------- Theme ---------- */
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('mfos-theme', t); } catch (e) { /* ignore */ }
    M.emit('theme', t);
  }
  M.theme = () => document.documentElement.dataset.theme;
  (function initTheme() {
    let t = null;
    try { t = localStorage.getItem('mfos-theme'); } catch (e) { /* ignore */ }
    if (!t) t = (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
  })();
  $('#unitBtn').textContent = M.spdUnit();
  $('#unitBtn').addEventListener('click', () => M.setSpeedUnit(M.units.speed === 'ms' ? 'kmh' : 'ms'));
  $('#themeBtn').addEventListener('click', () => setTheme(M.theme() === 'dark' ? 'light' : 'dark'));

  /* ---------- Navigation ---------- */
  /* Top-Leiste: auf kleinen Fenstern liegen die weniger wichtigen Werte hinter «Mehr» */
  $('#tbMore').addEventListener('click', e => {
    e.stopPropagation();
    const t = $('.topbar'), on = !t.classList.contains('more');
    $('#tbSec').style.top = Math.round(t.getBoundingClientRect().bottom + 4) + 'px';
    t.classList.toggle('more', on); $('#tbMore').setAttribute('aria-expanded', on); $('#tbMore').textContent = on ? 'Weniger ▴' : 'Mehr ▾';
  });
  document.addEventListener('click', e => { const t = $('.topbar'); if (t.classList.contains('more') && !e.target.closest('.tb-secbox')) { t.classList.remove('more'); $('#tbMore').textContent = 'Mehr ▾'; $('#tbMore').setAttribute('aria-expanded', false); } });
  M.showView = function (id) {
    if (!$('#view-' + id)) id = 'live';
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + id));
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === id));
    M.currentView = id;
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// ok */ }
    M.emit('view', id);
  };
  $$('.nav-item').forEach(b => b.addEventListener('click', () => M.showView(b.dataset.view)));

  /* ---------- LTE-Balken ---------- */
  M.lteBars = dbm => dbm >= -70 ? 4 : dbm >= -85 ? 3 : dbm >= -95 ? 2 : dbm >= -105 ? 1 : 0;
  M.wifiBars = dbm => dbm >= -55 ? 4 : dbm >= -67 ? 3 : dbm >= -75 ? 2 : dbm >= -85 ? 1 : 0;

  /* ---------- Top-Leiste ---------- */
  function renderTopbar() {
    const conn = $('#tbConn');
    const ago = Math.round((s.now - s.lastSeen) / 1000);
    conn.className = 'pill ' + (s.online ? 'ok' : 'crit');
    conn.lastElementChild.textContent = s.online ? 'Online' : `Offline · seit ${ago} s`;

    const arm = $('#tbArm');
    arm.className = 'pill ' + (s.armed ? 'armed' : 'warn');
    arm.lastElementChild.textContent = s.armed ? 'Scharf' : 'Nicht scharf';

    const mode = $('#tbMode');
    mode.className = 'pill' + (s.test.active ? ' warn' : s.mode === 'AUTO' || s.mode === 'RTH' ? ' mode-auto' : s.mode === 'ESTOP' ? ' mode-estop' : s.mode === 'TUNE' ? ' warn' : s.mode === 'SOFT' ? ' mode-auto' : '');
    mode.firstElementChild.textContent = s.test.active ? 'Testmodus' : M.MODES[s.mode];

    const rec = $('#tbRec');
    const recOn = M.recorder && M.recorder.active();
    rec.hidden = !recOn;
    if (recOn) rec.lastElementChild.textContent = 'REC ' + M.fmtDur(M.recorder.elapsed());

    // Aktive Verbindung: LTE oder WLAN (oder keine)
    const link = $('#tbLte'), act = s.net.active, wf = s.net.wifi;
    const bars = act === 'wifi' ? M.wifiBars(wf.rssi) : act === 'lte' ? M.lteBars(s.lte.dbm) : 0;
    $('#tbLinkLbl').textContent = act === 'wifi' ? 'WLAN' : act === 'lte' ? 'LTE' : 'Verbindung';
    link.className = 'pill' + (act === 'none' ? ' crit' : act === 'wifi' ? ' link-wifi' : '');
    $$('#tbLteBars i').forEach((b, i) => b.classList.toggle('on', i < bars));
    $('#tbLteBars').classList.toggle('weak', bars <= 1);
    $('#tbLteTxt').textContent = act === 'wifi' ? `${wf.ssid} · ${wf.rssi.toFixed(0)} dBm` : act === 'lte' ? `${s.lte.dbm.toFixed(0)} dBm` : 'keine';
    link.title = act === 'wifi' ? `Verbunden über WLAN «${wf.ssid}» (${wf.ip})` : act === 'lte' ? `Verbunden über LTE (${s.lte.operator}, ${s.lte.tech})` : 'Keine Verbindung zum Boot';

    // LTE-Datenverbrauch seit dem letzten Reset, gegen die Monatsgrenze
    const pct = s.data.sinceReset / s.params.dataLimit * 100;
    const dEl = $('#tbData');
    dEl.className = 'pill' + (pct >= 100 ? ' crit' : pct >= 80 ? ' warn' : '');
    dEl.lastElementChild.textContent = `${s.data.sinceReset.toFixed(0)} MB · ${pct.toFixed(0)} %`;
    dEl.title = `LTE-Daten (Schätzung): heute ${s.data.today.toFixed(1)} MB · seit Reset ${s.data.sinceReset.toFixed(1)} MB von ${s.params.dataLimit} MB · gesamt ${s.data.total.toFixed(0)} MB`
      + (act === 'wifi' ? ' · über WLAN wird nichts gezählt' : '');

    const gps = $('#tbGps');
    gps.className = 'pill' + (s.gps.fix ? '' : ' warn');
    gps.lastElementChild.textContent = s.gps.fix ? `${s.gps.sats} Sat.` : 'Kein Fix';

    const bat = $('#tbBat'), soc = M.soc(s.power.v);
    bat.className = 'pill' + (s.alarms.some(a => a.id === 'batt' && a.level === 'crit') ? ' crit' : s.alarms.some(a => a.id === 'batt') ? ' warn' : '');
    bat.lastElementChild.textContent = `${s.power.v.toFixed(1)} V · ${soc.toFixed(0)} %`;
    // Batterie-Symbol: Fuellstand nach Ladezustand, Farbe nach den Akku-Schwellen (gruen -> orange -> rot)
    const fill = $('#tbBatFill'), crit = s.power.v <= s.params.battCrit, warn = s.power.v <= s.params.battWarn;
    fill.setAttribute('width', soc > 0 ? Math.max(1.6, 21.3 * soc / 100).toFixed(1) : 0);
    fill.style.fill = crit ? 'var(--crit)' : warn ? 'var(--warn)' : 'var(--ok)';

    /* Energie, Temperaturen und Systeme */
    const P = s.params, put = (id, txt, cls = '') => { const el = $(id); el.className = 'pill' + (cls ? ' ' + cls : ''); el.lastElementChild.textContent = txt; };
    put('#tbCur', `${s.power.a.toFixed(1)} A · ${s.power.w.toFixed(0)} W`);
    const remainS = Math.max(0, P.battCap - s.power.mah) / Math.max(s.power.a * 1000, 1) * 3600;
    put('#tbUsed', `${s.power.mah.toFixed(0)} mAh · ${s.power.wh.toFixed(1)} Wh`);
    put('#tbRem', M.fmtDur(remainS));
    const tcls = (v, w, c) => v >= c ? 'crit' : v >= w ? 'warn' : '';
    put('#tbHull', `${s.temps.hull.toFixed(1)} °C`, tcls(s.temps.hull, P.hullWarn, 999));
    put('#tbEsc', `${s.temps.esc.toFixed(1)} °C`, tcls(s.temps.esc, P.escWarn, P.escCrit));
    put('#tbPump', s.pump.on ? `Läuft · ${s.pump.speed} % · ${{ auto: 'Auto', on: 'Ein', off: 'Aus' }[s.pump.mode]}` : `Aus · ${{ auto: 'Auto', on: 'Ein', off: 'Aus' }[s.pump.mode]}`, s.pump.on ? 'ok-p' : '');
    put('#tbLight', M.LIGHT_MODES[s.light].name);
    put('#tbLeak', s.leak ? 'WASSER!' : 'Trocken', s.leak ? 'crit' : '');
  }

  /* ---------- Alarm-Leiste ---------- */
  function renderAlarms() {
    const bar = $('#alarmBar');
    bar.hidden = s.alarms.length === 0;
    bar.innerHTML = s.alarms
      .slice().sort((a, b) => (a.level === 'crit' ? 0 : 1) - (b.level === 'crit' ? 0 : 1))
      .map(a => `<span class="alarm-chip ${a.level}">${M.icon('alert').replace('<svg', '<svg width="16" height="16"')} ${a.text}</span>`).join('');
    const badge = $('#navAlarmBadge');
    badge.hidden = s.alarms.length === 0;
    badge.textContent = s.alarms.length;
  }

  M.on('tick', renderTopbar);
  M.on('test', renderTopbar);
  M.on('net', renderTopbar);
  M.on('alarms', () => { renderAlarms(); renderTopbar(); });
  M.hydrateIcons();
  renderTopbar();
  renderAlarms();
})();
