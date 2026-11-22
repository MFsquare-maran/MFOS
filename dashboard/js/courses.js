/* ===================================================================
   courses.js  –  Kursbibliothek (Speicher, Kennzahlen, Import/Export)
   -------------------------------------------------------------------
   Mockup: gespeichert wird im Browser (localStorage). Spaeter ersetzt
   durch Server-Speicher (z. B. ThingsBoard-Attribute / eigene Entity).

   Kurs = { id, name, created, modified, lastSent, wps: [ {lat,lon} | {home:true} ] }
   =================================================================== */
(function () {
  'use strict';
  const M = window.MFOS, s = M.state;
  const KEY = 'mfos-courses-v1';
  const MAX_WPS = 60;                      // Obergrenze beim Import (Tracks werden ausgedünnt)
  let list = [];

  const uid = () => 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* ignore */ } };

  function seed() {
    const H = s.home, off = (a, b) => ({ lat: H.lat + a, lon: H.lon + b });
    const now = Date.now(), day = 864e5;
    return [
      { id: 'c-seed-1', name: 'Rundkurs Nord', created: now - 9 * day, modified: now - 9 * day, lastSent: now - 3 * 3600e3, wps: M.sampleWps() },
      { id: 'c-seed-2', name: 'Ab Home und zurück', created: now - 5 * day, modified: now - 2 * day, lastSent: null,
        wps: [{ home: true }, off(.0030, .0015), off(.0042, -.0008), off(.0012, -.0030), { home: true }] },
      { id: 'c-seed-3', name: 'Grosser Bogen', created: now - 20 * day, modified: now - 20 * day, lastSent: now - day - 5 * 3600e3,
        wps: [off(.004, 0), off(.002, .006), off(-.003, .005), off(-.004, -.002), off(0, -.004)] }
    ];
  }
  (function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) { list = JSON.parse(raw); return; } } catch (e) { /* ignore */ }
    list = seed(); persist();
  })();

  /* ---------- Kennzahlen ---------- */
  M.courseStats = (wps, home = s.home) => {
    const r = M.resolveWps(wps, home);
    let length = 0;
    for (let i = 1; i < r.length; i++) length += M.geo.dist(r[i - 1], r[i]);
    const maxHome = r.reduce((m, p) => Math.max(m, M.geo.dist(home, p)), 0);
    const speed = Math.max(M.speedLimit().kmh / 3.6, 0.3);   // m/s (Reisegeschwindigkeit bzw. Gas-Grenze)
    return {
      count: wps.length, length, duration: length / speed, speed,
      maxHome, outOfFence: maxHome > s.params.geofence,
      hasHome: wps.some(w => w.home),
      startsAtHome: !!(wps[0] && wps[0].home), endsAtHome: !!(wps.length > 1 && wps[wps.length - 1].home)
    };
  };

  /* ---------- CRUD ---------- */
  M.courses = {
    all: () => list.slice().sort((a, b) => b.modified - a.modified),
    get: id => list.find(c => c.id === id) || null,
    add(name, wps) {
      const now = Date.now();
      const c = { id: uid(), name, created: now, modified: now, lastSent: null, wps: M.clone(wps) };
      list.push(c); persist(); M.emit('courses'); return c;
    },
    update(id, patch) {
      const c = this.get(id); if (!c) return null;
      Object.assign(c, patch, { modified: Date.now() });
      if (patch.wps) c.wps = M.clone(patch.wps);
      persist(); M.emit('courses'); return c;
    },
    remove(id) { list = list.filter(c => c.id !== id); persist(); M.emit('courses'); },
    duplicate(id) { const c = this.get(id); return c ? this.add(c.name + ' (Kopie)', c.wps) : null; },
    markSent(id) { const c = this.get(id); if (c) { c.lastSent = Date.now(); persist(); M.emit('courses'); } }
  };

  /* ---------- Import ---------- */
  const okLat = v => typeof v === 'number' && isFinite(v) && Math.abs(v) <= 90;
  const okLon = v => typeof v === 'number' && isFinite(v) && Math.abs(v) <= 180;
  const pt = (lat, lon) => (okLat(lat) && okLon(lon)) ? { lat: +lat, lon: +lon } : null;

  function thin(points) {                      // gleichmaessig ausduennen, Start und Ende bleiben
    if (points.length <= MAX_WPS) return { points, thinned: false };
    const out = [];
    for (let i = 0; i < MAX_WPS; i++) out.push(points[Math.round(i * (points.length - 1) / (MAX_WPS - 1))]);
    return { points: out, thinned: true };
  }

  function parseGpx(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('GPX-Datei ist nicht lesbar');
    let nodes = [...doc.querySelectorAll('rtept')];
    if (!nodes.length) nodes = [...doc.querySelectorAll('wpt')];
    if (!nodes.length) nodes = [...doc.querySelectorAll('trkpt')];
    const points = nodes.map(n => pt(parseFloat(n.getAttribute('lat')), parseFloat(n.getAttribute('lon')))).filter(Boolean);
    const nm = doc.querySelector('rte > name, trk > name, metadata > name');
    return { name: nm ? nm.textContent.trim() : null, points };
  }

  function geoJsonPoints(g, out) {
    if (!g) return;
    if (g.type === 'FeatureCollection') g.features.forEach(f => geoJsonPoints(f, out));
    else if (g.type === 'Feature') geoJsonPoints(g.geometry, out);
    else if (g.type === 'GeometryCollection') g.geometries.forEach(x => geoJsonPoints(x, out));
    else if (g.type === 'Point') out.push(pt(g.coordinates[1], g.coordinates[0]));
    else if (g.type === 'LineString' || g.type === 'MultiPoint') g.coordinates.forEach(c => out.push(pt(c[1], c[0])));
    else if (g.type === 'MultiLineString') g.coordinates.forEach(l => l.forEach(c => out.push(pt(c[1], c[0]))));
  }

  function parseJson(text) {
    const d = JSON.parse(text);
    if (d && Array.isArray(d.wps)) return { name: d.name || null, points: d.wps.map(w => w.home ? { home: true } : pt(w.lat, w.lon)).filter(Boolean) };
    if (Array.isArray(d)) {
      return { name: null, points: d.map(w => Array.isArray(w) ? pt(w[0], w[1]) : (w && w.home ? { home: true } : pt(w && w.lat, w && (w.lon ?? w.lng)))).filter(Boolean) };
    }
    if (d && d.type) { const out = []; geoJsonPoints(d, out); return { name: (d.properties && d.properties.name) || d.name || null, points: out.filter(Boolean) }; }
    throw new Error('JSON-Format nicht erkannt');
  }

  function parseCsv(text) {
    const points = [];
    text.split(/\r?\n/).forEach(line => {
      const l = line.trim(); if (!l) return;
      if (/^home$/i.test(l)) return points.push({ home: true });
      const n = l.split(/[;,\t ]+/).map(parseFloat);
      const p = n.length >= 2 ? pt(n[0], n[1]) : null;
      if (p) points.push(p);                     // Kopfzeilen fallen automatisch weg
    });
    return { name: null, points };
  }

  /** Datei-Inhalt -> { name, wps, thinned }.  Wirft Error mit lesbarer Meldung. */
  M.parseCourseFile = (filename, text) => {
    const base = filename.replace(/\.[^.]+$/, '');
    const t = text.trim();
    let r;
    if (/\.gpx$/i.test(filename) || t.startsWith('<')) r = parseGpx(t);
    else if (t.startsWith('{') || t.startsWith('[')) r = parseJson(t);
    else r = parseCsv(t);
    if (!r.points.length) throw new Error('Keine gültigen Koordinaten gefunden');
    const th = thin(r.points);
    return { name: r.name || base, wps: th.points, thinned: th.thinned, total: r.points.length };
  };

  /* ---------- Export ---------- */
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const safe = t => t.replace(/[^\w\-äöüÄÖÜ ]+/g, '').trim().replace(/\s+/g, '_') || 'kurs';
  function download(filename, mime, content) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  M.download = download;
  M.exportCourse = (c, fmt) => {
    if (fmt === 'json') {
      download(safe(c.name) + '.json', 'application/json',
        JSON.stringify({ format: 'mfos-course', version: 1, name: c.name, created: c.created, wps: c.wps }, null, 2));
    } else {
      const r = M.resolveWps(c.wps);
      const pts = r.map((p, i) => `    <rtept lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><name>${c.wps[i].home ? 'Home' : 'WP ' + (i + 1)}</name></rtept>`).join('\n');
      download(safe(c.name) + '.gpx', 'application/gpx+xml',
        `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MFOS" xmlns="http://www.topografix.com/GPX/1/1">\n  <rte>\n    <name>${esc(c.name)}</name>\n${pts}\n  </rte>\n</gpx>\n`);
    }
  };
})();
