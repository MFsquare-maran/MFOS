/* ===================================================================
   view-energy.js  –  Telemetrie: Kacheln + je Messgroesse ein Graph
   Zeitfenster: feste Werte (1 min bis 5 h) oder eigener Wert,
   Zoom/Verschieben, Graphen fuellen das Fenster.
   =================================================================== */
(function () {
  'use strict';
  const M = window.MFOS, s = M.state, $ = M.$;
  const MAX_RANGE = 18000;         // 5 h in Sekunden
  const MAX_POINTS = 900;          // pro Graph; laengere Zeitraeume werden gemittelt
  let range = 300;                 // Sekunden
  let frozen = false;              // nach Zoom/Verschieben: Live-Aktualisierung pausiert
  let syncing = false;
  const charts = {};

  /* ---------- Welche Graphen es gibt (je Messgroesse einer) ---------- */
  const CHARTS = [
    { id: 'chV', title: 'Spannung', unit: () => 'V', field: 'v', color: 'c1' },
    { id: 'chA', title: 'Strom', unit: () => 'A', field: 'a', color: 'c2' },
    { id: 'chW', title: 'Leistung', unit: () => 'W', field: 'w', color: 'c3', fill: true },
    { id: 'chTh', title: 'Temperatur Innenraum', unit: () => '°C', field: 'hull', color: 'c1' },
    { id: 'chTe', title: 'Temperatur ESC', unit: () => '°C', field: 'esc', color: 'c4' },
    { id: 'chSpd', title: 'Geschwindigkeit', unit: () => M.spdUnit(), field: 'speed', conv: v => M.spd(v), color: 'c1', fill: true },
    { id: 'chRoll', title: 'Lage: Roll', unit: () => '°', field: 'roll', color: 'c2' },
    { id: 'chPitch', title: 'Lage: Pitch', unit: () => '°', field: 'pitch', color: 'c3' },
    { id: 'chP', title: 'Luftdruck', unit: () => 'hPa', field: 'p', color: 'c1' }
  ];
  $('#chartGrid').innerHTML = CHARTS.map(c =>
    `<div class="card"><h3>${c.title}</h3><div class="chart-box"><canvas id="${c.id}"></canvas></div></div>`).join('');

  /* ---------- Kacheln ---------- */
  const TILES = [
    ['Spannung', () => M.fmt(s.power.v, 2), 'V', () => s.power.v <= s.params.battCrit ? 'crit' : s.power.v <= s.params.battWarn ? 'warn' : ''],
    ['Strom', () => M.fmt(s.power.a, 1), 'A'],
    ['Leistung', () => M.fmt(s.power.w, 0), 'W'],
    ['Akku', () => M.fmt(M.soc(s.power.v), 0), '%'],
    ['Verbraucht', () => M.fmt(s.power.mah, 0), 'mAh'],
    ['Energie', () => M.fmt(s.power.wh, 1), 'Wh'],
    ['Restlaufzeit', () => M.fmtDur(Math.max(0, s.params.battCap - s.power.mah) / Math.max(s.power.a * 1000, 1) * 3600), ''],
    ['Innenraum', () => M.fmt(s.temps.hull, 1), '°C', () => s.temps.hull >= s.params.hullWarn ? 'warn' : ''],
    ['ESC-Temperatur', () => M.fmt(s.temps.esc, 1), '°C', () => s.temps.esc >= s.params.escCrit ? 'crit' : s.temps.esc >= s.params.escWarn ? 'warn' : ''],
    ['Luftdruck', () => M.fmt(s.pressure, 1), 'hPa']
  ];
  $('#energyTiles').innerHTML = TILES.map((t, i) => `<div class="tile" id="tile${i}"><label>${t[0]}</label><b></b><small>${t[2]}</small></div>`).join('');
  function updateTiles() {
    TILES.forEach((t, i) => {
      const el = $('#tile' + i);
      el.querySelector('b').textContent = t[1]();
      el.className = 'tile ' + (t[3] ? t[3]() : '');
    });
  }

  /* ---------- Charts ---------- */
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function palette() { return { text: css('--muted'), grid: css('--line'), c1: css('--accent'), c2: css('--warn'), c3: css('--ok'), c4: css('--crit') }; }

  function make(cfg) {
    const c = palette(), col = c[cfg.color], unit = cfg.unit();
    Chart.defaults.color = c.text; Chart.defaults.font.size = 11;
    charts[cfg.id] = new Chart($('#' + cfg.id), {
      type: 'line',
      data: { labels: [], datasets: [{ label: `${cfg.title} [${unit}]`, borderColor: col, backgroundColor: col + '33', fill: !!cfg.fill, borderWidth: 2, pointRadius: 0, tension: .3, data: [] }] },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          zoom: {
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, drag: { enabled: true, backgroundColor: 'rgba(44,185,245,.18)', borderColor: c.c1, borderWidth: 1 }, mode: 'x', onZoomComplete: onZoomed },
            pan: { enabled: true, mode: 'x', modifierKey: 'shift', onPanComplete: onZoomed }
          }
        },
        scales: {
          x: { ticks: { maxTicksLimit: 6, maxRotation: 0 }, grid: { color: c.grid } },
          y: { grid: { color: c.grid }, position: 'left', title: { display: true, text: unit } }
        }
      }
    });
  }
  const build = () => CHARTS.forEach(make);

  /* Zoom: alle Graphen teilen sich die Zeitachse; waehrend gezoomt wird, pausiert die Live-Aktualisierung */
  function onZoomed({ chart }) {
    if (syncing) return;
    frozen = true; $('#zoomReset').hidden = false;
    const { min, max } = chart.scales.x;
    syncing = true;
    Object.values(charts).forEach(c => { if (c !== chart) c.zoomScale('x', { min, max }, 'none'); });
    syncing = false;
  }
  function resetZoom() {
    syncing = true;                                      // resetZoom loest selbst onZoomComplete aus
    Object.values(charts).forEach(c => c.resetZoom('none'));
    syncing = false;
    frozen = false; $('#zoomReset').hidden = true;
    refresh();
  }
  $('#zoomReset').addEventListener('click', resetZoom);

  /* Lange Zeitraeume: auf hoechstens MAX_POINTS Punkte mitteln (Zeitstempel = Mitte des Abschnitts) */
  function decimate(h) {
    if (h.length <= MAX_POINTS) return h;
    const k = Math.ceil(h.length / MAX_POINTS), out = [];
    const keys = Object.keys(h[0]).filter(f => f !== 't');
    for (let i = 0; i < h.length; i += k) {
      const seg = h.slice(i, i + k), o = { t: seg[Math.floor(seg.length / 2)].t };
      keys.forEach(f => { o[f] = seg.reduce((a, p) => a + p[f], 0) / seg.length; });
      out.push(o);
    }
    return out;
  }

  function refresh() {
    updateRangeInfo();
    if (frozen) return;                                  // gezoomt: Daten nicht verschieben
    const h = decimate(s.history.slice(-range));
    const labels = h.map(p => M.fmtTime(p.t));
    CHARTS.forEach(cfg => {
      const ch = charts[cfg.id]; if (!ch) return;
      ch.data.labels = labels;
      ch.data.datasets[0].data = h.map(p => cfg.conv ? Math.round(cfg.conv(p[cfg.field]) * 100) / 100 : p[cfg.field]);
      ch.update('none');
    });
  }

  /* ---------- Zeitfenster ---------- */
  const fmtRange = sec => sec >= 3600 ? `${+(sec / 3600).toFixed(2)} h` : sec >= 60 ? `${+(sec / 60).toFixed(1)} min` : `${sec} s`;
  function updateRangeInfo() {
    const have = s.history.length;
    $('#rangeInfo').textContent = have < range ? `Daten vorhanden: ${fmtRange(have)} von ${fmtRange(range)}` : `Zeigt ${fmtRange(range)}`;
  }
  function setRange(sec, fromCustom) {
    range = Math.min(MAX_RANGE, Math.max(10, Math.round(sec)));
    let match = false;
    document.querySelectorAll('[data-range]').forEach(x => { const on = Number(x.dataset.range) === range; x.classList.toggle('active', on); match = match || on; });
    document.querySelector('.range-custom').classList.toggle('active', !match);
    if (!fromCustom) {                                   // Eingabefeld auf das gewaehlte Fenster setzen
      const unit = range % 3600 === 0 ? 3600 : range % 60 === 0 ? 60 : 1;
      $('#rangeUnit').value = unit; $('#rangeVal').value = range / unit;
    }
    if (charts.chV) resetZoom(); else refresh();
  }
  document.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => setRange(Number(b.dataset.range))));
  function applyCustom() {
    const v = Number($('#rangeVal').value), unit = Number($('#rangeUnit').value);
    if (!(v > 0)) return;
    const sec = v * unit;
    if (sec > MAX_RANGE) M.toast('Höchstens 5 Stunden', 'warn');
    if (sec < 10) M.toast('Mindestens 10 Sekunden', 'warn');
    setRange(sec, false);
  }
  $('#rangeVal').addEventListener('change', applyCustom);
  $('#rangeUnit').addEventListener('change', applyCustom);
  $('#rangeVal').addEventListener('keydown', e => { if (e.key === 'Enter') applyCustom(); });

  /* ---------- Layout: Graphen fuellen das Fenster ---------- */
  // Spaltenzahl nach Breite (1 bis 3), Kartenhoehe so, dass alle Reihen auf den Bildschirm passen (mind. 220 px)
  function layout() {
    const grid = $('#chartGrid'), mainEl = $('main');
    if (!grid || M.currentView !== 'energy') return;
    const W = grid.clientWidth;
    const cols = W >= 1100 ? 3 : W >= 760 ? 2 : 1;
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    const n = grid.children.length, rows = Math.ceil(n / cols);
    const gap = parseFloat(getComputedStyle(grid).rowGap) || 16;
    const top = grid.getBoundingClientRect().top - mainEl.getBoundingClientRect().top + mainEl.scrollTop;
    const card = (mainEl.clientHeight - top - 20 - (rows - 1) * gap) / rows;
    const h = Math.max(220, Math.floor(card - 64));                  // Karte: Innenabstand + Titel
    grid.querySelectorAll('.chart-box').forEach(b => { b.style.height = h + 'px'; });
  }
  let layoutTimer = null;
  window.addEventListener('resize', () => { clearTimeout(layoutTimer); layoutTimer = setTimeout(layout, 80); });

  /* ---------- Events ---------- */
  M.on('tick', () => { if (M.currentView === 'energy') { updateTiles(); refresh(); } });
  M.on('view', id => { if (id === 'energy') { layout(); if (!charts.chV) build(); updateTiles(); layout(); refresh(); } });
  function rebuild() {                       // Theme- oder Einheitenwechsel: Graphen neu aufbauen
    if (!charts.chV) return;
    Object.values(charts).forEach(c => c.destroy());
    Object.keys(charts).forEach(k => delete charts[k]);
    frozen = false; $('#zoomReset').hidden = true;
    if (M.currentView === 'energy') { build(); refresh(); }
  }
  M.on('theme', rebuild);
  M.on('units', rebuild);
})();
