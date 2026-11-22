/* ===================================================================
   view-control.js  –  Ansicht «Einstellungen»
   Verbindung (LTE/WLAN, WLAN-Zugang), alle Parameter, Zaehler-Resets
   (Licht und Kuehlpumpe werden in Live → Einstellungen geschaltet)
   =================================================================== */
(function () {
  'use strict';
  const M = window.MFOS, s = M.state, $ = M.$;
  let draft = M.clone(s.params);
  const fmtDate = ms => new Date(ms).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  /* =================== Verbindung =================== */
  function renderNet() {
    const n = s.net, wf = n.wifi;
    const tag = $('#netTag');
    tag.textContent = n.active === 'wifi' ? `Verbunden über WLAN «${wf.ssid}»` : n.active === 'lte' ? 'Verbunden über LTE' : 'Keine Verbindung';
    tag.className = 'tag ' + (n.active === 'none' ? 'warn' : 'ok');

    $('#netMode').querySelectorAll('.chip').forEach(b => {
      b.classList.toggle('active', b.dataset.nm === n.mode);
      if (b.dataset.nm === 'wifi') b.disabled = !(wf.saved && wf.state === 'ok');
    });
    $('#netHint').textContent = {
      auto: 'Empfohlen: Zuhause über WLAN, unterwegs automatisch LTE. Fällt das WLAN aus, wechselt das Boot selbst auf LTE.',
      lte: 'Das Boot nutzt immer LTE, auch wenn ein WLAN bekannt ist.',
      wifi: 'Achtung: Ohne WLAN-Empfang ist das Boot nicht erreichbar (kein LTE-Fallback).'
    }[n.mode];

    const row = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
    $('#netInfo').innerHTML =
      row('Aktiv', n.active === 'wifi' ? 'WLAN' : n.active === 'lte' ? 'LTE' : 'keine') +
      row('WLAN', wf.saved ? `${wf.ssid} · ${wf.ip} · ${wf.rssi.toFixed(0)} dBm` : 'nicht eingerichtet') +
      row('LTE', `${s.lte.operator} · ${s.lte.tech} · ${s.lte.dbm.toFixed(0)} dBm`) +
      row('Zuletzt gewechselt', n.switchedAt ? fmtDate(n.switchedAt) : '–');

    const ssid = $('#wSsid');
    if (document.activeElement !== ssid && !ssid.value) ssid.value = wf.ssid;
    $('#wPass').placeholder = wf.saved ? '•••••••• (gespeichert)' : 'Passwort';
    $('#wConnect').disabled = wf.state === 'connecting';
    $('#wConnect').textContent = wf.state === 'connecting' ? 'Verbinde …' : 'Speichern & verbinden';
    $('#wForget').disabled = !wf.saved;
    const msg = $('#wMsg');
    if (wf.error) { msg.textContent = wf.error; msg.className = 'warn-txt small'; }
    else if (wf.saved) { msg.textContent = `«${wf.ssid}» ist im Boot gespeichert. Das Passwort wird nie wieder angezeigt.`; msg.className = 'muted small'; }
    else { msg.textContent = 'Noch kein WLAN eingerichtet. Der ESP32 kann nur 2,4-GHz-Netze (kein 5 GHz).'; msg.className = 'muted small'; }
  }

  $('#netMode').addEventListener('click', async e => {
    const b = e.target.closest('[data-nm]'); if (!b || b.disabled || b.dataset.nm === s.net.mode) return;
    if (b.dataset.nm === 'wifi') {
      const ok = await M.confirm({
        title: 'Nur WLAN verwenden?',
        text: 'Ohne WLAN-Empfang ist das Boot dann nicht mehr erreichbar. Es gibt keinen automatischen Wechsel auf LTE.',
        check: 'Ich habe verstanden, dass das Boot ohne WLAN unerreichbar ist.', confirmLabel: 'Nur WLAN', danger: true
      });
      if (!ok) return;
    }
    M.actions.setNetMode(b.dataset.nm);
  });
  $('#wShow').addEventListener('click', () => {
    const p = $('#wPass'), show = p.type === 'password';
    p.type = show ? 'text' : 'password'; $('#wShow').textContent = show ? 'Verbergen' : 'Zeigen';
  });
  $('#wConnect').addEventListener('click', () => {
    const ssid = $('#wSsid').value.trim(), pass = $('#wPass').value;
    if (!ssid) { $('#wSsid').focus(); return M.toast('Bitte den WLAN-Namen eingeben', 'warn'); }
    if (pass.length < 8) { $('#wPass').focus(); return M.toast('WLAN-Passwort: mindestens 8 Zeichen (WPA2)', 'warn'); }
    M.actions.setWifi(ssid, pass);
    $('#wPass').value = '';                         // das Passwort bleibt nirgends im Dashboard stehen
    $('#wPass').type = 'password'; $('#wShow').textContent = 'Zeigen';
  });
  $('#wForget').addEventListener('click', async () => {
    const ok = await M.confirm({ title: 'WLAN vergessen?', text: `Das Boot löscht «${s.net.wifi.ssid}» und nutzt danach nur noch LTE.`, confirmLabel: 'Vergessen', danger: true });
    if (ok) { M.actions.forgetWifi(); $('#wSsid').value = ''; }
  });
  M.on('net', renderNet);

  /* =================== Parameter =================== */
  function renderParams() {
    const groups = {};
    M.PARAM_DEFS.forEach(d => (groups[d.group] = groups[d.group] || []).push(d));
    const consume = `
      <div class="consume">
        <div class="kv">
          <div><span>Verbraucht</span><b id="pcUsed">–</b></div>
          <div><span>Zähler seit</span><b id="pcSince">–</b></div>
        </div>
        <button class="btn" data-reset="consume">Verbrauchszähler zurücksetzen</button>
        <p class="muted small">Nach dem Laden oder bei neuem Akku auf 0 setzen, sonst stimmen Restlaufzeit und Verbrauch nicht.</p>
      </div>`;
    const lte = `
      <div class="consume">
        <div class="kv">
          <div><span>Heute</span><b id="pdToday">–</b></div>
          <div><span>Seit Reset</span><b id="pdSince">–</b></div>
          <div><span>Gesamt</span><b id="pdTotal">–</b></div>
          <div><span>Zähler seit</span><b id="pdReset">–</b></div>
        </div>
        <button class="btn" data-reset="lte">LTE-Datenzähler zurücksetzen</button>
        <p class="muted small">Schätzung des Boots (Nutzdaten plus Zuschlag). Verbindlich ist die Anzeige deines SIM-Anbieters. Über WLAN wird nichts gezählt.</p>
      </div>`;
    $('#paramGroups').innerHTML = Object.entries(groups).map(([g, defs]) => `
      <div class="param-group"><h4>${g}</h4><div class="form">
        ${defs.map(d => M.paramField(d, draft[d.key], draft[d.key] !== s.params[d.key])).join('')}
      </div>${g === 'Akku' ? consume : g === 'LTE-Daten' ? lte : ''}</div>`).join('');
    updateCounters();
    const n = M.PARAM_DEFS.filter(d => draft[d.key] !== s.params[d.key]).length;
    const tag = $('#pSync');
    if (s.paramSync === 'pending') { tag.textContent = 'Wird übertragen…'; tag.className = 'tag warn'; }
    else if (n) { tag.textContent = `${n} Änderung${n > 1 ? 'en' : ''} – nicht gesendet`; tag.className = 'tag warn'; }
    else { tag.textContent = 'Auf Boot aktiv'; tag.className = 'tag ok'; }
    $('#pSend').disabled = !n || s.paramSync === 'pending';
    $('#pReset').disabled = !n;
  }

  function updateCounters() {
    const u = $('#pcUsed');
    if (u) {
      u.textContent = `${s.power.mah.toFixed(0)} mAh · ${s.power.wh.toFixed(1)} Wh`;
      $('#pcSince').textContent = s.power.resetAt ? fmtDate(s.power.resetAt) : 'Start des Boots';
    }
    if ($('#pdToday')) {
      $('#pdToday').textContent = s.data.today.toFixed(1) + ' MB';
      $('#pdSince').textContent = `${s.data.sinceReset.toFixed(1)} MB (${(s.data.sinceReset / s.params.dataLimit * 100).toFixed(0)} %)`;
      $('#pdTotal').textContent = s.data.total.toFixed(0) + ' MB';
      $('#pdReset').textContent = fmtDate(s.data.resetAt);
    }
  }
  $('#paramGroups').addEventListener('click', async e => {
    const b = e.target.closest('[data-reset]'); if (!b) return;
    if (b.dataset.reset === 'consume') {
      const ok = await M.confirm({
        title: 'Verbrauchszähler zurücksetzen?',
        text: 'Setzt die verbrauchten mAh und Wh auf 0. Die Restlaufzeit rechnet dann wieder mit vollem Akku.',
        confirmLabel: 'Zurücksetzen', danger: true
      });
      if (ok) M.actions.resetConsumption();
    } else {
      const ok = await M.confirm({
        title: 'LTE-Datenzähler zurücksetzen?',
        text: 'Setzt den Verbrauch «seit Reset» auf 0, zum Beispiel zum Monatsanfang. «Gesamt» bleibt erhalten.',
        confirmLabel: 'Zurücksetzen', danger: true
      });
      if (ok) M.actions.resetLteData();
    }
  });
  M.on('tick', () => { if (M.currentView === 'control') { updateCounters(); renderNet(); } });
  $('#paramGroups').addEventListener('change', e => {
    const inp = e.target.closest('[data-key]'); if (!inp) return;
    const d = M.PARAM_DEFS.find(x => x.key === inp.dataset.key);
    draft[d.key] = M.readParam(d, inp);
    renderParams();
  });
  $('#pSend').addEventListener('click', () => {
    if (draft.pumpOff >= draft.pumpOn) return M.toast('Pumpe «aus unter» muss kleiner sein als «ein ab»', 'warn');
    M.actions.sendParams(draft);
  });
  $('#pReset').addEventListener('click', () => { draft = M.clone(s.params); renderParams(); });

  M.on('units', () => { if (M.currentView === 'control') renderParams(); });
  M.on('params', () => { if (s.paramSync === 'ok') draft = M.clone(s.params); renderParams(); });
  M.on('view', id => { if (id === 'control') { renderParams(); renderNet(); } });
})();
