/* ===================================================================
   view-tests.js  –  Reiter «Tests»: Aktoren einzeln pruefen
                     Motor/ESC, Ruder-Servo, Kuehlpumpe, Lichter
   Sicherheit: Testmodus nur bei entschaerftem, gestopptem Boot und
   mit Bestaetigung. Motor laeuft nur gedrueckt (bis 100 %, max. 10 s),
   Pumpe max. 30 s, beim Verlassen des Reiters geht alles aus.
   =================================================================== */
(function () {
  'use strict';
  const M = window.MFOS, s = M.state, $ = M.$;
  const LIGHTS = [
    ['red', 'Rot (Backbord)', '#ff4d5d'], ['green', 'Grün (Steuerbord)', '#35e08a'],
    ['white1', 'Weiss 1 (Mast)', '#ffffff'], ['white2', 'Weiss 2 (Mast)', '#ffffff']
  ];
  let gateKey = '', sweepTimer = null, holding = false;

  /* ---------- Testmodus-Schalter ---------- */
  function lockReason() {
    if (!s.online) return 'Boot offline';
    if (s.armed) return 'Boot ist scharf – erst entschärfen';
    if (s.mode === 'ESTOP') return 'NOT-AUS aktiv – erst freigeben';
    if (s.mode !== 'STOP') return 'Boot fährt – erst stoppen';
    return null;
  }
  function renderGate() {
    const t = s.test, reason = lockReason(), key = t.active + '|' + reason;
    if (key !== gateKey) {                      // nur bei Aenderung neu zeichnen (sonst gehen Klicks verloren)
      gateKey = key;
      const g = $('#testGate');
      g.classList.toggle('on', t.active);
      g.innerHTML = t.active
        ? `<div><b class="warn-txt">Testmodus aktiv</b><div class="muted small">Seit <span id="tSince">0:00</span> · endet nach 5 min ohne Bedienung oder beim Verlassen des Reiters</div></div>
           <span class="grow"></span><button class="btn danger" data-g="alloff">Alle Ausgänge aus</button><button class="btn" data-g="end">Testmodus beenden</button>`
        : `<div><b>Aktoren testen</b><div class="muted small">${reason ? `<span class="warn-txt">Gesperrt: ${reason}</span>` : 'Antrieb, Ruder, Pumpe und Lichter einzeln ansteuern. Das Boot muss gesichert sein.'}</div></div>
           <span class="grow"></span><button class="btn primary" data-g="start" ${reason ? 'disabled' : ''}>Testmodus starten</button>`;
    }
    $('#testGrid').classList.toggle('locked', !t.active);
    const since = $('#tSince'); if (since) since.textContent = M.fmtDur((s.now - t.since) / 1000);
  }
  $('#testGate').addEventListener('click', async e => {
    const b = e.target.closest('[data-g]'); if (!b) return;
    if (b.dataset.g === 'start') {
      const ok = await M.confirm({
        title: 'Testmodus starten?',
        text: 'Motor, Ruder, Pumpe und Lichter lassen sich dann direkt ansteuern. Das Boot fährt dabei nicht los.',
        check: 'Das Boot ist gesichert (fest montiert oder gehalten), der Propeller ist frei und niemand greift hinein.',
        confirmLabel: 'Testmodus starten'
      });
      if (ok) M.actions.testStart();
    } else if (b.dataset.g === 'end') M.actions.testEnd('Beendet');
    else if (b.dataset.g === 'alloff') allOff();
  });

  function allOff() {
    stopSweep();
    M.actions.testSet('motor', 0); M.actions.testSet('servo', 50); M.actions.testSet('pump', null);
    LIGHTS.forEach(([ch]) => M.actions.testSet('light', 0, { ch }));
    M.log('Test: alle Ausgänge aus'); renderControls();
  }

  /* ---------- Motor ---------- */
  const power = () => Number($('#tMotorPower').value);
  $('#tMotorPower').addEventListener('input', e => {
    $('#tMotorPowerTxt').textContent = e.target.value + ' %';
    if (s.test.motor > 0) M.actions.testSet('motor', power(), { ms: holding ? 10000 : 2000 });
  });
  const hold = $('#tMotorHold');
  const press = e => { e.preventDefault(); if (holding) return; holding = true; hold.setPointerCapture && hold.setPointerCapture(e.pointerId); hold.classList.add('pressed'); M.log(`Test: Motor ${power()} % (gehalten)`); M.actions.testSet('motor', power(), { ms: 10000 }); };
  const release = () => { if (!holding) return; holding = false; hold.classList.remove('pressed'); M.actions.testSet('motor', 0); M.log('Test: Motor aus'); };
  hold.addEventListener('pointerdown', press);
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => hold.addEventListener(ev, release));
  hold.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) press(e); });
  hold.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') release(); });
  $('#tMotorPulse').addEventListener('click', () => { M.log(`Test: Motor-Impuls ${power()} % für 2 s`); M.actions.testSet('motor', power(), { ms: 2000 }); });
  $('#tMotorStop').addEventListener('click', () => { M.actions.testSet('motor', 0); M.log('Test: Motor aus'); });

  /* ---------- Servo ---------- */
  const servoTxt = v => v === 50 ? 'Mitte' : v < 50 ? `Links ${(50 - v) * 2} %` : `Rechts ${(v - 50) * 2} %`;
  function setServo(v, fromSweep) {
    v = Math.round(v);
    $('#tServo').value = v; $('#tServoTxt').textContent = servoTxt(v);
    M.actions.testSet('servo', v);
    if (!fromSweep) stopSweep();
  }
  $('#tServo').addEventListener('input', e => setServo(Number(e.target.value)));
  $('#tServoL').addEventListener('click', () => { M.log('Test: Ruder links'); setServo(0); });
  $('#tServoC').addEventListener('click', () => { M.log('Test: Ruder Mitte'); setServo(50); });
  $('#tServoR').addEventListener('click', () => { M.log('Test: Ruder rechts'); setServo(100); });
  function stopSweep() {
    if (!sweepTimer) return;
    clearInterval(sweepTimer); sweepTimer = null;
    $('#tServoSweep').textContent = 'Schwenktest';
  }
  $('#tServoSweep').addEventListener('click', () => {
    if (sweepTimer) { stopSweep(); setServo(50); return; }
    M.log('Test: Ruder-Schwenktest');
    const t0 = Date.now();
    $('#tServoSweep').textContent = 'Schwenktest stoppen';
    sweepTimer = setInterval(() => {
      const t = (Date.now() - t0) / 6000;                         // ein Durchlauf in 6 s: Mitte → links → rechts → Mitte
      if (t >= 1 || !s.test.active) { stopSweep(); setServo(50); return; }
      setServo(50 - 50 * Math.sin(t * 2 * Math.PI), true);
    }, 100);
  });

  /* ---------- Pumpe ---------- */
  $('#tPumpChips').addEventListener('click', e => {
    const b = e.target.closest('[data-tp]'); if (!b) return;
    const v = { on: true, off: false, auto: null }[b.dataset.tp];
    M.log(`Test: Pumpe ${{ on: 'ein (30 s)', off: 'aus', auto: 'normal (Auto)' }[b.dataset.tp]}`);
    M.actions.testSet('pump', v); renderControls();
  });

  $('#tPumpSpeed').addEventListener('input', e => {
    $('#tPumpSpeedTxt').textContent = e.target.value + ' %';
    M.actions.testSet('pumpSpeed', Number(e.target.value));
  });

  /* ---------- Lichter ---------- */
  $('#tLights').innerHTML = LIGHTS.map(([ch, name, col]) => `
    <div class="lt-row" data-ch="${ch}">
      <span class="sw" style="--c:${col}"></span><span>${name}</span>
      <input type="range" min="0" max="100" step="5" value="0" aria-label="${name} Helligkeit">
      <b>0 %</b>
      <label class="switch"><input type="checkbox" aria-label="${name} an/aus"><span></span></label>
    </div>`).join('');
  $('#tLights').addEventListener('input', e => {
    const row = e.target.closest('.lt-row'); if (!row || e.target.type !== 'range') return;
    M.actions.testSet('light', Number(e.target.value), { ch: row.dataset.ch }); renderControls();
  });
  $('#tLights').addEventListener('change', e => {
    const row = e.target.closest('.lt-row'); if (!row || e.target.type !== 'checkbox') return;
    const v = e.target.checked ? 100 : 0;
    M.log(`Test: ${row.querySelector('span:nth-child(2)').textContent} ${v ? 'an' : 'aus'}`);
    M.actions.testSet('light', v, { ch: row.dataset.ch }); renderControls();
  });
  const allLights = v => { LIGHTS.forEach(([ch]) => M.actions.testSet('light', v, { ch })); M.log(`Test: alle Lichter ${v ? 'an' : 'aus'}`); renderControls(); };
  $('#tLightsAll').addEventListener('click', () => allLights(100));
  $('#tLightsNone').addEventListener('click', () => allLights(0));

  /* ---------- Anzeige ---------- */
  function renderControls() {
    const t = s.test;
    $('#tMotorNow').textContent = M.fmt(t.active ? t.motor : s.cmd.throttle, 0) + ' %';
    $('#tEscNow').textContent = M.fmt(s.temps.esc, 1) + ' °C';
    if (!sweepTimer) { $('#tServo').value = t.servo; $('#tServoTxt').textContent = servoTxt(t.servo); }
    const st = $('#tPumpState');
    st.textContent = s.pump.on ? 'LÄUFT' : 'AUS'; st.className = 'pump-state' + (s.pump.on ? ' on' : '');
    $('#tPumpChips').querySelectorAll('.chip').forEach(b => {
      const k = t.pump === true ? 'on' : t.pump === false ? 'off' : 'auto';
      b.classList.toggle('active', b.dataset.tp === k);
    });
    $('#tPumpAmp').textContent = M.fmt(s.power.a, 1) + ' A';       // es gibt nur den INA226-Gesamtstrom, keinen Pumpenstrom
    if (document.activeElement !== $('#tPumpSpeed')) {
      const v = M.pumpSpeed(); $('#tPumpSpeed').value = v; $('#tPumpSpeedTxt').textContent = v + ' %';
    }
    $('#tPumpMode').textContent = { auto: 'Auto', on: 'Ein', off: 'Aus' }[s.pump.mode];
    $('#tLights').querySelectorAll('.lt-row').forEach(row => {
      const v = t.lights[row.dataset.ch], sw = row.querySelector('.sw');
      const rg = row.querySelector('input[type=range]'), cb = row.querySelector('input[type=checkbox]');
      if (document.activeElement !== rg) rg.value = v;
      cb.checked = v > 0; row.querySelector('b').textContent = v + ' %';
      const c = sw.style.getPropertyValue('--c');
      sw.style.background = v > 0 ? c : ''; sw.style.boxShadow = v > 0 ? `0 0 ${4 + v / 8}px ${c}` : ''; sw.style.opacity = v > 0 ? .35 + v / 160 : 1;
    });
  }

  function renderTiles() {
    const tile = (l, v, u) => `<div class="tile"><label>${l}</label><b>${v}</b><small>${u}</small></div>`;
    $('#tTiles').innerHTML =
      tile('Spannung', M.fmt(s.power.v, 2), 'V') + tile('Strom', M.fmt(s.power.a, 1), 'A') + tile('Leistung', M.fmt(s.power.w, 0), 'W') +
      tile('ESC', M.fmt(s.temps.esc, 1), '°C') + tile('Innenraum', M.fmt(s.temps.hull, 1), '°C');
    const ev = s.eventLog.filter(e => /^Test|^Befehl: Testmodus/.test(e.text)).slice(0, 10);
    $('#tLog').innerHTML = '<tr><th>Zeit</th><th>Ereignis</th></tr>' + (ev.length
      ? ev.map(e => `<tr><td class="mono">${M.fmtTime(e.t)}</td><td>${e.text}</td></tr>`).join('')
      : '<tr><td colspan="2" class="muted">Noch keine Tests</td></tr>');
  }

  const refresh = () => { renderGate(); renderControls(); renderTiles(); };
  M.on('tick', () => { if (M.currentView === 'tests') refresh(); });
  M.on('test', () => { if (!s.test.active) { stopSweep(); holding = false; hold.classList.remove('pressed'); } if (M.currentView === 'tests') refresh(); });
  M.on('log', () => { if (M.currentView === 'tests') renderTiles(); });
  M.on('view', id => {
    if (id === 'tests') refresh();
    else if (s.test.active) M.actions.testEnd('Ansicht verlassen');          // beim Verlassen geht alles aus
  });
})();
