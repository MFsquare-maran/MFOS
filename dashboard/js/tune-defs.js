/* ===================================================================
   tune-defs.js  –  Wertedefinitionen fuer die Seite «Tuning»
   -------------------------------------------------------------------
   Eine Quelle fuer: Standardwerte, Grenzen (die das Boot ebenfalls
   durchsetzen muss), Beschriftung, Einheit.  Schluessel haben die Form
   <gruppe>.<name>, z. B. speed.kp  (Vertrag: docs/schnittstelle.md 6a).
   Alle Tempo-Werte sind in km/h, unabhaengig vom Einheiten-Knopf.
   Vorlage: docs/regler.md.
   =================================================================== */
(function () {
  'use strict';
  const M = (window.MFOS = window.MFOS || {});

  // p(key, Beschriftung, Einheit, min, max, Schritt, Standard, Hinweis, Zusatz)
  const p = (key, label, unit, min, max, step, def, hint, extra) => ({ key, label, unit, min, max, step, def, hint, ...extra });
  const b = (key, label, def, hint, extra) => ({ key, label, type: 'bool', def, hint, ...extra });

  M.TUNE_GROUPS = [
    /* ---------- Regler (PID) ---------- */
    { id: 'speed', kind: 'pid', nr: 1, title: 'Tempo-Regler',
      desc: 'Hält das Tempo über Grund (GPS). Ausgang: Gas.',
      test: { label: 'Tempo-Sprung', unit: 'km/h', min: 0.2, max: 5, step: 0.1, def: 1, text: 'Tempo-Sprung +' },
      params: [
        p('speed.kp', 'P-Anteil (Kp)', '% pro km/h', 0, 30, 0.1, 6, 'Gas-Prozent je km/h Abweichung'),
        p('speed.ki', 'I-Anteil (Ki)', '% pro km/h·s', 0, 10, 0.05, 1.2, 'gleicht bleibende Abweichung aus'),
        p('speed.ff', 'Vorsteuerung', '% pro km/h', 0, 15, 0.1, 6.6, 'Gas, das fürs Soll-Tempo ohne Regler nötig wäre (aus der gemessenen Kennlinie)'),
        p('speed.iLimit', 'Grenze des I-Anteils', '%', 0, 100, 1, 30, 'Anti-Windup')
      ] },
    { id: 'course', kind: 'pid', nr: 2, title: 'Kurs-Regler',
      desc: 'Soll-Kurs → Soll-Drehrate (mittlerer Kreis).',
      test: { label: 'Kurssprung', unit: '°', min: 5, max: 90, step: 5, def: 20, text: 'Kurssprung +' },
      params: [
        p('course.kp', 'P-Anteil (Kp)', '°/s pro °', 0, 5, 0.05, 0.6, 'Soll-Drehrate je Grad Kursfehler'),
        p('course.ki', 'I-Anteil (Ki)', '°/s pro °·s', 0, 1, 0.005, 0.01),
        p('course.iLimit', 'Grenze des I-Anteils', '°/s', 0, 30, 0.5, 8, 'Anti-Windup'),
        p('course.maxRate', 'Maximale Drehrate', '°/s', 5, 90, 1, 30, 'bestimmt, wie hart das Boot eindreht'),
        p('course.kd', 'Dämpfung aus dem Gyro', '% pro °/s', 0, 3, 0.05, 0.4, 'wirkt nur, wenn der Gierraten-Regler aus ist')
      ] },
    { id: 'yaw', kind: 'pid', nr: 3, title: 'Gierraten-Regler',
      desc: 'Soll-Drehrate → Ruder (innerer Kreis, Gyro).',
      test: { label: 'Drehraten-Sprung', unit: '°/s', min: 3, max: 45, step: 1, def: 15, text: 'Drehrate +' },
      params: [
        b('yaw.enabled', 'Gierraten-Regler eingeschaltet', true, 'aus: der Kurs-Regler stellt das Ruder direkt (mit Gyro-Dämpfung)'),
        p('yaw.kp', 'P-Anteil (Kp)', '% pro °/s', 0, 5, 0.05, 0.5),
        p('yaw.ki', 'I-Anteil (Ki)', '% pro °/s·s', 0, 5, 0.05, 0.4),
        p('yaw.kd', 'D-Anteil (Kd)', '% pro °/s²', 0, 1, 0.01, 0, 'meist 0, das Gyro-Rauschen wird sonst verstärkt'),
        p('yaw.iLimit', 'Grenze des I-Anteils', '%', 0, 50, 1, 15, 'Anti-Windup'),
        p('yaw.ff', 'Vorsteuerung', '% pro °/s', 0, 3, 0.05, 0.8, 'Ruder je °/s Soll-Drehrate')
      ] },
    { id: 'track', kind: 'pid', nr: 4, title: 'Bahn-Regler',
      desc: 'Abweichung von der Linie → Kurs-Korrektur (äusserster Kreis, GPS).',
      test: { label: 'Abstand zur Linie', unit: 'm', min: 2, max: 30, step: 1, def: 10, text: 'Start mit ' },
      params: [
        p('track.kp', 'P-Anteil (Kp)', '° pro m', 0, 10, 0.1, 3, 'Kurs-Korrektur je Meter Abstand'),
        p('track.ki', 'I-Anteil (Ki)', '° pro m·s', 0, 1, 0.01, 0.03, 'gleicht dauernden Seitwind und Strömung aus'),
        p('track.iLimit', 'Grenze des I-Anteils', '°', 0, 45, 1, 15, 'Anti-Windup'),
        p('track.maxCorr', 'Maximale Kurs-Korrektur', '°', 5, 80, 1, 45, 'das Boot läuft nie weiter quer zur Linie')
      ] },

    /* ---------- Kein PID, aber Tuning-Werte ---------- */
    { id: 'rudder', kind: 'values', title: 'Ruder',
      desc: 'Keine Rückmeldung vom Servo: reine Einstellungen.',
      params: [
        p('rudder.trim', 'Mitte (Trimm)', '%', -10, 10, 0.5, 0, 'verschiebt die Mittelstellung'),
        p('rudder.maxDefl', 'Maximaler Ausschlag', '%', 10, 50, 1, 45, 'vom Mittelpunkt aus'),
        p('rudder.slew', 'Stellgeschwindigkeit', '% pro s', 20, 500, 10, 200),
        p('rudder.deadband', 'Totbereich', '%', 0, 5, 0.1, 0.5),
        b('rudder.reverse', 'Richtung umkehren', false, undefined, { noSim: true }),
        p('rudder.minUs', 'Impuls Anschlag links', 'µs', 800, 1500, 10, 1000, 'nur ändern, wenn der Servo nicht den vollen Weg macht', { noSim: true }),
        p('rudder.maxUs', 'Impuls Anschlag rechts', 'µs', 1500, 2200, 10, 2000, undefined, { noSim: true })
      ] },
    { id: 'esc', kind: 'values', title: 'Gas / Fahrtregler',
      desc: 'Rampen und Anlaufschwelle des Motors.',
      params: [
        p('esc.rampUp', 'Gas-Rampe aufwärts', '% pro s', 5, 200, 5, 25),
        p('esc.rampDown', 'Gas-Rampe abwärts', '% pro s', 5, 400, 5, 60),
        p('esc.startThr', 'Anlaufschwelle', '%', 0, 40, 1, 8, 'kleinstes Gas, bei dem das Boot anfährt'),
        p('esc.minUs', 'Impuls Stillstand', 'µs', 800, 1500, 10, 1000, undefined, { noSim: true }),
        p('esc.maxUs', 'Impuls Vollgas', 'µs', 1500, 2200, 10, 2000, undefined, { noSim: true })
      ] },
    { id: 'appr', kind: 'values', title: 'Annäherung und Kurven',
      desc: 'Wann das Boot langsamer fährt.',
      params: [
        p('appr.turnAngle', 'Kurve ab Kursfehler', '°', 20, 120, 5, 60, undefined, { noSim: true }),
        p('appr.turnFactor', 'Tempo-Faktor in Kurven', '×', 0.2, 1, 0.05, 0.5, undefined, { noSim: true }),
        p('appr.nearDist', 'Verlangsamen ab Abstand zum Wegpunkt', 'm', 0, 100, 1, 15, undefined, { noSim: true }),
        p('appr.nearFactor', 'Tempo-Faktor beim Näherkommen', '×', 0.2, 1, 0.05, 0.5, undefined, { noSim: true })
      ] },
    { id: 'filt', kind: 'values', title: 'Filter',
      desc: 'Wie die Sensorwerte aufbereitet werden.',
      params: [
        p('filt.headingAlpha', 'Heading-Tiefpass', '', 0, 0.99, 0.01, 0.9, '0 = aus, näher an 1 = träger'),
        p('filt.compassBlend', 'Kompass-Anteil', '', 0, 1, 0.005, 0.02, 'Anteil Kompass gegenüber Gyro (klein = Gyro dominiert)', { noSim: true }),
        p('filt.gpsSpeedAlpha', 'GPS-Tempo-Filter', '', 0, 0.95, 0.05, 0.5, '0 = aus'),
        p('filt.gpsCourseMinSpeed', 'GPS-Kurs ab Tempo', 'km/h', 0, 10, 0.5, 2, 'darunter ist der GPS-Kurs unzuverlässig', { noSim: true })
      ] },
    { id: 'curr', kind: 'values', title: 'Strombegrenzung',
      desc: 'Schutz von Akku und Fahrtregler.',
      params: [
        b('curr.enabled', 'Strombegrenzung eingeschaltet', true, undefined, { noSim: true }),
        p('curr.maxCurrent', 'Maximaler Strom', 'A', 1, 60, 0.5, 10, 'das Gas wird begrenzt, wenn der Strom darüber läge', { noSim: true })
      ] }
  ];

  /* ---------- Abgeleitete Tabellen ---------- */
  M.TUNE_DEFS = M.TUNE_GROUPS.flatMap(g => g.params.map(d => ({ ...d, group: g.id })));
  M.TUNE_BY_KEY = Object.fromEntries(M.TUNE_DEFS.map(d => [d.key, d]));
  M.tuneDefaults = () => Object.fromEntries(M.TUNE_DEFS.map(d => [d.key, d.def]));

  /* Prueft einen (teilweisen) Satz gegen Grenzen und Querbedingungen.
     Das Boot muss dasselbe tun und Werte ausserhalb mit «out_of_range» ablehnen. */
  M.tuneValidate = (values, base) => {
    const errors = [], clean = {};
    Object.entries(values).forEach(([k, v]) => {
      const d = M.TUNE_BY_KEY[k];
      if (!d) return errors.push(`Unbekannter Wert «${k}»`);
      if (d.type === 'bool') { clean[k] = !!v; return; }
      if (typeof v !== 'number' || !isFinite(v)) return errors.push(`${d.label}: keine Zahl`);
      if (v < d.min || v > d.max) return errors.push(`${d.label}: ${v} liegt ausserhalb von ${d.min} bis ${d.max} ${d.unit || ''}`.trim());
      clean[k] = v;
    });
    const all = { ...(base || {}), ...clean };
    ['rudder', 'esc'].forEach(g => {
      if (all[g + '.minUs'] != null && all[g + '.maxUs'] != null && all[g + '.minUs'] >= all[g + '.maxUs'])
        errors.push(`${g === 'rudder' ? 'Ruder' : 'Gas'}: «Impuls links/Stillstand» muss kleiner sein als «rechts/Vollgas»`);
    });
    return { ok: errors.length === 0, errors, clean };
  };

  /* ---------- Speicher im Browser (Mockup: steht fuer den Flash im Boot) ---------- */
  const KEY = 'mfos-tune-v1';
  M.tuneStore = {
    load() {
      const def = M.tuneDefaults();
      try {
        const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (raw && raw.cur) {
          const v = M.tuneValidate(raw.cur), g = M.tuneValidate(raw.good || {});
          return { cur: { ...def, ...v.clean }, good: { ...def, ...g.clean } };
        }
      } catch (e) { /* ignore */ }
      return { cur: { ...def }, good: { ...def } };
    },
    save(cur, good) { try { localStorage.setItem(KEY, JSON.stringify({ cur, good })); } catch (e) { /* ignore */ } }
  };
})();
