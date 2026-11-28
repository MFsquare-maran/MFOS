/* ===================================================================
   view-tuning.js  –  Ansicht «Tuning»: Regler (PID) und Tuning-Werte
   -------------------------------------------------------------------
   Entwurf (draft) bearbeiten → «Senden» (Befehl setTune, Quittung) →
   Sprungtest mit dem gesendeten Satz → Verlauf und Kennzahlen.
   Vorlage: docs/regler.md, Vertrag: docs/schnittstelle.md 6a.
   Die Verlaeufe kommen im Mockup aus M.tuneSim (Platzhalter-Boot).
   =================================================================== */
(function () {
  'use strict';
  const M = window.MFOS, s = M.state, $ = M.$;
  const PROFILES_KEY = 'mfos-tune-profiles-v1';
  const GROUPS = M.TUNE_GROUPS, PID = GROUPS.filter(g => g.kind === 'pid'), VALS = GROUPS.filter(g => g.kind === 'values');
  let draft = { ...s.tune.cur }, lastCur = { ...s.tune.cur };
  let chMain = null, chParts = null, run = null;       // run = laufender oder letzter Test

  /* =================== Karten bauen =================== */
  const field = d => M.paramField(d.noSim ? { ...d, hint: (d.hint ? d.hint + ' · ' : '') + 'im Simulator ohne Wirkung' } : d, draft[d.key], false);
  const btns = `<div class="btn-row"><button class="btn primary" data-act="send">Senden</button><button class="btn" data-act="discard">Verwerfen</button><button class="btn ghost" data-act="default">Standardwerte</button></div>`;

  function testRow(g) {
    const t = g.test;
    return `<div class="tune-test"><span class="tt-lbl"><b>Sprungtest:</b> ${t.label}</span>
      <input type="number" data-test="${g.id}" aria-label="${t.label}"><span class="unit" data-testunit="${g.id}"></span>
      <span class="grow"></span><button class="btn" data-act="test">Test starten</button></div>`;
  }
  function build() {
    $('#tuneCards').innerHTML =
      PID.map(g => `<div class="card tune-card" data-g="${g.id}">
        <div class="card-head"><h3><span class="tune-nr">${g.nr}</span>${g.title}</h3><span class="tag" data-tag>aktiv</span></div>
        <p class="muted small">${g.desc}</p>
        <div class="form">${g.params.map(field).join('')}</div>${btns}${testRow(g)}</div>`).join('') +
      '<h3 class="tune-h">Weitere Tuning-Werte (kein Regler)</h3>' +
      VALS.map(g => `<details class="card tune-card" data-g="${g.id}"><summary><span>${g.title}</span><span class="tag" data-tag>aktiv</span></summary>
        <p class="muted small">${g.desc}</p><div class="form">${g.params.map(field).join('')}</div>${btns}</details>`).join('');
    syncTest();
    sync();
  }

  /* =================== Entwurf <-> Anzeige =================== */
  const changedKeys = g => g.params.filter(d => draft[d.key] !== s.tune.cur[d.key]).map(d => d.key);
  function sync() {
    const active = document.activeElement;
    $('#tuneCards').querySelectorAll('[data-key]').forEach(inp => {
      const k = inp.dataset.key, d = M.TUNE_BY_KEY[k];
      if (inp !== active) { if (d.type === 'bool') inp.checked = !!draft[k]; else inp.value = draft[k]; }
      const f = inp.closest('.field'); if (f) f.classList.toggle('changed', draft[k] !== s.tune.cur[k]);
    });
    GROUPS.forEach(g => {
      const card = $('#tuneCards').querySelector(`[data-g="${g.id}"]`), n = changedKeys(g).length;
      card.classList.toggle('changed', n > 0);
      const tag = card.querySelector('[data-tag]');
      tag.textContent = n ? `${n} Änderung${n > 1 ? 'en' : ''} offen` : 'aktiv';
      tag.className = 'tag' + (n ? ' warn' : ' ok');
      card.querySelector('[data-act="send"]').disabled = !n;
      card.querySelector('[data-act="discard"]').disabled = !n;
      const def = g.params.every(d => s.tune.cur[d.key] === d.def);
      card.querySelector('[data-act="default"]').disabled = def && !n;
    });
    renderBar();
    lockUpdate();
  }
  function syncTest() {                              // Eingabefeld des Sprungtests (Tempo je nach Einheit)
    PID.forEach(g => {
      const inp = $(`[data-test="${g.id}"]`), t = g.test, isSpd = g.id === 'speed';
      if (inp === document.activeElement) return;
      const conv = isSpd ? M.spd : v => v;
      inp.min = +conv(t.min).toFixed(2); inp.max = +conv(t.max).toFixed(2);
      inp.step = isSpd ? (M.units.speed === 'ms' ? 0.05 : t.step) : t.step;
      if (inp.dataset.set !== M.units.speed || !inp.value) { inp.value = +conv(t.def).toFixed(2); inp.dataset.set = M.units.speed; }
      $(`[data-testunit="${g.id}"]`).textContent = isSpd ? M.spdUnit() : t.unit;
    });
  }
  function testSize(g) {                             // gelesener Wert in internen Einheiten (km/h, °, °/s, m)
    const t = g.test, inp = $(`[data-test="${g.id}"]`);
    let v = Number(inp.value);
    if (g.id === 'speed' && M.units.speed === 'ms') v *= 3.6;
    if (!isFinite(v) || v < t.min - 1e-9 || v > t.max + 1e-9) return null;
    return v;
  }

  $('#tuneCards').addEventListener('input', e => {
    const inp = e.target.closest('[data-key]'); if (!inp) return;
    const d = M.TUNE_BY_KEY[inp.dataset.key], v = M.readParam(d, inp);
    draft[d.key] = d.type === 'bool' ? v : (inp.value === '' ? NaN : v);
    sync();
  });

  async function sendGroups(groups) {
    const delta = {};
    groups.forEach(g => changedKeys(g).forEach(k => { delta[k] = draft[k]; }));
    if (!Object.keys(delta).length) return M.toast('Keine Änderungen zu senden', 'info');
    const v = M.tuneValidate(delta, s.tune.cur);
    if (!v.ok) return M.toast(v.errors[0], 'crit');
    if (s.armed && (s.mode === 'AUTO' || s.mode === 'RTH')) {
      const ok = await M.confirm({
        title: 'Regler-Werte während der Fahrt ändern?',
        text: 'Das Boot fährt gerade. Die neuen Werte gelten ab dem nächsten Regeltakt, die Integratoren werden nachgeführt. Falsche Werte können das Boot aus der Bahn bringen.',
        check: 'Ich habe den NOT-AUS in Reichweite.', confirmLabel: 'Senden'
      });
      if (!ok) return;
    }
    M.actions.setTune(delta, groups.length === 1 ? `Regler «${groups[0].title}» senden` : 'Alle Regler-Werte senden');
  }
  const discard = g => { g.params.forEach(d => { draft[d.key] = s.tune.cur[d.key]; }); sync(); };

  $('#tuneCards').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const g = GROUPS.find(x => x.id === b.closest('[data-g]').dataset.g);
    if (b.dataset.act === 'send') sendGroups([g]);
    else if (b.dataset.act === 'discard') discard(g);
    else if (b.dataset.act === 'default') {
      const ok = await M.confirm({ title: `Standardwerte für «${g.title}» laden?`, text: 'Die Werte werden sofort an das Boot gesendet und ersetzen den aktuellen Satz dieser Gruppe. Den letzten guten Satz ändert das nicht.', confirmLabel: 'Standardwerte senden' });
      if (ok) { g.params.forEach(d => { draft[d.key] = d.def; }); M.actions.tuneDefaults(g.id); sync(); }
    }
    else if (b.dataset.act === 'test') startTest(g);
  });

  /* =================== Kopfleiste: Satz, Profile =================== */
  const profiles = () => { try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]'); } catch (e) { return []; } };
  const saveProfiles = l => { try { localStorage.setItem(PROFILES_KEY, JSON.stringify(l)); } catch (e) { M.toast('Profile konnten nicht gespeichert werden', 'warn'); } };
  const sameSet = (a, b) => M.TUNE_DEFS.every(d => a[d.key] === b[d.key]);

  $('#tuneBar').innerHTML = `
    <div class="row"><b>Regler-Satz im Boot</b><span class="tag ok" id="tbRev">Rev 1</span><span class="tag" id="tbGood"></span><span class="tag" id="tbDraft"></span><span class="grow"></span>
      <button class="btn primary" data-b="sendAll">Alle Änderungen senden</button>
      <button class="btn" data-b="discardAll">Alle verwerfen</button></div>
    <div class="row">
      <button class="btn" data-b="mark">Als «letzten guten Satz» merken</button>
      <button class="btn" data-b="restore">Letzten guten Satz wiederherstellen</button>
      <button class="btn ghost" data-b="defaults">Alle Standardwerte</button></div>
    <div class="row"><b>Profile</b>
      <input type="text" class="cname" id="tbPName" placeholder="Name, z. B. Teich ruhig" maxlength="40" autocomplete="off">
      <button class="btn" data-b="pSave">Speichern</button>
      <select id="tbPSel" aria-label="Gespeicherte Profile"></select>
      <button class="btn" data-b="pLoad">In Entwurf laden</button>
      <button class="btn ghost" data-b="pDel">Löschen</button>
      <span class="grow"></span>
      <button class="btn ghost" data-b="export">Exportieren</button>
      <label class="btn ghost">Importieren<input type="file" id="tbImport" accept="application/json,.json"></label></div>`;

  function renderBar() {
    $('#tbRev').textContent = `Rev ${s.tune.rev}`;
    const same = sameSet(s.tune.cur, s.tune.good), g = $('#tbGood');
    g.textContent = same ? 'entspricht dem letzten guten Satz' : 'weicht vom letzten guten Satz ab';
    g.className = 'tag ' + (same ? 'ok' : 'warn');
    const n = M.TUNE_DEFS.filter(d => draft[d.key] !== s.tune.cur[d.key]).length, dr = $('#tbDraft');
    dr.textContent = n ? `Entwurf: ${n} Änderung${n > 1 ? 'en' : ''} nicht gesendet` : 'Entwurf = Boot';
    dr.className = 'tag' + (n ? ' warn' : '');
    document.querySelector('[data-b="sendAll"]').disabled = !n;
    document.querySelector('[data-b="discardAll"]').disabled = !n;
    document.querySelector('[data-b="restore"]').disabled = same;
    document.querySelector('[data-b="mark"]').disabled = same;
    const sel = $('#tbPSel'), cur = sel.value, list = profiles();
    const html = list.length ? list.map((p, i) => `<option value="${i}">${p.name.replace(/</g, '&lt;')}</option>`).join('') : '<option value="">(keine Profile)</option>';
    if (sel.dataset.h !== html) { sel.innerHTML = html; sel.dataset.h = html; if (cur) sel.value = cur; }
  }
  const loadIntoDraft = (vals, what) => {
    const v = M.tuneValidate(vals, s.tune.cur);
    if (!v.ok) return M.toast(v.errors[0], 'crit');
    draft = { ...draft, ...v.clean }; sync();
    M.toast(`${what} geladen – noch nicht gesendet`, 'info');
  };
  $('#tuneBar').addEventListener('click', async e => {
    const b = e.target.closest('[data-b]'); if (!b || b.disabled) return;
    const a = b.dataset.b;
    if (a === 'sendAll') sendGroups(GROUPS);
    else if (a === 'discardAll') { draft = { ...s.tune.cur }; sync(); }
    else if (a === 'mark') M.actions.tuneMarkGood();
    else if (a === 'restore') {
      const ok = await M.confirm({ title: 'Letzten guten Satz wiederherstellen?', text: 'Alle Regler- und Tuning-Werte im Boot werden durch den zuletzt als gut gemerkten Satz ersetzt.', confirmLabel: 'Wiederherstellen' });
      if (ok) M.actions.tuneRestore();
    } else if (a === 'defaults') {
      const ok = await M.confirm({ title: 'Alle Standardwerte laden?', text: 'Alle Regler- und Tuning-Werte im Boot werden auf die Startwerte zurückgesetzt. Den letzten guten Satz ändert das nicht.', confirmLabel: 'Standardwerte senden', danger: true });
      if (ok) { draft = { ...draft, ...M.tuneDefaults() }; M.actions.tuneDefaults(); sync(); }
    } else if (a === 'pSave') {
      const name = $('#tbPName').value.trim();
      if (!name) { $('#tbPName').focus(); return M.toast('Bitte einen Namen eingeben', 'warn'); }
      const list = profiles().filter(p => p.name !== name);
      list.push({ name, ts: Date.now(), values: { ...s.tune.cur } }); saveProfiles(list);
      $('#tbPName').value = ''; renderBar(); M.toast(`Profil «${name}» gespeichert (gesendeter Satz)`, 'ok');
    } else if (a === 'pLoad') {
      const p = profiles()[Number($('#tbPSel').value)]; if (!p) return;
      loadIntoDraft(p.values, `Profil «${p.name}»`);
    } else if (a === 'pDel') {
      const list = profiles(), i = Number($('#tbPSel').value); if (!list[i]) return;
      const ok = await M.confirm({ title: `Profil «${list[i].name}» löschen?`, text: 'Das Profil wird aus diesem Browser entfernt. Das Boot ist nicht betroffen.', confirmLabel: 'Löschen', danger: true });
      if (ok) { list.splice(i, 1); saveProfiles(list); renderBar(); }
    } else if (a === 'export') {
      M.download(`mfos-tuning-${new Date().toISOString().slice(0, 10)}.json`, 'application/json',
        JSON.stringify({ format: 'mfos-tune', version: 1, rev: s.tune.rev, values: s.tune.cur }, null, 2));
    }
  });
  $('#tbImport').addEventListener('change', e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(r.result);
        if (j.format !== 'mfos-tune' || typeof j.values !== 'object') throw new Error('Das ist keine Tuning-Datei von MFOS');
        const known = Object.fromEntries(Object.entries(j.values).filter(([k]) => M.TUNE_BY_KEY[k]));
        loadIntoDraft(known, `Datei «${f.name}»`);
      } catch (err) { M.toast('Import fehlgeschlagen: ' + err.message, 'crit'); }
    };
    r.readAsText(f);
  });

  /* =================== Sprungtest =================== */
  function lockReason() {
    if (run && run.playing) return 'Ein Test läuft';
    if (!s.online) return 'Boot offline';
    if (s.mode === 'ESTOP') return 'NOT-AUS aktiv';
    if (s.mode !== 'TUNE') return 'erst den Tuning-Modus starten';
    if (!s.armed) return 'Boot ist nicht scharf';
    return null;
  }
  let lockKey = '';
  function lockUpdate() {
    const r = lockReason(), key = String(r);
    if (key === lockKey) return; lockKey = key;
    $('#tuneCards').querySelectorAll('[data-act="test"]').forEach(b => { b.disabled = !!r; b.title = r ? 'Gesperrt: ' + r : ''; });
    if (!run) $('#tuneRunHint').innerHTML = r
      ? `<span class="warn-txt">Sprungtest gesperrt: ${r}.</span> Er läuft nur im Tuning-Modus bei scharfem Boot (Leiste oben).`
      : 'Wähle links bei einem Regler «Test starten». Der Test läuft mit dem <b>gesendeten</b> Satz, nicht mit dem Entwurf.';
  }

  async function startTest(g) {
    const reason = lockReason(); if (reason) return M.toast('Sprungtest gesperrt: ' + reason, 'warn');
    const size = testSize(g);
    if (size == null) return M.toast(`${g.test.label}: Wert ausserhalb von ${M.fmt(g.id === 'speed' ? M.spd(g.test.min) : g.test.min, 1)} bis ${M.fmt(g.id === 'speed' ? M.spd(g.test.max) : g.test.max, 1)}`, 'warn');
    const sc = M.tuneSim.SCEN[g.id], disp = g.id === 'speed' ? `${M.fmtSpd(size, 2)} ${M.spdUnit()}` : `${M.fmt(size, 0)} ${g.test.unit}`;
    const ok = await M.confirm({
      title: 'Sprungtest starten?',
      text: `${g.title}: ${g.test.text}${disp}. Das Boot reagiert sofort mit dem gesendeten Satz (Rev ${s.tune.rev}), Dauer etwa ${sc.pre + sc.dur} s. Der Test bricht bei NOT-AUS, Entschärfen, Ende des Tuning-Modus und Verbindungsverlust ab.`,
      check: 'Das Boot ist im Blick und der NOT-AUS in Reichweite.', confirmLabel: 'Test starten'
    });
    if (!ok) return;
    if (changedKeys(g).length) M.toast('Der Test läuft mit dem gesendeten Satz, nicht mit dem Entwurf', 'warn');
    const sent = M.actions.tuneStep(`Sprungtest ${g.title}`, () => {
      if (lockReason() && !(run && run.playing)) return M.toast('Sprungtest nicht gestartet: ' + lockReason(), 'warn');
      play(g, size, M.tuneSim.run(g.id, size, { ...s.tune.cur }, { gpsHz: Number($('#tuneGps').value) }), s.tune.rev, disp);
    });
    if (!sent) return;
    $('#tuneRunTag').textContent = 'wartet auf Quittung'; $('#tuneRunTag').className = 'tag warn';
  }

  /* Wiedergabe: der berechnete Verlauf wird in wenigen Sekunden aufgebaut. */
  let timer = null;
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function play(g, size, res, rev, disp) {
    stopTimer(); ensureCharts();
    run = { g, res, i: 0, playing: true, rev };
    $('#tuneRunTitle').textContent = `${g.title}: ${g.test.text}${disp}`;
    $('#tuneRunHint').textContent = `Gesendeter Satz, Rev ${rev}. Gestrichelt: Sollwert, Linie 0 s = Sprung.`;
    $('#tuneMetrics').innerHTML = ''; $('#tuneVerdict').innerHTML = '';
    setTag('läuft …', 'warn'); $('#tuneAbort').disabled = false;
    setupAxes(g, res);
    const total = res.t.length, stepN = Math.max(2, Math.ceil(total / 90));
    M.log(`Sprungtest gestartet: ${g.title}`);
    lockKey = ''; lockUpdate();
    timer = setInterval(() => {
      const why = abortReason();
      if (why) return abort(why);
      run.i = Math.min(total, run.i + stepN); draw();
      if (run.i >= total) finish();
    }, 45);
  }
  function abortReason() {
    if (!run || !run.playing) return null;
    if (!s.online) return 'Verbindung verloren';
    if (s.mode === 'ESTOP') return 'NOT-AUS';
    if (!s.armed) return 'Boot entschärft';
    if (s.mode !== 'TUNE') return 'Tuning-Modus beendet';
    if (M.currentView !== 'tuning') return 'Seite verlassen';
    return null;
  }
  function abort(why) {
    if (!run || !run.playing) return;
    stopTimer(); run.playing = false; run.aborted = why;
    setTag('abgebrochen', 'crit'); $('#tuneAbort').disabled = true;
    $('#tuneVerdict').innerHTML = `<li class="c">Sprungtest abgebrochen: ${why}. Das Boot kehrt zur normalen Regelung zurück.</li>`;
    M.log(`Sprungtest abgebrochen: ${why}`, 'warn'); M.toast(`Sprungtest abgebrochen: ${why}`, why === 'Seite verlassen' ? 'info' : 'warn');
    lockKey = ''; lockUpdate();
  }
  $('#tuneAbort').addEventListener('click', () => abort('von dir abgebrochen'));
  function setTag(txt, cls) { const t = $('#tuneRunTag'); t.textContent = txt; t.className = 'tag' + (cls ? ' ' + cls : ''); }

  function finish() {
    stopTimer(); run.playing = false; $('#tuneAbort').disabled = true;
    const r = run.res, m = r.metrics, g = run.g, spd = g.id === 'speed', cv = v => (spd ? M.spd(v) : v), u = spd ? M.spdUnit() : r.scen.unit;
    const tile = (l, v, un) => `<div class="stat"><label>${l}</label><b>${v}</b><small>${un}</small></div>`;
    $('#tuneMetrics').innerHTML = m.unstable ? '' :
      tile('Anstiegszeit', m.rise == null ? '–' : M.fmt(m.rise, 1), 's') +
      tile('Überschwingen', M.fmt(m.overshoot, 0), '%') +
      tile('Beruhigungszeit', m.settle == null ? 'nie' : M.fmt(m.settle, 1), m.settle == null ? '' : 's') +
      tile('Bleibende Abw.', M.fmt(Math.abs(cv(m.sse)), spd ? 2 : 1), u);
    const v = [];
    if (m.unstable || r.unstable) v.push(['c', 'Der Regelkreis schwingt sich auf (instabil). Verstärkungen verkleinern, besonders Kp.']);
    else {
      if (m.overshoot > 25) v.push(['w', `Starkes Überschwingen (${M.fmt(m.overshoot, 0)} %): Kp verkleinern oder mehr Dämpfung.`]);
      if (m.settle == null) v.push(['w', 'Der Verlauf beruhigt sich im Testzeitraum nicht (±5 %). Ki prüfen oder Kp senken.']);
      if (m.rise != null && m.rise > r.scen.dur / 2) v.push(['w', 'Sehr träge: Kp oder Vorsteuerung erhöhen.']);
      if (Math.abs(m.sse) > 0.05 * Math.abs(r.sp[r.sp.length - 1] - r.pv[0] || 1) && m.settle != null) v.push(['w', 'Bleibende Abweichung: Ki erhöhen (oder mehr Zeit).']);
      if ((g.id === 'speed' || g.id === 'track') && m.rise != null && m.rise * r.gpsHz < 4) v.push(['w', `Nur ${M.fmt(m.rise * r.gpsHz, 0)} GPS-Messpunkte im Anstieg (GPS ${r.gpsHz} Hz): Kennzahlen unsicher, GPS-Rate erhöhen.`]);
      if (r.limited > 0.5) v.push(['w', `Die Stellgrösse war ${M.fmt(r.limited, 1)} s am Anschlag: Grenzen oder Verstärkung prüfen.`]);
      if (!v.length) v.push(['o', 'Unauffällig: kein starkes Überschwingen, beruhigt sich, keine Dauer-Abweichung.']);
    }
    $('#tuneVerdict').innerHTML = v.map(([c, t]) => `<li class="${c}">${t}</li>`).join('');
    setTag('fertig', m.unstable ? 'crit' : v[0][0] === 'o' ? 'ok' : 'warn');
    M.log(`Sprungtest beendet: ${g.title}`, 'ok');
    lockKey = ''; lockUpdate();
  }

  /* =================== Diagramme =================== */
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function ensureCharts() {
    if (chMain) return;
    const pal = { text: css('--muted'), grid: css('--line'), c1: css('--accent'), c2: css('--warn'), c3: css('--ok'), c4: css('--crit') };
    Chart.defaults.color = pal.text; Chart.defaults.font.size = 11;
    const ds = (label, col, extra) => ({ label, borderColor: col, backgroundColor: col, borderWidth: 2, pointRadius: 0, tension: 0.15, data: [], ...extra });
    const opts = y2 => ({
      animation: false, responsive: true, maintainAspectRatio: false, parsing: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, labels: { boxWidth: 12, boxHeight: 2 } }, tooltip: { enabled: true } },
      scales: {
        x: { type: 'linear', grid: { color: pal.grid }, title: { display: true, text: 'Zeit seit Sprung [s]' }, ticks: { maxTicksLimit: 8 } },
        y: { grid: { color: pal.grid }, title: { display: true, text: '' } },
        ...(y2 ? { y2: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '' } } } : {})
      }
    });
    chMain = new Chart($('#chTuneMain'), { type: 'line', data: { datasets: [
      ds('Soll', pal.c2, { borderDash: [6, 4] }), ds('Ist', pal.c1), ds('Ausgang', pal.c3, { yAxisID: 'y2', borderWidth: 1.5 })] }, options: opts(true) });
    chParts = new Chart($('#chTuneParts'), { type: 'line', data: { datasets: [
      ds('P', pal.c1), ds('I', pal.c2), ds('D', pal.c4), ds('Vorsteuerung', pal.c3, { borderDash: [3, 3] })] }, options: opts(false) });
    if (run) { setupAxes(run.g, run.res); draw(); }
  }
  function setupAxes(g, res) {
    const sc = res.scen, spd = g.id === 'speed', u = spd ? M.spdUnit() : sc.unit;
    chMain.data.datasets[0].label = `${sc.sp} [${u}]`;
    chMain.data.datasets[1].label = `${sc.pv} [${u}]`;
    chMain.data.datasets[2].label = `${sc.out} [${sc.outUnit}]`;
    chMain.options.scales.y.title.text = u; chMain.options.scales.y2.title.text = sc.outUnit;
    chParts.options.scales.y.title.text = sc.outUnit;
    chParts.data.datasets.forEach(d => { d.data = []; }); chMain.data.datasets.forEach(d => { d.data = []; });
    chMain.update('none'); chParts.update('none');
  }
  function draw() {
    if (!run || !chMain) return;
    const r = run.res, n = run.i, spd = run.g.id === 'speed', cv = v => (spd ? M.spd(v) : v);
    const pts = (arr, f) => { const o = []; for (let i = 0; i < n; i++) o.push({ x: r.t[i], y: f ? f(arr[i]) : arr[i] }); return o; };
    chMain.data.datasets[0].data = pts(r.sp, cv); chMain.data.datasets[1].data = pts(r.pv, cv); chMain.data.datasets[2].data = pts(r.out);
    chParts.data.datasets[0].data = pts(r.p); chParts.data.datasets[1].data = pts(r.i); chParts.data.datasets[2].data = pts(r.d); chParts.data.datasets[3].data = pts(r.ff);
    chMain.update('none'); chParts.update('none');
  }
  function rebuildCharts() {
    if (chMain) { chMain.destroy(); chParts.destroy(); chMain = chParts = null; }
    if (M.currentView === 'tuning') ensureCharts();
  }

  /* =================== Ereignisse =================== */
  M.on('tune', () => {                                // Satz im Boot hat sich geaendert: unveraenderte Entwurfswerte mitziehen
    M.TUNE_DEFS.forEach(d => { if (draft[d.key] === lastCur[d.key]) draft[d.key] = s.tune.cur[d.key]; });
    lastCur = { ...s.tune.cur }; sync();
  });
  M.on('tick', () => { if (M.currentView === 'tuning') { renderMode(); lockUpdate(); const w = abortReason(); if (w) abort(w); } });
  M.on('units', () => { syncTest(); if (run && chMain) { setupAxes(run.g, run.res); draw(); } });
  M.on('theme', rebuildCharts);
  M.on('view', id => {
    if (id === 'tuning') { ensureCharts(); sync(); renderMode(); setTimeout(() => { if (chMain) { chMain.resize(); chParts.resize(); } }, 30); }
    else {
      if (run && run.playing) abort('Seite verlassen');
      if (s.mode === 'TUNE') { M.actions.tuneLeave('Seite verlassen'); M.toast('Tuning-Modus beendet, Boot entschärft', 'info'); }
    }
  });
  M.on('tick', renderMode);

  /* =================== Tuning-Modus (Leiste oben) =================== */
  let modeKey = '';
  function renderMode() {
    if (M.currentView !== 'tuning') return;
    const m = s.mode === 'TUNE', est = s.mode === 'ESTOP';
    const key = [m, s.armed, est, s.online, s.test.active, s.mode].join('|');
    if (key === modeKey) return; modeKey = key;
    let blockWhy = null;
    if (!m) blockWhy = !s.online ? 'Boot offline' : est ? 'NOT-AUS aktiv – erst freigeben' : s.test.active ? 'Testmodus aktiv' : s.armed ? 'Boot ist scharf – erst entschärfen' : s.mode !== 'STOP' ? 'Boot fährt – erst stoppen' : null;
    $('#tuneMode').classList.toggle('on', m);
    $('#tuneMode').innerHTML = m
      ? `<div><b class="warn-txt">Tuning-Modus aktiv</b><div class="muted small">${s.armed ? '<b class="ok-txt">Scharf</b>: Sprungtests sind freigegeben.' : 'Boot ist <b>nicht scharf</b>. Schalte es scharf, um Sprungtests zu fahren.'} Verlässt du die Seite, wird der Tuning-Modus beendet und das Boot entschärft.</div></div>
         <span class="grow"></span>
         <button class="btn ${s.armed ? 'ghost' : 'primary'}" data-m="${s.armed ? 'disarm' : 'arm'}" ${est ? 'disabled' : ''}>${s.armed ? 'Entschärfen' : 'Scharf schalten'}</button>
         <button class="btn" data-m="leave">Tuning-Modus beenden</button>`
      : `<div><b>Tuning-Modus</b><div class="muted small">${blockWhy ? `<span class="warn-txt">Gesperrt: ${blockWhy}</span>` : 'Für Sprungtests: Tuning-Modus starten, dann das Boot hier scharf schalten (mit Checkliste). Eine Mission ist dafür nicht nötig.'}</div></div>
         <span class="grow"></span><button class="btn primary" data-m="enter" ${blockWhy ? 'disabled' : ''}>Tuning-Modus starten</button>`;
    lockKey = ''; lockUpdate();
  }
  $('#tuneMode').addEventListener('click', async e => {
    const b = e.target.closest('[data-m]'); if (!b || b.disabled) return;
    if (b.dataset.m === 'enter') M.actions.tuneEnter();
    else if (b.dataset.m === 'leave') { if (run && run.playing) abort('Tuning-Modus beendet'); M.actions.tuneLeave('Beendet'); }
    else if (b.dataset.m === 'disarm') M.actions.disarm();
    else if (b.dataset.m === 'arm') { if (await M.preflight('tune')) M.actions.arm(); }
  });

  build();
})();
