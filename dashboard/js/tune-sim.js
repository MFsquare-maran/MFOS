/* ===================================================================
   tune-sim.js  –  Regler-Simulator fuer die Seite «Tuning» (Mockup)
   -------------------------------------------------------------------
   Rechnet einen Sprungtest mit den eingestellten Reglerwerten gegen ein
   PLATZHALTER-Boot (einfache Modelle, NICHT gemessen). Die Zahlen zeigen,
   wie sich die Werte grundsaetzlich auswirken, nicht wie das echte Boot
   reagiert. Im echten Betrieb liefert das Boot die Verlaeufe (docs/
   schnittstelle.md 6a) und diese Datei entfaellt.

   Reine Rechnung, kein DOM.  M.tuneSim.run(ctrl, size, werte) -> Ergebnis.
   Regeltakt 100 Hz wie die Firmware (controllerTask, 10 ms). Magnetometer
   40 Hz (Code: sampleRate 6), Gyro im Takt. Tempo-Regler und Bahn-Regler
   arbeiten mit der GPS-Rate (Standard 1 Hz: der Code stellt nichts am M8N
   ein, nicht geprueft; waehlbar 1, 5, 10 Hz).
   =================================================================== */
(function () {
  'use strict';
  const M = (window.MFOS = window.MFOS || {});

  const DT = 0.01;                 // Regeltakt 100 Hz (TIC2_MS = 10 in main.cpp)
  const MAG_HZ = 40;               // Magnetometer-Rate (LSM9DS1, sampleRate 6)
  const REC_EVERY = 10;            // Aufzeichnung fuer die Anzeige: 10 Hz
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const wrap = a => (((a + 180) % 360) + 360) % 360 - 180;
  const rng = seed => { let x = seed >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296 - 0.5; }; };

  /* ---------- Platzhalter-Boot ---------- */
  const PLANT = {
    fullSpeed: 14,      // km/h bei 100 % Gas (Annahme, offene Frage 3 in CLAUDE.md)
    speedTau: 2.5,      // s, Traegheit des Tempos
    yawGain: 0.9,       // °/s je % Ruder bei 5,6 km/h
    yawTau: 0.8,        // s, Traegheit der Drehung
    refSpeed: 5.6,      // km/h, Tempo fuer Kurs-, Drehraten- und Bahntest
    gyroNoise: 0.4,     // °/s Rauschen des Gyros
    drift: 0.1          // m/s Seitenstrom im Bahntest
  };

  /* Beschreibung der vier Sprungtests (Einheiten der Anzeige) */
  const SCEN = {
    speed:  { pre: 12, dur: 40, unit: 'km/h', pv: 'Tempo', sp: 'Soll-Tempo', out: 'Gas', outUnit: '%', sp0: 4 },
    course: { pre: 3,  dur: 25, unit: '°',    pv: 'Kurs',  sp: 'Soll-Kurs', out: 'Soll-Drehrate', outUnit: '°/s' },
    yaw:    { pre: 3,  dur: 15, unit: '°/s',  pv: 'Drehrate (Gyro)', sp: 'Soll-Drehrate', out: 'Ruder', outUnit: '%' },
    track:  { pre: 0,  dur: 90, unit: 'm',    pv: 'Abstand zur Linie', sp: 'Soll', out: 'Kurs-Korrektur', outUnit: '°' }
  };
  const OUT = { speed: 'gas', course: 'rate', yaw: 'rudder', track: 'corr' };

  function run(ctrl, size, T, opts) {
    const gpsHz = (opts && opts.gpsHz) || 1, GPS_EVERY = Math.round(1 / DT / gpsHz);
    const g = k => T[k], sc = SCEN[ctrl], rnd = rng(1234 + ctrl.length);
    const maxThr = (M.state && M.state.params && M.state.params.maxThrottle) || 70;
    const n = Math.round((sc.pre + sc.dur) / DT);
    const res = { ctrl, size, gpsHz, scen: sc, t: [], sp: [], pv: [], out: [], p: [], i: [], d: [], ff: [], pvTrue: [], limited: 0 };

    // Zustand des Platzhalter-Boots
    const st = { v: ctrl === 'speed' ? sc.sp0 : PLANT.refSpeed, gas: 0, rud: 0, r: 0, h: 0, y: ctrl === 'track' ? size : 0 };
    if (ctrl === 'speed') st.gas = Math.max(g('esc.startThr'), sc.sp0 / PLANT.fullSpeed * 100);
    // Reglerzustand
    const c = { Is: 0, Ic: 0, Iy: 0, It: 0, vm: st.v, ym: st.y, hm: 0, mag: 0, gyroF: 0, gyroPrev: 0, gasCmd: st.gas, corr: 0, rateSp: 0, p: 0, i: 0, d: 0, ff: 0, out: 0, sp: 0 };
    let limitedTicks = 0;

    c.hm = 0; c.mag = 0;
    for (let k = 0; k <= n; k++) {
      const t = Math.round(k * DT * 1000) / 1000 - sc.pre, stepped = t >= 0;
      const gps = k % GPS_EVERY === 0, dtG = DT * GPS_EVERY;

      /* ---- Messung ---- */
      if (gps) {
        const a = g('filt.gpsSpeedAlpha');
        c.vm = a * c.vm + (1 - a) * st.v;
        c.ym = st.y;
      }
      const gyro = st.r + rnd() * 2 * PLANT.gyroNoise;
      if (Math.floor(k * MAG_HZ * DT) !== Math.floor((k - 1) * MAG_HZ * DT) || k === 0) c.mag = st.h;     // Magnetometer: neuer Wert nur mit 40 Hz
      c.hm = g('filt.headingAlpha') * c.hm + (1 - g('filt.headingAlpha')) * c.mag;                       // Tiefpass je Regeltakt wie in der Firmware
      const ga = Math.exp(-DT / 0.1);                                                                    // Gyro-Filter, ca. 0,1 s
      c.gyroF = ga * c.gyroF + (1 - ga) * gyro;

      /* ---- Sollwerte des Sprungs ---- */
      let spSpeed = sc.sp0 || 0, spHdg = 0, spRate = 0, spTrack = 0;
      if (ctrl === 'speed' && stepped) spSpeed = sc.sp0 + size;
      if (ctrl === 'course' && stepped) spHdg = size;
      if (ctrl === 'yaw' && stepped) spRate = size;

      /* ---- Tempo-Regler (5 Hz) ---- */
      if (ctrl === 'speed' && gps) {
        const e = spSpeed - c.vm;
        c.p = g('speed.kp') * e; c.ff = g('speed.ff') * spSpeed;
        const u = c.ff + c.p + c.Is;
        const sat = (u > maxThr && e > 0) || (u < 0 && e < 0);            // Anti-Windup: bei Anschlag nicht aufintegrieren
        if (!sat) c.Is = clamp(c.Is + g('speed.ki') * e * dtG, -g('speed.iLimit'), g('speed.iLimit'));
        c.i = c.Is; c.d = 0;
        const uu = c.ff + c.p + c.Is;
        c.gasCmd = clamp(uu, 0, maxThr);
        if (uu !== c.gasCmd) limitedTicks += GPS_EVERY;
        c.out = c.gasCmd; c.sp = spSpeed;
      }

      /* ---- Bahn-Regler (5 Hz) ---- */
      if (ctrl === 'track' && gps) {
        const e = -c.ym;                                                    // Abweichung nach rechts => nach links lenken
        c.p = g('track.kp') * e;
        const u = c.p + c.It, mc = g('track.maxCorr');
        const sat = (Math.abs(u) > mc) && Math.sign(e) === Math.sign(u);
        if (!sat) c.It = clamp(c.It + g('track.ki') * e * dtG, -g('track.iLimit'), g('track.iLimit'));
        c.i = c.It; c.d = 0; c.ff = 0;
        c.corr = clamp(c.p + c.It, -mc, mc);
        if (Math.abs(c.p + c.It) > mc) limitedTicks += GPS_EVERY;
        c.out = c.corr; c.sp = spTrack;
      }

      /* ---- Kurs-Regler (20 Hz) ---- */
      if (ctrl === 'course' || ctrl === 'track') {
        const target = ctrl === 'track' ? c.corr : spHdg;
        const e = wrap(target - c.hm), kp = g('course.kp');
        const u = kp * e + c.Ic, mr = g('course.maxRate');
        const sat = Math.abs(u) > mr && Math.sign(e) === Math.sign(u);
        if (!sat) c.Ic = clamp(c.Ic + g('course.ki') * e * DT, -g('course.iLimit'), g('course.iLimit'));
        c.rateSp = clamp(kp * e + c.Ic, -mr, mr);
        if (ctrl === 'course') { c.p = kp * e; c.i = c.Ic; c.d = 0; c.ff = 0; c.out = c.rateSp; c.sp = spHdg; }
        if (Math.abs(kp * e + c.Ic) > mr && ctrl === 'course') limitedTicks++;
      } else if (ctrl === 'yaw') c.rateSp = spRate;

      /* ---- Gierraten-Regler (20 Hz) oder direkte Ruderstellung ---- */
      let rudCmd;
      const maxD = g('rudder.maxDefl');
      if (g('yaw.enabled')) {
        const e = c.rateSp - c.gyroF;
        const P = g('yaw.kp') * e, FF = g('yaw.ff') * c.rateSp;
        const D = -g('yaw.kd') * (c.gyroF - c.gyroPrev) / DT;
        const u = FF + P + c.Iy + D;
        const sat = Math.abs(u) > maxD && Math.sign(e) === Math.sign(u);
        if (!sat) c.Iy = clamp(c.Iy + g('yaw.ki') * e * DT, -g('yaw.iLimit'), g('yaw.iLimit'));
        rudCmd = FF + P + c.Iy + D;
        if (ctrl === 'yaw') { c.p = P; c.i = c.Iy; c.d = D; c.ff = FF; c.out = clamp(rudCmd, -maxD, maxD); c.sp = spRate; }
      } else {
        rudCmd = g('yaw.ff') * c.rateSp - g('course.kd') * c.gyroF;       // Kurs-Regler stellt das Ruder direkt, Gyro daempft
        if (ctrl === 'yaw') { c.p = 0; c.i = 0; c.d = 0; c.ff = rudCmd; c.out = clamp(rudCmd, -maxD, maxD); c.sp = spRate; }
      }
      c.gyroPrev = c.gyroF;
      if (Math.abs(rudCmd) > maxD && ctrl === 'yaw') limitedTicks++;
      rudCmd = clamp(rudCmd, -maxD, maxD);
      if (Math.abs(rudCmd) < g('rudder.deadband')) rudCmd = 0;
      rudCmd = clamp(rudCmd + g('rudder.trim'), -50, 50);
      st.rud += clamp(rudCmd - st.rud, -g('rudder.slew') * DT, g('rudder.slew') * DT);

      /* ---- Gas: Rampe, Anlaufschwelle ---- */
      if (ctrl === 'speed') {
        const dg = c.gasCmd - st.gas, lim = (dg > 0 ? g('esc.rampUp') : g('esc.rampDown')) * DT;
        st.gas += clamp(dg, -lim, lim);
        const vT = st.gas < g('esc.startThr') ? 0 : PLANT.fullSpeed * st.gas / 100;
        st.v += (vT - st.v) * DT / PLANT.speedTau;
      }

      /* ---- Platzhalter-Boot weiterrechnen ---- */
      const rSS = PLANT.yawGain * st.rud * (st.v / PLANT.refSpeed);
      st.r += (rSS - st.r) * DT / PLANT.yawTau;
      st.h += st.r * DT;
      if (ctrl === 'track') st.y += (st.v / 3.6) * Math.sin(st.h * Math.PI / 180) * DT + PLANT.drift * DT;

      /* ---- Aufzeichnen (alle 2 Takte = 10 Hz), gezeigt ab 2 s vor dem Sprung ---- */
      if (k % REC_EVERY === 0 && t >= -Math.min(2, sc.pre)) {
        const show = { speed: st.v, course: st.h, yaw: gyro, track: st.y }[ctrl];
        const tru = { speed: st.v, course: st.h, yaw: st.r, track: st.y }[ctrl];
        res.t.push(+t.toFixed(2)); res.sp.push(c.sp); res.pv.push(show); res.pvTrue.push(tru);
        res.out.push(c.out); res.p.push(c.p); res.i.push(c.i); res.d.push(c.d); res.ff.push(c.ff);
      }
      if (!isFinite(st.h) || Math.abs(st.h) > 1e5 || Math.abs(st.y) > 1e5) { res.unstable = true; break; }
    }
    res.limited = limitedTicks * DT;
    res.metrics = metrics(res, ctrl, size);
    if (res.metrics.unstable) res.unstable = true;
    return res;
  }

  /* Kennzahlen aus dem wahren Verlauf (nicht aus dem verrauschten Messwert) */
  function metrics(r, ctrl, size) {
    const t = r.t, y = r.pvTrue, i0 = t.findIndex(v => v >= 0);
    if (i0 < 0 || !y.length) return { unstable: true };
    const start = ctrl === 'track' ? size : y[Math.max(0, i0 - 1)];
    const target = ctrl === 'speed' ? SCEN.speed.sp0 + size : ctrl === 'track' ? 0 : size;
    const A = target - start;
    if (Math.abs(A) < 1e-9) return {};
    const norm = y.map(v => (v - start) / A);
    const find = lvl => { for (let i = i0; i < norm.length; i++) if (norm[i] >= lvl) return t[i]; return null; };
    const t10 = find(0.1), t90 = find(0.9);
    const over = Math.max(0, Math.max(...norm.slice(i0)) - 1) * 100;
    let lastOut = -1;
    for (let i = i0; i < norm.length; i++) if (Math.abs(norm[i] - 1) > 0.05) lastOut = i;
    const settle = lastOut < 0 ? 0 : lastOut >= norm.length - 1 ? null : t[lastOut + 1];
    const tail = y.slice(Math.floor(y.length * 0.9));
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    return {
      rise: t10 != null && t90 != null ? t90 - t10 : null,
      overshoot: over,
      settle,
      sse: target - mean,
      unstable: Math.abs(norm[norm.length - 1]) > 5 || Math.max(...norm) > 6
    };
  }

  M.tuneSim = { run, SCEN, PLANT, OUT };
})();
