/* ===================================================================
   view-replay.js  –  Aufgezeichnete Fahrten abspielen, Kennzahlen,
                      Download (CSV / GPX / JSON)
   =================================================================== */
(function () {
  'use strict';
  const M = window.MFOS, s = M.state, $ = M.$;
  let map, boat, fullLine, homeMk;
  let trip = null, idx = 0, timer = null, cum = [];
  let armedDelete = false;

  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtWhen = ms => new Date(ms).toLocaleString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const playIcon = () => '<i data-icon="play">' + M.icon('play') + '</i>';
  const colorFor = v => v < 2 ? '#2cb9f5' : v < 4.5 ? '#2fd28f' : v < 6 ? '#ffb74d' : '#ff5c6c';   // v in km/h

  /* ---------- Liste ---------- */
  function renderList() {
    const all = M.trips.all();
    if (trip && !M.trips.get(trip.id)) trip = null;
    $('#tripList').innerHTML = all.length ? all.map(t => `
      <li><button data-id="${t.id}" class="${trip && trip.id === t.id ? 'active' : ''}">
        <b>${esc(t.title)} ${t.demo ? '<span class="tag">Demo</span>' : ''}</b>
        <small>${fmtWhen(t.start)} · ${M.fmtDur(t.stats.duration)} · ${M.fmtDist(t.stats.dist)} · max ${M.fmtSpd(t.stats.maxSpeed)} ${M.spdUnit()}</small></button></li>`).join('')
      : '<li class="muted small">Noch keine Fahrten.</li>';
    renderRecNote();
  }
  function renderRecNote() {
    const n = $('#recNote'), on = M.recorder.active();
    n.hidden = !on;
    if (on) n.textContent = `● Aufnahme läuft: ${M.recorder.title()} · ${M.fmtDur(M.recorder.elapsed())} – wird beim Ende gespeichert`;
  }

  /* ---------- Fahrt-Kennzahlen ---------- */
  function renderStats() {
    const box = $('#tripStats');
    $('#tripBtns').hidden = !trip;
    if (!trip) { box.innerHTML = '<div><span>Fahrt wählen</span><b>–</b></div>'; return; }
    const st = trip.stats, kv = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
    $('#tripBtns [data-dl=del]').hidden = !!trip.demo;
    $('#tripBtns [data-dl=del]').textContent = armedDelete ? 'Wirklich löschen?' : 'Löschen';
    box.innerHTML =
      kv('Start', fmtWhen(trip.start)) + kv('Dauer', M.fmtDur(st.duration)) + kv('Strecke', M.fmtDist(st.dist)) +
      kv('Ø / max. Geschwindigkeit', `${M.fmtSpd(st.avgSpeed)} / ${M.fmtSpd(st.maxSpeed)} ${M.spdUnit()}`) +
      kv('Energie', `${st.mah.toFixed(0)} mAh · ${st.wh.toFixed(1)} Wh`) +
      kv('Min. Spannung / max. Strom', `${st.minV.toFixed(2)} V / ${st.maxA.toFixed(1)} A`) +
      kv('Max. Temperatur ESC / Innen', `${st.maxEsc.toFixed(1)} / ${st.maxHull.toFixed(1)} °C`) +
      kv('Ende', esc(trip.reason));
  }

  /* ---------- Auswahl und Wiedergabe ---------- */
  function select(id) {
    stop();
    trip = M.trips.get(id); idx = 0; armedDelete = false;
    if (!trip) return;
    cum = [0];
    for (let i = 1; i < trip.samples.length; i++) cum.push(cum[i - 1] + M.geo.dist(trip.samples[i - 1], trip.samples[i]));
    if (fullLine) fullLine.remove();
    fullLine = L.layerGroup().addTo(map);
    for (let i = 0; i < trip.samples.length - 1; i += 10) {
      const seg = trip.samples.slice(i, i + 11).map(p => [p.lat, p.lon]);
      L.polyline(seg, { color: colorFor(trip.samples[i].speed), weight: 4, opacity: .85 }).addTo(fullLine);
    }
    map.fitBounds(trip.samples.map(p => [p.lat, p.lon]), { padding: [50, 50], maxZoom: 18 });
    $('#rSlider').max = trip.samples.length - 1; $('#rSlider').value = 0;
    renderList(); renderStats(); show();
  }

  function show() {
    if (!trip || !map) return;
    const i = Math.floor(idx), p = trip.samples[i];
    boat.setLatLng([p.lat, p.lon]);
    M.setBoatHeading(boat, p.heading);
    $('#rSlider').value = i;
    $('#rClock').textContent = `${M.fmtDur((p.t - trip.samples[0].t) / 1000)} / ${M.fmtDur(trip.stats.duration)}`;
    $('#rSpd').textContent = `${M.fmtSpd(p.speed)} ${M.spdUnit()}`;
    $('#rHdg').textContent = Math.round(p.heading) + ' °';
    $('#rThr').textContent = `${p.thr} % / ${p.rud} %`;
    $('#rV').textContent = `${p.v.toFixed(2)} V / ${p.a.toFixed(1)} A`;
    $('#rEsc').textContent = `${p.esc.toFixed(1)} / ${p.hull.toFixed(1)} °C`;
    $('#rWp').textContent = p.wp;
    $('#rDist').textContent = M.fmtDist(cum[i]);
  }

  function play() {
    if (!trip) return M.toast('Zuerst eine Fahrt wählen', 'warn');
    if (idx >= trip.samples.length - 1) idx = 0;
    $('#rPlay').innerHTML = '<i data-icon="pause">' + M.icon('pause') + '</i>';
    timer = setInterval(() => {
      idx = Math.min(trip.samples.length - 1, idx + Number($('#rSpeed').value) / 4);
      show();
      if (idx >= trip.samples.length - 1) stop();
    }, 250);
  }
  function stop() { clearInterval(timer); timer = null; $('#rPlay').innerHTML = playIcon(); }

  /* ---------- Events ---------- */
  $('#rPlay').addEventListener('click', () => timer ? stop() : play());
  $('#rSlider').addEventListener('input', e => { idx = Math.floor(Number(e.target.value)); show(); });
  $('#tripList').addEventListener('click', e => { const b = e.target.closest('button'); if (b) select(b.dataset.id); });
  $('#tripBtns').addEventListener('click', e => {
    const b = e.target.closest('[data-dl]'); if (!b || !trip) return;
    const k = b.dataset.dl;
    if (k !== 'del') { M.exportTrip(trip, k); return M.toast(`${k.toUpperCase()} heruntergeladen (${trip.samples.length} Messwerte)`, 'ok'); }
    if (!armedDelete) { armedDelete = true; renderStats(); setTimeout(() => { armedDelete = false; renderStats(); }, 3000); return; }
    const id = trip.id; stop(); trip = null; armedDelete = false; M.trips.remove(id);
  });

  M.on('trips', () => { renderList(); if (!trip) { const f = M.trips.all()[0]; if (f && map) select(f.id); else renderStats(); } });
  M.on('recording', renderRecNote);
  M.on('tick', () => { if (M.currentView === 'replay') renderRecNote(); });
  M.on('units', () => { renderList(); renderStats(); show(); });

  M.on('view', id => {
    if (id !== 'replay') return;
    if (!map) {
      map = M.maps.create('replayMap', { center: s.home, zoom: 16 });
      boat = L.marker([s.home.lat, s.home.lon], { icon: M.mapIcons.boat() }).addTo(map);
      homeMk = L.marker([s.home.lat, s.home.lon], { icon: M.mapIcons.home() }).addTo(map);
      renderList();
      const first = M.trips.all()[0];
      if (first) select(first.id); else renderStats();
    }
    renderList();
    setTimeout(() => map.invalidateSize(), 30);
  });
  $('#rPlay').innerHTML = playIcon();
})();
