/* ===================================================================
   view-mission.js  –  Missionsplaner: Wegpunkte per Klick setzen,
                       verschieben, sortieren, an das Boot senden
   =================================================================== */
(function () {
  'use strict';
  const M = window.MFOS, s = M.state, $ = M.$;
  let map, line, boat, homeMk, markers = [], rg;
  let draft = M.clone(s.mission.wps);
  let loaded = s.mission.courseId ? { id: s.mission.courseId, name: s.mission.name } : null;   // Kurs, aus dem der Entwurf stammt
  let pendingFit = false;

  const dirty = () => JSON.stringify(draft) !== JSON.stringify(s.mission.wps);

  /* ---------- Home-Position ---------- */
  let homeDraft = { ...s.home }, picking = false;
  const homeDirty = () => homeDraft.lat !== s.home.lat || homeDraft.lon !== s.home.lon;
  function renderHome() {
    ['hLat', 'hLon'].forEach(id => {
      const el = $('#' + id), v = homeDraft[id === 'hLat' ? 'lat' : 'lon'];
      if (document.activeElement !== el) el.value = v.toFixed(5);
      el.closest('.field').classList.toggle('changed', homeDirty());
    });
    const tag = $('#hSync');
    if (s.homeSync === 'pending') { tag.textContent = 'Wird übertragen…'; tag.className = 'tag warn'; }
    else if (homeDirty()) { tag.textContent = 'Entwurf – nicht gesendet'; tag.className = 'tag warn'; }
    else { tag.textContent = 'Auf Boot aktiv'; tag.className = 'tag ok'; }
    $('#hSend').disabled = !homeDirty() || s.homeSync === 'pending';
    $('#hPick').classList.toggle('armed', picking);
    $('#hPick').textContent = picking ? 'Karte anklicken…' : 'Auf Karte wählen';
    if (map) { homeMk.setLatLng([homeDraft.lat, homeDraft.lon]); map.getContainer().style.cursor = picking ? 'crosshair' : ''; }
  }
  function setHomeDraft(lat, lon) {
    if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return M.toast('Ungültige Koordinaten', 'warn');
    homeDraft = { lat, lon }; picking = false; renderHome(); render();
  }

  // Entwurf mit aufgeloesten Home-Wegpunkten (Vorschau nutzt den Home-Entwurf)
  const resolved = () => M.resolveWps(draft, homeDraft);
  function pathDist() {
    const r = resolved();
    let d = 0;
    for (let i = 1; i < r.length; i++) d += M.geo.dist(r[i - 1], r[i]);
    if (s.params.loop && r.length > 2) d += M.geo.dist(r[r.length - 1], r[0]);
    return d;
  }

  function render() {
    // Liste
    const list = $('#wpList');
    if (!draft.length) list.innerHTML = '<li class="empty">Noch keine Wegpunkte – Karte anklicken</li>';
    else list.innerHTML = draft.map((dw, i) => {
      const r = resolved(), w = r[i];
      const leg = i ? M.fmtDist(M.geo.dist(r[i - 1], w)) + ' vom vorigen' : 'Start';
      return `<li data-i="${i}">
        <span class="wp-num ${dw.home ? 'home' : ''}">${dw.home ? 'H' : i + 1}</span>
        <span class="wp-meta"><b class="${dw.home ? '' : 'mono'}">${dw.home ? 'Home-Position' : w.lat.toFixed(5) + ', ' + w.lon.toFixed(5)}</b>${leg}</span>
        <span class="wp-btns">
          <button data-act="up" title="Nach oben">▲</button><button data-act="down" title="Nach unten">▼</button>
          <button data-act="del" title="Löschen">✕</button></span></li>`;
    }).join('');

    // Summen
    const d = pathDist(), v = Math.max(M.speedLimit().kmh / 3.6, 0.3);
    $('#mDist').textContent = M.fmtDist(d);
    $('#mDur').textContent = draft.length > 1 ? M.fmtDur(d / v) : '–';

    // Sync-Status
    const tag = $('#mSync');
    if (s.mission.sync === 'pending') { tag.textContent = 'Wird übertragen…'; tag.className = 'tag warn'; }
    else if (dirty()) { tag.textContent = 'Entwurf – nicht gesendet'; tag.className = 'tag warn'; }
    else { tag.textContent = 'Auf Boot aktiv' + (s.mission.name ? ': ' + s.mission.name : ''); tag.className = 'tag ok'; }
    $('#mSend').disabled = !draft.length || !dirty() || s.mission.sync === 'pending';
    $('#mSave').disabled = !draft.length;

    drawMap();
  }

  function drawMap() {
    if (!map) return;
    markers.forEach(m => m.remove()); markers = [];
    draft.forEach((w, i) => {
      if (w.home) return;                                // Home-Wegpunkt: der H-Marker genuegt
      const m = L.marker([w.lat, w.lon], { icon: M.mapIcons.wp(i + 1), draggable: true }).addTo(map);
      m.on('dragend', () => { const p = m.getLatLng(); draft[i] = { lat: p.lat, lon: p.lng }; render(); });
      markers.push(m);
    });
    const pts = resolved().map(w => [w.lat, w.lon]);
    if (s.params.loop && pts.length > 2) pts.push(pts[0]);
    line.setLatLngs(pts);
    // Ankunftsradius um jeden Wegpunkt (aktueller Parameterwert)
    rg.clearLayers();
    resolved().forEach(p => L.circle([p.lat, p.lon], { radius: s.params.arriveRadius, color: '#ffb74d', weight: 1.5, fillColor: '#ffb74d', fillOpacity: .16, interactive: false }).addTo(rg));
  }

  function initMap() {
    map = M.maps.create('missionMap', { center: s.home, zoom: 16 });
    rg = L.layerGroup().addTo(map);
    line = L.polyline([], { color: '#ffb74d', weight: 3, dashArray: '8 6' }).addTo(map);
    homeMk = L.marker([homeDraft.lat, homeDraft.lon], { icon: M.mapIcons.home(), draggable: true, zIndexOffset: 500 }).addTo(map);
    homeMk.on('dragend', () => { const p = homeMk.getLatLng(); setHomeDraft(p.lat, p.lng); });
    boat = L.marker([s.pos.lat, s.pos.lon], { icon: M.mapIcons.boat(), interactive: false, opacity: .8 }).addTo(map);
    map.on('click', e => {
      if (picking) return setHomeDraft(e.latlng.lat, e.latlng.lng);
      draft.push({ lat: e.latlng.lat, lon: e.latlng.lng }); render();
    });
    if (draft.length) map.fitBounds(resolved().map(w => [w.lat, w.lon]), { padding: [60, 60], maxZoom: 17 });
    render();
  }

  /* ---------- Parameter-Block (gleiche Werte wie Steuerung) ---------- */
  function renderParams() {
    M.updateLimitNote($('#mLimit'));
    const keys = ['cruiseSpeed', 'maxThrottle', 'arriveRadius', 'loop'];
    $('#mParams').innerHTML = keys.map(k => M.paramField(M.PARAM_DEFS.find(d => d.key === k), s.params[k])).join('');
    $('#mParams').querySelectorAll('[data-key]').forEach(inp => inp.addEventListener('change', () => {
      const def = M.PARAM_DEFS.find(d => d.key === inp.dataset.key);
      const p = M.clone(s.params);
      p[def.key] = M.readParam(def, inp);
      M.actions.sendParams(p);
    }));
  }

  /* ---------- Events ---------- */
  $('#wpList').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const i = Number(b.closest('li').dataset.i);
    if (b.dataset.act === 'del') draft.splice(i, 1);
    if (b.dataset.act === 'up' && i > 0) [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]];
    if (b.dataset.act === 'down' && i < draft.length - 1) [draft[i + 1], draft[i]] = [draft[i], draft[i + 1]];
    render();
  });
  $('#mHome').addEventListener('click', () => { draft.push({ home: true }); render(); });
  $('#mClear').addEventListener('click', () => { draft = []; render(); });
  $('#mSample').addEventListener('click', () => {
    const c = map ? map.getCenter() : { lat: s.home.lat, lng: s.home.lon };
    draft = [0, 1, 2, 3, 4, 5].map(i => {
      const a = i / 6 * 2 * Math.PI;
      return { lat: c.lat + Math.sin(a) * 0.0025, lon: c.lng + Math.cos(a) * 0.0038 };
    });
    render();
  });
  // Beim Senden den Kursnamen mitgeben; wurde der Kurs seit dem Laden veraendert, als "(geaendert)" kennzeichnen
  $('#mSend').addEventListener('click', () => {
    const c = loaded && M.courses.get(loaded.id);
    let meta = {};
    if (c) meta = JSON.stringify(c.wps) === JSON.stringify(draft) ? { id: c.id, name: c.name } : { name: c.name + ' (geändert)' };
    else if ($('#mName').value.trim()) meta = { name: $('#mName').value.trim() };
    M.actions.sendMission(draft, meta);
  });

  $('#mSave').addEventListener('click', () => {
    const name = $('#mName').value.trim();
    if (!name) { $('#mName').focus(); return M.toast('Bitte einen Kursnamen eingeben', 'warn'); }
    const c = loaded && M.courses.get(loaded.id);
    if (c && c.name === name) { M.courses.update(c.id, { wps: draft }); M.toast(`Kurs «${name}» aktualisiert`, 'ok'); }
    else { const n = M.courses.add(name, draft); loaded = { id: n.id, name: n.name }; M.toast(`Kurs «${name}» gespeichert`, 'ok'); }
  });

  /* Von der Kurs-Ansicht aus nutzbar: Kurs in den Planer laden (null = leerer neuer Kurs) */
  M.planner = {
    load(c) {
      draft = c ? M.clone(c.wps) : [];
      loaded = c ? { id: c.id, name: c.name } : null;
      $('#mName').value = c ? c.name : '';
      pendingFit = !!c; render();
    }
  };

  $('#hPick').addEventListener('click', () => { picking = !picking; renderHome(); });
  $('#hBoat').addEventListener('click', () => setHomeDraft(s.pos.lat, s.pos.lon));
  const fromInputs = () => setHomeDraft(parseFloat($('#hLat').value), parseFloat($('#hLon').value));
  $('#hLat').addEventListener('change', fromInputs);
  $('#hLon').addEventListener('change', fromInputs);
  $('#hSend').addEventListener('click', () => M.actions.sendHome(homeDraft));
  M.on('home', () => { if (s.homeSync === 'ok') homeDraft = { ...s.home }; renderHome(); render(); });

  M.on('mission', () => {
    // Nach Quittung Entwurf nicht ueberschreiben, ausser er war identisch
    render();
  });
  M.on('params', () => { renderParams(); render(); });
  M.on('units', renderParams);
  M.on('tick', () => { if (map && M.currentView === 'mission') boat.setLatLng([s.pos.lat, s.pos.lon]); });
  M.on('view', id => {
    if (id !== 'mission') return;
    if (!map) initMap();
    setTimeout(() => {
      map.invalidateSize();
      if (pendingFit && draft.length) { map.fitBounds(resolved().map(w => [w.lat, w.lon]), { padding: [60, 60], maxZoom: 17 }); }
      pendingFit = false;
    }, 30);
  });

  $('#mName').value = loaded ? loaded.name : '';
  renderParams();
  render();
  renderHome();
})();
