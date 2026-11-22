/* ===================================================================
   recorder.js  –  Fahrten aufzeichnen, speichern und exportieren
   -------------------------------------------------------------------
   Aufgezeichnet wird, solange das Boot eine Mission faehrt
   (Modus AUTO oder RETURN HOME): 1 Messwert pro Sekunde mit allen
   Telemetriewerten.  Beim Ende (Stopp, NOT-AUS, Mission fertig,
   Home erreicht) wird die Fahrt gespeichert und erscheint im Replay.

   Mockup: gespeichert im Browser (localStorage), die letzten 15 Fahrten.
   Spaeter: Aufzeichnung auf dem Server (ThingsBoard-Zeitreihen).
   =================================================================== */
(function () {
  'use strict';
  const M = window.MFOS, s = M.state;
  const KEY = 'mfos-trips-v1', MAX_TRIPS = 15, MIN_SAMPLES = 5;
  let recorded = [];          // echte Fahrten, neueste zuerst
  let demo = [];              // erzeugte Testfahrten (nicht gespeichert)
  let rec = null;             // laufende Aufzeichnung
  let lastSampleT = 0;

  const r = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };
  const uid = () => 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  /* ---------- Speicher ---------- */
  (function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) recorded = JSON.parse(raw); } catch (e) { recorded = []; }
  })();
  function persist() {
    while (recorded.length) {
      try { localStorage.setItem(KEY, JSON.stringify(recorded)); return; }
      catch (e) { recorded.pop(); }                        // Speicher voll -> aelteste Fahrt verwerfen
    }
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  /* ---------- Messwert / Kennzahlen ---------- */
  const capture = () => ({
    t: s.now, lat: r(s.pos.lat, 6), lon: r(s.pos.lon, 6), speed: r(s.speed, 2), heading: r(s.heading, 1),
    roll: r(s.roll, 1), pitch: r(s.pitch, 1), v: r(s.power.v, 2), a: r(s.power.a, 2), w: r(s.power.w, 1),
    mah: r(s.power.mah, 0), wh: r(s.power.wh, 2), esc: r(s.temps.esc, 1), hull: r(s.temps.hull, 1), p: r(s.pressure, 1),
    thr: r(s.cmd.throttle, 0), rud: r(s.cmd.rudder, 0), pump: s.pump.on ? M.pumpSpeed() : 0, light: s.light,
    sats: s.gps.sats, dbm: r(s.lte.dbm, 0), mode: s.mode, wp: s.mission.active + 1
  });

  function stats(sm) {
    const n = sm.length;
    let dist = 0, maxSpeed = 0, minV = Infinity, maxA = 0, maxEsc = 0, maxHull = 0, sumW = 0, mah = 0, wh = 0;
    sm.forEach((p, i) => {
      if (i) {
        dist += M.geo.dist(sm[i - 1], p);
        // Zuwaechse summieren: ein Reset des Verbrauchszaehlers mitten in der Fahrt verfaelscht so nichts
        mah += Math.max(0, p.mah - sm[i - 1].mah); wh += Math.max(0, p.wh - sm[i - 1].wh);
      }
      maxSpeed = Math.max(maxSpeed, p.speed); minV = Math.min(minV, p.v); maxA = Math.max(maxA, p.a);
      maxEsc = Math.max(maxEsc, p.esc); maxHull = Math.max(maxHull, p.hull); sumW += p.w;
    });
    const duration = (sm[n - 1].t - sm[0].t) / 1000;
    return { duration, dist, avgSpeed: dist / Math.max(duration, 1) * 3.6, maxSpeed, minV, maxA, maxEsc, maxHull,
             mah, wh, avgW: sumW / n };
  }
  M.tripStats = stats;

  /* ---------- Aufzeichnung steuern ---------- */
  const driving = () => s.mode === 'AUTO' || s.mode === 'RTH';

  function start() {
    rec = { id: uid(), title: s.mission.name || 'Fahrt', courseId: s.mission.courseId || null, start: s.now, samples: [] };
    M.log(`Aufzeichnung gestartet: ${rec.title}`);
    M.toast('Aufzeichnung gestartet', 'info');
    M.emit('recording');
  }
  function finish() {
    const done = rec; rec = null;
    if (done.samples.length < MIN_SAMPLES) { M.toast('Fahrt zu kurz – nicht gespeichert', 'warn'); M.emit('recording'); return; }
    const trip = { id: done.id, title: done.title, courseId: done.courseId, start: done.start, end: s.now,
                   reason: s.endReason || 'Beendet', samples: done.samples, stats: stats(done.samples) };
    recorded.unshift(trip);
    recorded = recorded.slice(0, MAX_TRIPS);
    persist();
    M.log(`Fahrt gespeichert: ${trip.title} (${M.fmtDur(trip.stats.duration)}, ${M.fmtDist(trip.stats.dist)})`, 'ok');
    M.toast(`Fahrt «${trip.title}» gespeichert – im Replay`, 'ok');
    M.emit('recording'); M.emit('trips');
  }

  M.on('tick', () => {
    if (!s.online || s.now === lastSampleT) return;       // offline: keine Daten; pro Sekunde nur ein Messwert
    if (driving() && !rec) start();
    if (!rec) return;
    if (driving()) {
      const prev = rec.samples[rec.samples.length - 1], p = capture();
      rec.dist = (rec.dist || 0) + (prev ? M.geo.dist(prev, p) : 0);
      rec.samples.push(p); lastSampleT = s.now;
    }
    else finish();
  });

  M.recorder = {
    active: () => !!rec,
    elapsed: () => rec && rec.samples.length ? (rec.samples[rec.samples.length - 1].t - rec.start) / 1000 : 0,
    title: () => rec && rec.title,
    distance: () => rec ? (rec.dist || 0) : 0
  };

  /* ---------- Fahrten-Verzeichnis ---------- */
  M.trips = {
    all: () => recorded.concat(demo),
    get: id => recorded.concat(demo).find(t => t.id === id) || null,
    remove(id) { recorded = recorded.filter(t => t.id !== id); persist(); M.emit('trips'); }
  };

  /* ---------- Testfahrten (Demo) ---------- */
  function genDemo(id, title, whenMs, wps, seconds, seed) {
    const loop = wps.concat([wps[0]]), segs = [];
    let total = 0;
    for (let i = 1; i < loop.length; i++) { const d = M.geo.dist(loop[i - 1], loop[i]); segs.push(d); total += d; }
    const sm = [];
    let dist = 0, esc = 28, hull = 23, mah = 0, wh = 0;
    for (let k = 0; k < seconds; k++) {
      const spd = Math.max(0, 5.5 * (0.8 + 0.2 * Math.sin(k / 40 + seed)) * Math.min(1, k / 8) * Math.min(1, (seconds - k) / 8));
      dist += spd / 3.6;
      let d = dist % total, j = 0;
      while (d > segs[j]) { d -= segs[j]; j++; }
      const a0 = loop[j], b0 = loop[j + 1], brg = M.geo.bearing(a0, b0), p = M.geo.move(a0, brg, d);
      const thr = spd / 14 * 100, amp = 0.9 + Math.pow(thr / 100, 1.6) * 14;
      esc += (27 + amp * 3.2 - esc) * 0.06; hull += (22 + (esc - 27) * 0.18 - hull) * 0.03;
      const v = 16.7 - mah / 5000 * 2.6 - amp * 0.06;
      mah += amp * 1000 / 3600; wh += v * amp / 3600;
      sm.push({ t: whenMs + k * 1000, lat: r(p.lat, 6), lon: r(p.lon, 6), speed: r(spd, 2), heading: r(brg, 1),
        roll: r(1.5 * Math.sin(k / 9) + spd * 0.2, 1), pitch: r(thr / 25, 1), v: r(v, 2), a: r(amp, 2), w: r(v * amp, 1),
        mah: r(mah, 0), wh: r(wh, 2), esc: r(esc, 1), hull: r(hull, 1), p: 1012, thr: r(thr, 0), rud: r(50 + 20 * Math.sin(k / 15), 0),
        pump: 0, light: 3, sats: 12, dbm: -80, mode: 'AUTO', wp: j + 1 });
    }
    return { id, demo: true, title, courseId: null, start: whenMs, end: whenMs + seconds * 1000, reason: 'Demo', samples: sm, stats: stats(sm) };
  }
  (function buildDemo() {
    const H = s.home, off = (a, b) => ({ lat: H.lat + a, lon: H.lon + b }), now = Date.now(), day = 864e5;
    demo = [
      genDemo('demo-1', 'Rundkurs Nord', now - 3 * 3600e3, M.sampleWps(), 600, 0.3),
      genDemo('demo-2', 'Grosser Bogen', now - day - 5 * 3600e3, [off(.004, 0), off(.002, .006), off(-.003, .005), off(-.004, -.002), off(0, -.004)], 900, 1.7),
      genDemo('demo-3', 'Slalom-Test', now - 4 * day, [off(.002, .001), off(.0035, .0035), off(.001, .005), off(-.001, .0035), off(-.002, .001)], 420, 2.9)
    ];
  })();

  /* ---------- Export (alle Daten) ---------- */
  const iso = ms => new Date(ms).toISOString();
  const safe = t => t.replace(/[^\w\-äöüÄÖÜ ]+/g, '').trim().replace(/\s+/g, '_') || 'fahrt';
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const CSV_COLS = [
    ['time_utc', p => iso(p.t)], ['elapsed_s', (p, t) => (p.t - t.samples[0].t) / 1000],
    ['lat', p => p.lat], ['lon', p => p.lon],
    ['speed_kmh', p => p.speed], ['speed_ms', p => r(p.speed / 3.6, 3)], ['heading_deg', p => p.heading],
    ['roll_deg', p => p.roll], ['pitch_deg', p => p.pitch],
    ['bat_v', p => p.v], ['bat_a', p => p.a], ['bat_w', p => p.w], ['bat_mah', p => p.mah], ['bat_wh', p => p.wh],
    ['temp_esc_c', p => p.esc], ['temp_hull_c', p => p.hull], ['pressure_hpa', p => p.p],
    ['cmd_throttle_pct', p => p.thr], ['cmd_rudder_pct', p => p.rud], ['pump_pct', p => p.pump], ['light_mode', p => p.light],
    ['gps_sats', p => p.sats], ['lte_dbm', p => p.dbm], ['mode', p => p.mode], ['wp_active', p => p.wp]
  ];

  M.exportTrip = (t, fmt) => {
    const base = safe(t.title) + '_' + new Date(t.start).toISOString().slice(0, 16).replace(/[:T]/g, '-');
    if (fmt === 'csv') {
      const lines = [CSV_COLS.map(c => c[0]).join(',')].concat(t.samples.map(p => CSV_COLS.map(c => c[1](p, t)).join(',')));
      M.download(base + '.csv', 'text/csv;charset=utf-8', '﻿' + lines.join('\n') + '\n');
    } else if (fmt === 'gpx') {
      const pts = t.samples.map(p => `      <trkpt lat="${p.lat}" lon="${p.lon}"><time>${iso(p.t)}</time><extensions>` +
        `<mfos:speed>${r(p.speed / 3.6, 3)}</mfos:speed><mfos:heading>${p.heading}</mfos:heading><mfos:bat_v>${p.v}</mfos:bat_v>` +
        `<mfos:bat_a>${p.a}</mfos:bat_a><mfos:esc_c>${p.esc}</mfos:esc_c></extensions></trkpt>`).join('\n');
      M.download(base + '.gpx', 'application/gpx+xml',
        `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MFOS" xmlns="http://www.topografix.com/GPX/1/1" xmlns:mfos="https://mfos.local/gpx/1">\n` +
        `  <trk>\n    <name>${esc(t.title)}</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>\n</gpx>\n`);
    } else {
      M.download(base + '.json', 'application/json', JSON.stringify({
        format: 'mfos-trip', version: 1, title: t.title, courseId: t.courseId, start: iso(t.start), end: iso(t.end),
        reason: t.reason, stats: t.stats, units: { speed: 'km/h', temp: '°C', bat_v: 'V', bat_a: 'A', pressure: 'hPa' }, samples: t.samples
      }));
    }
  };
})();
