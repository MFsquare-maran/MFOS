/* ===================================================================
   state.js  –  Simuliertes Boot (Mockup)
   -------------------------------------------------------------------
   Ersetzt spaeter die echte Datenquelle (ThingsBoard / MQTT).
   Alles, was die Views brauchen, steht in MFOS.state; Aenderungen
   werden ueber MFOS.on('tick' | 'alarms' | 'mission' | 'params' ...)
   gemeldet.  Die Namen in state.power / state.temps etc. entsprechen
   den Telemetrie-Schluesseln aus docs/schnittstelle.md (Vertrag Boot <-> Dashboard).
   =================================================================== */
(function () {
  'use strict';
  const M = (window.MFOS = window.MFOS || {});

  /* ---------- Mini-Eventbus ---------- */
  const handlers = {};
  M.on = (ev, fn) => (handlers[ev] = handlers[ev] || []).push(fn);
  M.emit = (ev, ...a) => (handlers[ev] || []).forEach(fn => fn(...a));

  /* ---------- Geo-Helfer ---------- */
  const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
  const R = 6371000;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const wrap180 = a => ((((a + 180) % 360) + 360) % 360) - 180;
  M.clamp = clamp;
  M.geo = {
    dist(a, b) {
      const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    },
    bearing(a, b) {
      const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
      const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
                Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
      return (toDeg(Math.atan2(y, x)) + 360) % 360;
    },
    move(p, brg, d) {
      const dr = d / R, b = toRad(brg), la = toRad(p.lat), lo = toRad(p.lon);
      const la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(b));
      const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(la2));
      return { lat: toDeg(la2), lon: toDeg(lo2) };
    },
    wrap180
  };

  /* ---------- Parameter-Definitionen (Steuerung + Mission) ---------- */
  M.PARAM_DEFS = [
    { key: 'cruiseSpeed', group: 'Navigation', label: 'Reisegeschwindigkeit', type: 'speed', min: 1, max: 14, step: 0.5, def: 5.6, hint: 'Tempo auf Mission und Return Home' },
    { key: 'maxThrottle', group: 'Navigation', label: 'Maximales Gas', unit: '%', min: 20, max: 100, step: 5, def: 70, hint: 'Harte Grenze. Die stärkere Begrenzung (Gas oder Tempo) gilt' },
    { key: 'arriveRadius', group: 'Navigation', label: 'Ankunftsradius', unit: 'm', min: 2, max: 30, step: 1, def: 8 },
    { key: 'loop', group: 'Navigation', label: 'Mission wiederholen', type: 'bool', def: true },
    { key: 'geofence', group: 'Sicherheit', label: 'Geofence-Radius', unit: 'm', min: 50, max: 3000, step: 50, def: 600, hint: 'Um den Home-Punkt' },
    { key: 'failsafe', group: 'Sicherheit', label: 'Bei Verbindungsverlust', type: 'select', options: ['Stopp', 'Return Home', 'Position halten'], def: 'Return Home' },
    { key: 'linkTimeout', group: 'Sicherheit', label: 'Verbindungs-Timeout', unit: 's', min: 3, max: 120, step: 1, def: 10 },
    { key: 'battWarn', group: 'Akku', label: 'Warnschwelle', unit: 'V', min: 12, max: 17, step: 0.1, def: 14.4 },
    { key: 'battCrit', group: 'Akku', label: 'Kritische Schwelle', unit: 'V', min: 12, max: 17, step: 0.1, def: 13.8 },
    { key: 'battCap', group: 'Akku', label: 'Kapazität', unit: 'mAh', min: 500, max: 20000, step: 100, def: 5000 },
    { key: 'escWarn', group: 'Temperatur', label: 'ESC Warnung', unit: '°C', min: 30, max: 120, step: 1, def: 60 },
    { key: 'escCrit', group: 'Temperatur', label: 'ESC kritisch', unit: '°C', min: 30, max: 120, step: 1, def: 75 },
    { key: 'hullWarn', group: 'Temperatur', label: 'Innenraum Warnung', unit: '°C', min: 20, max: 80, step: 1, def: 45 },
    { key: 'pumpOn', group: 'Kühlpumpe', label: 'Pumpe ein ab', unit: '°C', min: 20, max: 90, step: 1, def: 40, hint: 'ESC-Temperatur, Modus Auto' },
    { key: 'pumpOff', group: 'Kühlpumpe', label: 'Pumpe aus unter', unit: '°C', min: 15, max: 85, step: 1, def: 33, hint: 'Muss unter «ein ab» liegen' },
    { key: 'dataLimit', group: 'LTE-Daten', label: 'Monatsgrenze', unit: 'MB', min: 50, max: 20000, step: 50, def: 1000, hint: 'Warnung ab 80 %, Alarm ab 100 %' },
    { key: 'telemetry', group: 'Telemetrie', label: 'Sendeintervall', type: 'select', options: ['100 ms', '200 ms', '500 ms', '1 s', '2 s', '5 s', '10 s'], def: '1 s', hint: 'Kürzer = feinerer Verlauf, aber mehr LTE-Daten' }
  ];
  const defaultParams = () => Object.fromEntries(M.PARAM_DEFS.map(p => [p.key, p.def]));

  /* Testmodus (Reiter "Tests"): Aktoren einzeln ansteuern, nur bei entschaerftem, gestopptem Boot */
  M.TEST_MOTOR_MAX = 100;                   // % Gas im Test (volle Leistung erlaubt)
  const TEST_IDLE_MS = 5 * 60 * 1000;       // Testmodus endet nach 5 min ohne Bedienung
  const freshTest = () => ({ active: false, since: 0, last: 0, motor: 0, motorUntil: 0, servo: 50,
                             pump: null, pumpUntil: 0, pumpSpeed: null, lights: { red: 0, green: 0, white1: 0, white2: 0 } });

  M.LIGHT_MODES = [
    { id: 0, name: 'Aus', desc: 'Alle Lichter aus', lamps: '' },
    { id: 1, name: 'Alles an', desc: 'Alle Kanäle dauerhaft', lamps: 'rgww' },
    { id: 2, name: 'Positionslichter', desc: 'Backbord rot, Steuerbord grün', lamps: 'rg' },
    { id: 3, name: 'Position + Blitz', desc: 'Position fest, weisser Doppelblitz', lamps: 'rg|ww:flash' },
    { id: 4, name: 'Doppelblitz', desc: 'Nur weisser Doppelblitz', lamps: 'ww:flash' },
    { id: 5, name: 'Alle blinken', desc: 'Alle langsam (500 ms)', lamps: 'rgww:blink' }
  ];
  M.MODES = {
    MANUAL: 'Manuell (Funke)', SOFT: 'Manuell Soft (Tempo)', AUTO: 'Autonom', RTH: 'Return Home', STOP: 'Gestoppt', TUNE: 'Tuning', ESTOP: 'NOT-AUS'
  };

  /* ---------- Zustand ---------- */
  const HOME = { lat: 47.3495, lon: 8.6825 };   // Platzhalter (Greifensee) – frei verschiebbar
  const sampleWps = () => [
    { lat: 47.3535, lon: 8.6835 }, { lat: 47.3510, lon: 8.6862 },
    { lat: 47.3480, lon: 8.6842 }, { lat: 47.3500, lon: 8.6812 }
  ];
  const PREFILL = 240;

  const s = (M.state = {
    now: Date.now() - PREFILL * 1000,
    online: true, lastSeen: 0, latency: 180,
    mode: 'AUTO', armed: true, endReason: '',      // beim Start der Simulation laeuft die "Vorgeschichte"; danach: Neustart-Zustand
    home: { ...HOME }, homeSync: 'ok', pos: { ...HOME }, heading: 20, speed: 0, roll: 0, pitch: 0,
    target: null, targetBrg: null,
    gps: { fix: true, sats: 12, hdop: 0.9 },
    lte: { dbm: -78, operator: 'Swisscom', tech: 'LTE' },
    cmd: { throttle: 0, rudder: 50 },                   // Sollwerte, KEIN Feedback
    power: { v: 16.6, a: 0, w: 0, mah: 0, wh: 0, resetAt: null },
    temps: { hull: 23, esc: 28 },
    pressure: 1012.4,
    leak: false, test: freshTest(),
    pump: { mode: 'auto', on: false, speed: 100, since: null },   // Kuehlwasserpumpe fuer den ESC: Modus + Drehzahl in %
    light: 3,
    mission: { wps: sampleWps(), active: 0, sync: 'ok', name: 'Rundkurs Nord', courseId: 'c-seed-1' },
    params: defaultParams(), paramSync: 'ok',
    // Regler-Tuning: aktiver Satz im Boot (cur) und letzter guter Satz (good), siehe docs/schnittstelle.md 6a
    tune: { ...M.tuneStore.load(), rev: 1 },
    soft: { speed: 0 },                                   // Soll-Tempo im Modus SOFT (km/h), Ruder kommt von der Funke
    // Verbindung: das Boot kann ueber LTE (Modem) oder WLAN (ESP32) senden
    net: { mode: 'auto', active: 'lte', switchedAt: null,
           wifi: { ssid: '', saved: false, state: 'none', rssi: -60, ip: '', error: '' } },
    // LTE-Datenverbrauch in MB (vom Boot geschaetzt: Nutzdaten + Zuschlag), WLAN zaehlt nicht
    data: { today: 18.2, sinceReset: 312.4, total: 1904.0, resetAt: Date.now() - 11 * 864e5, dayKey: new Date().toDateString() },
    sim: { leak: false, escHot: false, lowBatt: false, gpsLoss: false, lteWeak: false, offline: false, wifiAway: false },
    track: [], history: [], alarms: [], eventLog: [], bootAt: Date.now()
  });
  s.lastSeen = s.now;
  M.sampleWps = sampleWps;
  // Wegpunkt {home:true} = "Home einbeziehen": loest sich immer zur aktuellen Home-Position auf
  M.resolveWps = (list, home) => list.map(w => (w.home ? { ...(home || s.home) } : w));
  const wpAt = i => { const w = s.mission.wps[i]; return w ? (w.home ? s.home : w) : null; };
  const clone = o => JSON.parse(JSON.stringify(o));
  M.clone = clone;
  const noise = () => Math.random() - 0.5;

  /* ---------- Ereignis-Log ---------- */
  M.log = (text, level = 'info') => {
    s.eventLog.unshift({ t: s.now, level, text });
    if (s.eventLog.length > 200) s.eventLog.pop();
    M.emit('log');
  };

  M.pumpSpeed = () => (s.test.active && s.test.pump !== null && s.test.pumpSpeed != null) ? s.test.pumpSpeed : s.pump.speed;

  function endTest(reason) {
    s.test = freshTest();
    M.log('Test beendet: ' + reason, 'info');
    M.emit('test');
  }
  function testTick() {                           // Sicherheits-Zeitlimits des Testmodus
    const t = s.test;
    if (s.armed || s.mode === 'ESTOP') return endTest(s.armed ? 'Boot wurde scharf geschaltet' : 'NOT-AUS');
    if (t.motor && s.now >= t.motorUntil) { t.motor = 0; M.log('Test: Motor automatisch gestoppt (Zeitlimit)', 'warn'); }
    if (t.pump === true && s.now >= t.pumpUntil) { t.pump = null; M.log('Test: Pumpe automatisch aus (30 s)', 'info'); }
    if (s.now - t.last > TEST_IDLE_MS) endTest('keine Bedienung seit 5 min');
  }

  /* Wirksames Tempo: Reisegeschwindigkeit, aber nie mehr als das Gas-Maximum hergibt (14 km/h = 100 % Gas) */
  M.speedLimit = () => {
    const P = s.params, gasKmh = P.maxThrottle / 100 * 14;
    return gasKmh < P.cruiseSpeed ? { kmh: gasKmh, by: 'gas' } : { kmh: P.cruiseSpeed, by: 'speed' };
  };

  /* ---------- Simulationsschritt (1 s) ---------- */
  function step() {
    const P = s.params, sim = s.sim;
    s.now += 1000;
    // ---- Verbindung waehlen: Auto = WLAN wenn gespeichert und erreichbar, sonst LTE ----
    const wf = s.net.wifi, wifiOk = wf.saved && wf.state === 'ok' && !sim.wifiAway;
    const prevActive = s.net.active;
    s.net.active = s.net.mode === 'lte' ? 'lte' : s.net.mode === 'wifi' ? (wifiOk ? 'wifi' : 'none') : (wifiOk ? 'wifi' : 'lte');
    if (s.net.active !== prevActive) {
      s.net.switchedAt = s.now;
      M.log(`Verbindung gewechselt: ${{ lte: 'LTE', wifi: 'WLAN ' + wf.ssid, none: 'keine' }[s.net.active]}`, s.net.active === 'none' ? 'crit' : 'info');
    }
    s.online = !sim.offline && s.net.active !== 'none';
    if (s.online) wf.rssi = wifiOk ? clamp(wf.rssi + noise() * 4, -80, -42) : wf.rssi;
    if (!s.online) { if (s.test.active) endTest('Verbindung verloren'); evalAlarms(); return; }   // Daten "eingefroren"
    s.lastSeen = s.now;
    s.latency = s.net.active === 'wifi' ? Math.round(40 + noise() * 30) : Math.round(180 + noise() * 120);
    // LTE-Datenzaehler (nur wenn ueber LTE gesendet wird): ~460 Byte je Telemetriepaket
    if (s.net.active === 'lte') {
      const m = /([\d.]+)\s*(ms|s)/.exec(s.params.telemetry), iv = m ? (m[2] === 'ms' ? m[1] / 1000 : +m[1]) : 1;
      const mb = 460 / iv / 1e6, key = new Date(s.now).toDateString();
      if (s.data.dayKey !== key) { s.data.dayKey = key; s.data.today = 0; }
      s.data.today += mb; s.data.sinceReset += mb; s.data.total += mb;
    }
    if (s.test.active) testTick();

    // ---- Ziel bestimmen ----
    let target = null;
    if (s.mode === 'AUTO') target = wpAt(s.mission.active);
    else if (s.mode === 'RTH') target = s.home;
    if (target && M.geo.dist(s.pos, target) < P.arriveRadius) {
      const wps = s.mission.wps;
      if (s.mode === 'RTH') { s.mode = 'STOP'; s.endReason = 'Home erreicht'; target = null; M.log('Home erreicht'); }
      else if (s.mission.active < wps.length - 1) { s.mission.active++; target = wpAt(s.mission.active); M.emit('mission'); }
      else if (P.loop && wps.length > 1) { s.mission.active = 0; target = wpAt(0); M.emit('mission'); }
      else { s.mode = 'STOP'; s.endReason = 'Mission abgeschlossen'; target = null; M.log('Mission abgeschlossen'); }
    }
    s.target = target;

    // ---- Sollwerte (Autopilot bzw. simulierter Sender) ----
    let thr = 0, rud = 50;
    if (target) {
      s.targetBrg = M.geo.bearing(s.pos, target);
      const err = wrap180(s.targetBrg - s.heading);
      rud = 50 + clamp(err / 40, -1, 1) * 50;
      thr = P.cruiseSpeed / 14 * 100 * (Math.abs(err) > 60 ? 0.5 : 1);    // Boot-intern: Tempo -> Gas (14 km/h = 100 %)
    } else {
      s.targetBrg = null;
      if (s.mode === 'MANUAL') { thr = 25 + 15 * Math.sin(s.now / 9000); rud = 50 + 28 * Math.sin(s.now / 5500); }
      else if (s.mode === 'SOFT') { thr = s.soft.speed / 14 * 100; rud = 50 + 20 * Math.sin(s.now / 6000); }   // Gas aus dem Soll-Tempo, Ruder = simulierte Funke
    }
    thr = Math.min(thr, P.maxThrottle);                                  // die stärkere Begrenzung gewinnt
    if (s.test.active) { thr = s.test.motor; rud = s.test.servo; s.target = null; s.targetBrg = null; }   // Test: Handsteuerung
    if (s.mode !== 'SOFT') s.soft.speed = 0;
    s.cmd.throttle = thr; s.cmd.rudder = rud;

    // ---- Bewegung (im Testmodus steht das Boot gesichert still) ----
    if (s.test.active) s.speed = 0;
    else {
      s.speed += (thr / 100 * 14 - s.speed) * 0.25;                       // km/h
      const turn = ((rud - 50) / 50) * 45 * (0.35 + Math.min(s.speed, 8) / 8);
      s.heading = (s.heading + turn + 360) % 360;
      s.pos = M.geo.move(s.pos, s.heading, s.speed / 3.6);
    }
    s.roll = 1.5 * Math.sin(s.now / 2300) + ((rud - 50) / 50) * s.speed * 0.55;
    s.pitch = thr / 100 * 4 + 0.6 * Math.sin(s.now / 3100);

    // ---- Energie ----
    // Kuehlpumpe: Auto = mit Hysterese an die ESC-Temperatur gekoppelt
    const wasOn = s.pump.on;
    if (s.pump.mode === 'on') s.pump.on = true;
    else if (s.pump.mode === 'off') s.pump.on = false;
    else if (s.temps.esc >= P.pumpOn) s.pump.on = true;
    else if (s.temps.esc <= Math.min(P.pumpOff, P.pumpOn - 1)) s.pump.on = false;
    if (s.test.active && s.test.pump !== null) s.pump.on = s.test.pump;   // Test: Pumpe von Hand
    if (s.pump.on !== wasOn) s.pump.since = s.pump.on ? s.now : null;
    const pumpSpd = M.pumpSpeed();                       // wirksame Drehzahl in % (Test kann sie uebersteuern)
    const pumpA = s.pump.on ? 1.2 * pumpSpd / 100 : 0;
    const a = Math.max(0, 0.9 + pumpA + (s.light ? 0.25 : 0) + Math.pow(thr / 100, 1.6) * 14 + noise() * 0.4);
    s.power.mah += a * 1000 / 3600;
    let v = 16.7 - (s.power.mah / P.battCap) * 2.6 - a * 0.06 + noise() * 0.03;
    if (sim.lowBatt) v -= 3.0;
    s.power.v = v; s.power.a = a; s.power.w = v * a;
    s.power.wh += v * a / 3600;

    // ---- Temperaturen / Umwelt ----
    const escTarget = 27 + a * 3.2 + (sim.escHot ? 45 : 0) - (s.pump.on ? 10 * pumpSpd / 100 : 0);   // laufende Pumpe kuehlt, staerker bei hoher Drehzahl
    s.temps.esc += (escTarget - s.temps.esc) * 0.08 + noise() * 0.1;
    s.temps.hull += (22 + (s.temps.esc - 27) * 0.18 + a * 0.25 - s.temps.hull) * 0.03 + noise() * 0.03;
    s.pressure += noise() * 0.05;
    s.leak = sim.leak;

    // ---- GPS / LTE ----
    s.gps.fix = !sim.gpsLoss;
    s.gps.sats = s.gps.fix ? clamp(Math.round(s.gps.sats + noise() * 2), 9, 14) : 2;
    s.lte.dbm = sim.lteWeak ? -104 : clamp(s.lte.dbm + noise() * 4, -98, -65);

    // ---- Historie ----
    s.track.push({ lat: s.pos.lat, lon: s.pos.lon });
    if (s.track.length > 4000) s.track.shift();
    s.history.push({ t: s.now, v: s.power.v, a: s.power.a, w: s.power.w, esc: s.temps.esc, hull: s.temps.hull,
                     p: s.pressure, roll: s.roll, pitch: s.pitch, speed: s.speed });
    if (s.history.length > 18000) s.history.shift();         // 5 h bei 1 Messwert pro Sekunde

    evalAlarms();
  }

  /* ---------- Alarme (nur Anzeige) ---------- */
  M.soc = v => clamp((v - 13.6) / (16.8 - 13.6) * 100, 0, 100);
  function evalAlarms() {
    const P = s.params, list = [];
    const add = (id, level, text) => list.push({ id, level, text });
    if (!s.online) add('link', 'crit', 'Verbindung zum Boot verloren');
    if (s.leak) add('leak', 'crit', 'Wassereinbruch im Rumpf erkannt');
    if (s.power.v <= P.battCrit) add('batt', 'crit', `Akku kritisch (${s.power.v.toFixed(1)} V)`);
    else if (s.power.v <= P.battWarn) add('batt', 'warn', `Akku niedrig (${s.power.v.toFixed(1)} V)`);
    if (s.temps.esc >= P.escCrit) add('esc', 'crit', `ESC überhitzt (${s.temps.esc.toFixed(0)} °C)`);
    else if (s.temps.esc >= P.escWarn) add('esc', 'warn', `ESC heiss (${s.temps.esc.toFixed(0)} °C)`);
    if (s.temps.hull >= P.hullWarn) add('hull', 'warn', `Innenraum warm (${s.temps.hull.toFixed(0)} °C)`);
    if (!s.gps.fix) add('gps', 'warn', 'GPS-Fix verloren');
    if (s.net.active === 'lte' && s.lte.dbm <= -100) add('lte', 'warn', `LTE-Signal schwach (${s.lte.dbm.toFixed(0)} dBm)`);
    if (s.net.active === 'wifi' && s.net.wifi.rssi <= -78) add('wifi', 'warn', `WLAN-Signal schwach (${s.net.wifi.rssi.toFixed(0)} dBm)`);
    const dataPct = s.data.sinceReset / P.dataLimit * 100;
    if (dataPct >= 100) add('data', 'crit', `LTE-Datengrenze erreicht (${s.data.sinceReset.toFixed(0)} von ${P.dataLimit} MB)`);
    else if (dataPct >= 80) add('data', 'warn', `LTE-Daten bei ${dataPct.toFixed(0)} % der Monatsgrenze`);
    if (M.geo.dist(s.home, s.pos) > P.geofence) add('fence', 'warn', 'Geofence verlassen');
    if (s.mode === 'ESTOP') add('estop', 'crit', 'NOT-AUS aktiv');

    const prev = new Map(s.alarms.map(a => [a.id, a]));
    let changed = list.length !== s.alarms.length;
    list.forEach(a => {
      const p = prev.get(a.id);
      if (!p) { M.log(a.text, a.level); changed = true; }
      else if (p.level !== a.level || p.text !== a.text) changed = true;
      a.since = p ? p.since : s.now;
    });
    s.alarms.forEach(a => { if (!list.find(x => x.id === a.id)) M.log(`Behoben: ${a.text}`, 'ok'); });
    s.alarms = list;
    if (changed) M.emit('alarms');
  }

  /* ---------- Befehle (simulierte Quittung) ---------- */
  function send(label, apply, delay = 700) {
    if (!s.online) { M.toast(`${label}: Boot offline – nicht zugestellt`, 'crit'); return false; }
    M.log(`Befehl: ${label}`);
    setTimeout(() => { apply(); M.toast(`${label} – vom Boot bestätigt`, 'ok'); M.emit('tick'); }, delay);
    return true;
  }
  M.actions = {
    // Scharf schalten: ohne "armed" fahren weder Mission noch Return Home
    // ---- Verbindung ----
    setNetMode(mode) {                           // 'auto' | 'lte' | 'wifi'
      const lbl = { auto: 'Auto (WLAN bevorzugt)', lte: 'nur LTE', wifi: 'nur WLAN' }[mode];
      if (mode === 'wifi' && !(s.net.wifi.saved && s.net.wifi.state === 'ok')) return M.toast('Erst ein WLAN speichern und verbinden', 'warn');
      send(`Verbindungsart: ${lbl}`, () => { s.net.mode = mode; M.emit('net'); }, 800);
    },
    // Zugangsdaten gehen NUR an das Boot (Passwort wird hier nicht gespeichert und nie wieder angezeigt).
    // Das Boot probiert die neuen Daten ~20 s; klappt es nicht, bleibt die bisherige Verbindung (LTE) bestehen.
    setWifi(ssid, pass) {
      if (!s.online) return M.toast('Boot offline – Zugangsdaten nicht zugestellt', 'crit');
      if (!ssid) return M.toast('Bitte den WLAN-Namen eingeben', 'warn');
      if (pass.length && pass.length < 8) return M.toast('WLAN-Passwort: mindestens 8 Zeichen (WPA2)', 'warn');
      const wf = s.net.wifi;
      wf.state = 'connecting'; wf.error = ''; M.log(`WLAN «${ssid}»: Verbindung wird aufgebaut`); M.emit('net');
      setTimeout(() => {
        // Demo-Regel: Passwoerter mit "falsch" oder "wrong" schlagen fehl (zum Testen der Fehleranzeige)
        if (pass.length >= 8 && !/falsch|wrong/i.test(pass)) {
          Object.assign(wf, { ssid, saved: true, state: 'ok', rssi: -58, ip: '192.168.178.' + (20 + Math.floor(Math.random() * 200)), error: '' });
          M.log(`WLAN «${ssid}» verbunden (${wf.ip})`, 'ok'); M.toast(`WLAN «${ssid}» verbunden`, 'ok');
        } else {
          wf.state = wf.saved ? 'ok' : 'none';
          wf.error = 'Verbindung fehlgeschlagen (Passwort falsch oder Netz nicht erreichbar). Das Boot bleibt auf LTE.';
          M.log(`WLAN «${ssid}»: fehlgeschlagen`, 'warn'); M.toast('WLAN fehlgeschlagen – bleibt auf LTE', 'crit');
        }
        M.emit('net'); M.emit('tick');
      }, 3000);
    },
    forgetWifi() {
      send('WLAN vergessen', () => {
        s.net.wifi = { ssid: '', saved: false, state: 'none', rssi: -60, ip: '', error: '' };
        if (s.net.mode === 'wifi') s.net.mode = 'auto';
        M.emit('net');
      }, 600);
    },
    // LTE-Datenzaehler zuruecksetzen (z. B. zum Monatsanfang)
    resetLteData() {
      send('LTE-Datenzähler zurücksetzen', () => { s.data.sinceReset = 0; s.data.resetAt = Date.now(); M.log('LTE-Datenzähler zurückgesetzt', 'warn'); }, 600);
    },

    // ---- Regler-Tuning (Seite "Tuning") ----
    // values: nur die geaenderten Schluessel. Das Boot prueft die Grenzen und uebernimmt alles oder nichts.
    setTune(values, label = 'Regler-Werte senden') {
      const v = M.tuneValidate(values, s.tune.cur);
      if (!v.ok) { M.toast(v.errors[0], 'crit'); return false; }
      if (!Object.keys(v.clean).length) return false;
      return send(label, () => {
        Object.assign(s.tune.cur, v.clean); s.tune.rev++;
        M.tuneStore.save(s.tune.cur, s.tune.good);
        M.log(`Regler-Werte übernommen (${Object.keys(v.clean).length})`, 'ok'); M.emit('tune');
      }, 700);
    },
    tuneDefaults(group) {
      const def = M.tuneDefaults(), vals = {};
      Object.keys(def).forEach(k => { if (!group || M.TUNE_BY_KEY[k].group === group) vals[k] = def[k]; });
      return M.actions.setTune(vals, group ? 'Standardwerte laden' : 'Alle Standardwerte laden');
    },
    // Sprungtest: das Boot quittiert, danach laufen die Verlaeufe (siehe view-tuning.js)
    tuneStep(label, apply) { return send(label, apply, 600); },
    tuneMarkGood() {
      send('Satz als «letzten guten» merken', () => {
        s.tune.good = { ...s.tune.cur }; M.tuneStore.save(s.tune.cur, s.tune.good); M.emit('tune');
      }, 500);
    },
    tuneRestore() {
      send('Letzten guten Satz wiederherstellen', () => {
        s.tune.cur = { ...s.tune.good }; s.tune.rev++; M.tuneStore.save(s.tune.cur, s.tune.good);
        M.log('Letzter guter Regler-Satz wiederhergestellt', 'warn'); M.emit('tune');
      }, 700);
    },

    // Verbrauchszaehler (mAh/Wh) auf 0, z. B. nach dem Laden oder bei neuem Akku
    resetConsumption() {
      send('Verbrauchszähler zurücksetzen', () => {
        s.power.mah = 0; s.power.wh = 0; s.power.resetAt = s.now;
        M.log('Verbrauchszähler zurückgesetzt', 'warn');
      }, 600);
    },

    // ---- Testmodus (Reiter "Tests") ----
    testStart() {
      if (!s.online) return M.toast('Boot offline', 'warn');
      if (s.armed) return M.toast('Erst entschärfen', 'warn');
      if (s.mode !== 'STOP') return M.toast('Das Boot muss gestoppt sein', 'warn');
      send('Testmodus starten', () => { s.test = { ...freshTest(), active: true, since: s.now, last: s.now }; M.emit('test'); }, 500);
    },
    testEnd(reason = 'Beendet') { if (s.test.active) endTest(reason); },
    // kind: 'motor' | 'servo' | 'pump' | 'light'; direkt (ohne Quittung), damit Regler fluessig sind
    testSet(kind, val, o = {}) {
      const t = s.test; if (!t.active) return;
      if (!s.online) return M.toast('Boot offline', 'crit');
      t.last = s.now;
      if (kind === 'motor') { t.motor = M.clamp(val, 0, M.TEST_MOTOR_MAX); t.motorUntil = s.now + (o.ms || 10000); }
      else if (kind === 'servo') t.servo = M.clamp(val, 0, 100);
      else if (kind === 'pump') { t.pump = val; t.pumpUntil = s.now + 30000; }      // true | false | null (= normal/Auto)
      else if (kind === 'pumpSpeed') t.pumpSpeed = M.clamp(val, 10, 100);
      else if (kind === 'light') t.lights[o.ch] = M.clamp(val, 0, 100);
      M.emit('test');
    },

    arm() {
      if (s.test.active) return M.toast('Erst den Testmodus beenden', 'warn');
      if (s.mode === 'ESTOP') return M.toast('Erst NOT-AUS freigeben', 'warn');
      send('Scharf schalten', () => { s.armed = true; M.log('Boot ist scharf', 'warn'); }, 600);
    },
    disarm() {
      send('Entschärfen', () => {
        s.armed = false;
        if (s.mode === 'AUTO' || s.mode === 'RTH' || s.mode === 'MANUAL' || s.mode === 'SOFT') { s.mode = 'STOP'; s.endReason = 'Entschärft'; }
        M.log('Boot entschärft', 'ok');
      }, 400);
    },
    // Tuning-Modus: nur von der Seite "Tuning" aus; Boot entschaerft und gestoppt. Scharf schalten geht danach wie gewohnt.
    tuneEnter() {
      if (!s.online) return M.toast('Boot offline', 'warn');
      if (s.mode === 'ESTOP') return M.toast('Erst NOT-AUS freigeben', 'warn');
      if (s.armed || s.mode !== 'STOP') return M.toast('Für das Tuning muss das Boot entschärft und gestoppt sein', 'warn');
      if (s.test.active) return M.toast('Erst den Testmodus beenden', 'warn');
      send('Tuning-Modus starten', () => { s.mode = 'TUNE'; s.endReason = ''; M.log('Tuning-Modus gestartet', 'info'); }, 500);
    },
    tuneLeave(why = 'Beendet') {
      if (s.mode !== 'TUNE') return;
      s.mode = 'STOP'; s.armed = false; s.endReason = 'Tuning beendet';
      M.log(`Tuning-Modus beendet: ${why} (Boot entschärft)`, 'info'); M.emit('tick');
    },
    start() {
      if (s.mode === 'TUNE') return M.toast('Im Tuning-Modus gibt es keine Mission – erst Tuning beenden', 'warn');
      if (!s.armed) return M.toast('Boot ist nicht scharf – erst scharf schalten', 'warn');
      if (!s.mission.wps.length) return M.toast('Keine Wegpunkte geladen', 'warn');
      if (s.mode === 'ESTOP') return M.toast('Erst NOT-AUS freigeben', 'warn');
      send('Mission starten', () => { s.mode = 'AUTO'; if (s.mission.active >= s.mission.wps.length) s.mission.active = 0; M.emit('mission'); });
    },
    // Manuell: Gas und Ruder kommen vom Sender (Funke); das Dashboard steuert nichts, zeigt nur an.
    manual() {
      if (!s.armed) return M.toast('Boot ist nicht scharf – erst scharf schalten', 'warn');
      if (s.mode === 'ESTOP') return M.toast('Erst NOT-AUS freigeben', 'warn');
      if (s.mode === 'TUNE') return M.toast('Im Tuning-Modus nicht möglich – erst Tuning beenden', 'warn');
      send('Manuell (Funke)', () => { s.mode = 'MANUAL'; s.endReason = ''; s.target = null; M.log('Manueller Modus: der Sender steuert', 'warn'); }, 400);
    },
    // Manuell Soft: Tempo stellt das Dashboard ein (das Boot haelt es), das Ruder kommt von der Funke.
    soft() {
      if (!s.armed) return M.toast('Boot ist nicht scharf – erst scharf schalten', 'warn');
      if (s.mode === 'ESTOP') return M.toast('Erst NOT-AUS freigeben', 'warn');
      if (s.mode === 'TUNE') return M.toast('Im Tuning-Modus nicht möglich – erst Tuning beenden', 'warn');
      send('Manuell Soft', () => { s.mode = 'SOFT'; s.soft.speed = 0; s.endReason = ''; s.target = null; M.log('Manuell Soft: Tempo vom Dashboard, Ruder von der Funke', 'warn'); }, 400);
    },
    setSoftSpeed(kmh) {
      if (s.mode !== 'SOFT') return;
      const v = Math.round(M.clamp(kmh, 0, M.speedLimit().kmh) * 10) / 10;
      send(`Tempo ${M.fmtSpd(v)} ${M.spdUnit()}`, () => { if (s.mode === 'SOFT') s.soft.speed = v; }, 400);
    },
    stop() { send('Stopp', () => { s.mode = 'STOP'; s.endReason = 'Manuell gestoppt'; }, 300); },
    rth() {
      if (s.mode === 'TUNE') return M.toast('Im Tuning-Modus nicht möglich – erst Tuning beenden', 'warn');
      if (!s.armed) return M.toast('Boot ist nicht scharf – erst scharf schalten', 'warn');
      send('Return Home', () => { s.mode = 'RTH'; }, 300);
    },
    estop() { s.mode = 'ESTOP'; s.armed = false; s.endReason = 'NOT-AUS'; M.log('NOT-AUS ausgelöst', 'crit'); M.toast('NOT-AUS gesendet', 'crit'); M.emit('tick'); },
    // Nach der Freigabe bleibt das Boot ENTSCHAERFT; erneutes Scharfschalten ist noetig
    release() { send('NOT-AUS freigeben', () => { s.mode = 'STOP'; s.armed = false; }, 300); },
    setLight(id) { send(`Licht-Modus ${id}`, () => { s.light = id; }, 600); },
    setPumpSpeed(p) { send(`Pumpe ${p} %`, () => { s.pump.speed = p; }, 500); },
    setPumpMode(mode) {                    // 'auto' | 'on' | 'off'
      const lbl = { auto: 'Auto', on: 'Ein', off: 'Aus' }[mode];
      send(`Pumpe: ${lbl}`, () => { s.pump.mode = mode; }, 500);
    },
    // meta = { id, name } des Kurses, aus dem die Mission stammt (optional)
    sendMission(wps, meta = {}) {
      if (!wps.length) return M.toast('Keine Wegpunkte', 'warn');
      s.mission.sync = 'pending'; M.emit('mission');
      send(`Mission «${meta.name || 'ohne Namen'}» (${wps.length} WP)`, () => {
        const sameCourse = meta.id && meta.id === s.mission.courseId;
        s.mission.wps = clone(wps);
        s.mission.active = sameCourse ? Math.min(s.mission.active, wps.length - 1) : 0;   // neuer Kurs -> bei WP 1 beginnen
        s.mission.name = meta.name || null; s.mission.courseId = meta.id || null;
        s.mission.sync = 'ok'; M.emit('mission');
        if (meta.id && M.courses) M.courses.markSent(meta.id);
      }, 1500) || (s.mission.sync = 'ok');
    },
    sendHome(p) {
      s.homeSync = 'pending'; M.emit('home');
      send('Home-Position', () => { s.home = { lat: p.lat, lon: p.lon }; s.homeSync = 'ok'; M.emit('home'); }, 1200) || (s.homeSync = 'ok');
    },
    sendParams(p) {
      s.paramSync = 'pending'; M.emit('params');
      send('Einstellungen', () => { s.params = { ...clone(p) }; s.paramSync = 'ok'; M.emit('params'); }, 1500) || (s.paramSync = 'ok');
    }
  };

  /* ---------- Start ---------- */
  // Boot (neu) eingeschaltet: Antrieb aus, NICHT scharf, Stillstand
  M.simReboot = function () {
    s.armed = false; s.mode = 'STOP'; s.endReason = 'Neustart'; s.speed = 0; s.target = null; s.targetBrg = null;
    s.cmd.throttle = 0; s.cmd.rudder = 50; s.pump.mode = 'auto'; s.pump.on = false; s.pump.since = null; s.test = freshTest();
    M.log('Boot neu gestartet – nicht scharf', 'warn');
  };

  M.startSim = function () {
    for (let i = 0; i < PREFILL; i++) step();
    s.armed = false; s.mode = 'STOP'; s.endReason = ''; s.speed = 0; s.target = null; s.targetBrg = null;   // frisch eingeschaltet
    s.cmd.throttle = 0; s.cmd.rudder = 50;
    M.emit('tick');
    setInterval(() => { step(); M.emit('tick'); }, 1000);
  };
})();
