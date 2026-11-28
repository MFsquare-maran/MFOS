/* ===================================================================
   view-live.js  –  Live-Ansicht: Karte, Fahrdaten, Kompass, Lage,
                    Sollwerte, Energie, Temperaturen, Aktionen
   =================================================================== */
(function () {
  'use strict';
  const M = window.MFOS, s = M.state, $ = M.$;
  let map, boat, trackLine, routeLine, targetLine, fence, wpMarkers = [], homeMarker, radiusGroup;
  const radiusStyle = () => ({ radius: s.params.arriveRadius, color: '#ffb74d', weight: 1.5, fillColor: '#ffb74d', fillOpacity: .16, interactive: false });
  let follow = true;

  /* ---------- SVG-Instrumente ---------- */
  function buildCompass() {
    let ticks = '';
    for (let a = 0; a < 360; a += 15) {
      const major = a % 90 === 0, mid = a % 30 === 0;
      ticks += `<line x1="60" y1="${major ? 8 : mid ? 10 : 12}" x2="60" y2="16" stroke="currentColor" stroke-width="${major ? 2 : 1}" transform="rotate(${a} 60 60)" opacity="${mid ? 1 : .5}"/>`;
    }
    const lab = [['N', 0], ['O', 90], ['S', 180], ['W', 270]]
      .map(([t, a]) => `<text x="60" y="30" text-anchor="middle" font-size="11" font-weight="700" fill="${t === 'N' ? 'var(--crit)' : 'currentColor'}" transform="rotate(${a} 60 60)">${t}</text>`).join('');
    $('#compass').innerHTML = `
      <circle cx="60" cy="60" r="56" fill="var(--panel2)" stroke="var(--line)" stroke-width="2"/>
      <g id="cmpRing">${ticks}${lab}
        <g id="cmpTarget" style="display:none"><path d="M60 5 L66 17 L54 17 Z" fill="var(--warn)"/></g>
      </g>
      <g transform="translate(60 60) scale(.62) translate(-12 -30)" stroke-linejoin="round">
        <path d="M12 1.5C15.8 11 20.3 22 20.8 34C21 42 20.8 50 19.8 56H4.2C3.2 50 3 42 3.2 34C3.7 22 8.2 11 12 1.5Z" fill="var(--accent)" stroke="var(--text)" stroke-width="1.8"/>
      </g>
      <path d="M60 0 L65 9 L55 9 Z" fill="var(--text)"/>`;
  }
  function buildHorizon() {
    $('#horizon').innerHTML = `
      <defs><clipPath id="hzClip"><circle cx="60" cy="60" r="54"/></clipPath></defs>
      <circle cx="60" cy="60" r="56" fill="var(--panel2)" stroke="var(--line)" stroke-width="2"/>
      <g clip-path="url(#hzClip)"><g id="hzRot">
        <rect x="-60" y="-100" width="240" height="160" fill="#4da3d9"/>
        <rect x="-60" y="60" width="240" height="160" fill="#1f5f86"/>
        <line x1="-60" y1="60" x2="180" y2="60" stroke="#fff" stroke-width="1.5"/>
        <g stroke="#fff" stroke-width="1" opacity=".7">
          <line x1="48" y1="40" x2="72" y2="40"/><line x1="52" y1="50" x2="68" y2="50"/>
          <line x1="52" y1="70" x2="68" y2="70"/><line x1="48" y1="80" x2="72" y2="80"/>
        </g></g></g>
      <path d="M28 62h18M74 62h18M60 62v0" stroke="var(--warn)" stroke-width="3" stroke-linecap="round"/>
      <circle cx="60" cy="62" r="3" fill="var(--warn)"/>`;
  }

  /* ---------- Karte ---------- */
  function initMap() {
    map = M.maps.create('liveMap', { center: s.pos, zoom: 17 });
    boat = L.marker([s.pos.lat, s.pos.lon], { icon: M.mapIcons.boat(), zIndexOffset: 1000 }).addTo(map);
    trackLine = L.polyline([], { color: '#2cb9f5', weight: 3, opacity: .8 }).addTo(map);
    routeLine = L.polyline([], { color: '#ffb74d', weight: 2, dashArray: '6 6', opacity: .9 }).addTo(map);
    targetLine = L.polyline([], { color: '#ffb74d', weight: 2 }).addTo(map);
    homeMarker = L.marker([s.home.lat, s.home.lon], { icon: M.mapIcons.home() }).addTo(map);
    fence = L.circle([s.home.lat, s.home.lon], { radius: s.params.geofence, color: '#ff5c6c', weight: 1.5, dashArray: '4 6', fill: false }).addTo(map);
    radiusGroup = L.layerGroup().addTo(map);
    trackLine.setLatLngs(s.track.map(p => [p.lat, p.lon]));
    map.on('dragstart', () => { follow = false; $('#followChk').checked = false; });
    drawMission();
  }
  function drawMission() {
    if (!map) return;
    wpMarkers.forEach(m => m.remove()); wpMarkers = [];
    const wps = M.resolveWps(s.mission.wps);
    // Ankunftsradius: Kreis um jeden Wegpunkt und um Home (Ziel von Return Home)
    radiusGroup.clearLayers();
    wps.concat([s.home]).forEach(p => L.circle([p.lat, p.lon], radiusStyle()).addTo(radiusGroup));
    wps.forEach((w, i) => {
      if (s.mission.wps[i].home) return;                 // Home-Wegpunkt: der H-Marker genuegt
      const st = i < s.mission.active ? 'done' : i === s.mission.active && s.mode === 'AUTO' ? 'active' : '';
      wpMarkers.push(L.marker([w.lat, w.lon], { icon: M.mapIcons.wp(i + 1, st) }).addTo(map));
    });
    const pts = wps.map(w => [w.lat, w.lon]);
    if (M.state.params.loop && pts.length > 2) pts.push(pts[0]);
    routeLine.setLatLngs(pts);
  }

  /* ---------- Aktualisierung ---------- */
  const set = (id, txt) => { $(id).textContent = txt; };
  function update() {
    const P = s.params;
    // Fahrdaten
    set('#lvSpeed', M.fmtSpd(s.speed));
    set('#lvSpeedUnit', M.spdUnit());
    set('#lvHeading', Math.round(s.heading));
    set('#lvMission', s.mission.name || 'ohne Namen');
    set('#lvMode', s.test.active ? 'Testmodus' : M.MODES[s.mode] + (s.armed ? '' : ' · nicht scharf'));
    if (s.targetBrg != null) {
      const dev = M.geo.wrap180(s.targetBrg - s.heading);
      set('#lvBrg', `${Math.round(s.targetBrg)} ° / ${dev > 0 ? '+' : ''}${dev.toFixed(0)} °`);
    } else set('#lvBrg', '–');
    set('#lvTrip', M.recorder.active() ? `${M.fmtDur(M.recorder.elapsed())} / ${M.fmtDist(M.recorder.distance())}` : 'keine Aufnahme');
    set('#lvGps', s.gps.fix ? `${s.gps.sats} Sat. · HDOP ${M.fmt(s.gps.hdop, 1)}` : 'Kein Fix');
    set('#lvLte', s.net.active === 'wifi' ? `WLAN ${s.net.wifi.rssi.toFixed(0)} dBm · ${s.latency} ms`
      : s.net.active === 'lte' ? `LTE ${s.lte.dbm.toFixed(0)} dBm · ${s.online ? s.latency + ' ms' : 'offline'}` : 'keine Verbindung');
    set('#lvPress', M.fmt(s.pressure, 1) + ' hPa');
    const t = s.target;
    if (t) {
      const d = M.geo.dist(s.pos, t), v = Math.max(s.speed / 3.6, 0.3);
      set('#lvWp', s.mode === 'RTH' ? 'Home' : `${s.mission.active + 1} / ${s.mission.wps.length}`);
      set('#lvEta', `${M.fmtDist(d)} · ${M.fmtDur(d / v)}`);
      set('#mapTarget', `→ ${s.mode === 'RTH' ? 'Home' : 'WP ' + (s.mission.active + 1)} · ${M.fmtDist(d)}`);
    } else {
      set('#lvWp', '–'); set('#lvEta', '–'); set('#mapTarget', '–');
    }
    set('#lvHome', M.fmtDist(M.geo.dist(s.home, s.pos)));
    set('#lvPos', M.fmtPos(s.pos));
    set('#lvRoll', M.fmt(s.roll, 1) + ' °');
    set('#lvPitch', M.fmt(s.pitch, 1) + ' °');

    // Instrumente
    $('#cmpRing').setAttribute('transform', `rotate(${-s.heading} 60 60)`);
    const ct = $('#cmpTarget');
    ct.style.display = s.targetBrg == null ? 'none' : '';
    if (s.targetBrg != null) ct.setAttribute('transform', `rotate(${s.targetBrg} 60 60)`);
    $('#hzRot').setAttribute('transform', `translate(0 ${s.pitch * 2}) rotate(${-s.roll} 60 60)`);

    // Sollwerte
    $('#barThr').style.width = s.cmd.throttle + '%';
    set('#lvThr', M.fmt(s.cmd.throttle, 0) + ' %');
    const r = (s.cmd.rudder - 50) * 2;                       // -100 .. +100
    const bar = $('#barRud');
    bar.style.left = (r < 0 ? 50 + r / 2 : 50) + '%';
    bar.style.width = Math.abs(r) / 2 + '%';
    set('#lvRud', `${r > 0 ? 'SB ' : r < 0 ? 'BB ' : ''}${Math.abs(r).toFixed(0)} %`);

    // (Energie, Temperaturen und Systeme stehen in der Leiste oben, siehe ui.js)

    // Buttons
    const est = s.mode === 'ESTOP';
    const arm = $('#btnArm');
    arm.classList.toggle('is-armed', s.armed);
    arm.disabled = est;
    arm.querySelector('span').textContent = s.armed ? 'Scharf – Entschärfen' : 'Scharf schalten';
    arm.querySelector('i').innerHTML = M.icon(s.armed ? 'unlock' : 'lock');
    $('#btnStart').disabled = !s.armed || s.mode === 'AUTO' || s.mode === 'TUNE' || est;
    $('#btnRth').disabled = !s.armed || s.mode === 'RTH' || s.mode === 'TUNE' || est;
    $('#btnStart').title = $('#btnRth').title = s.armed ? '' : 'Erst scharf schalten';
    $('#btnManual').disabled = !s.armed || s.mode === 'MANUAL' || s.mode === 'TUNE' || est;
    $('#btnManual').title = s.armed ? 'Gas und Ruder kommen vom Sender' : 'Erst scharf schalten';
    $('#btnSoft').disabled = !s.armed || s.mode === 'SOFT' || s.mode === 'TUNE' || est;
    $('#btnSoft').title = s.armed ? 'Tempo stellst du hier ein, das Ruder kommt von der Funke' : 'Erst scharf schalten';
    renderSoft();
    $('#btnStop').disabled = s.mode === 'STOP' || est;
    // aktiver Modus leuchtet (Mission, Manuell, Soft, Return Home, Stopp)
    [['#btnStart', 'AUTO'], ['#btnManual', 'MANUAL'], ['#btnSoft', 'SOFT'], ['#btnRth', 'RTH'], ['#btnStop', 'STOP']].forEach(([id, m]) => {
      const on = s.mode === m && !s.test.active; $(id).classList.toggle('is-active', on); $(id).setAttribute('aria-pressed', on);
    });
    $('#btnEstop').innerHTML = est ? `<i data-icon="alert">${M.icon('alert')}</i> NOT-AUS freigeben` : `<i data-icon="alert">${M.icon('alert')}</i> NOT-AUS`;
    $('#btnEstop').classList.toggle('danger', true);

    // Karte
    if (!map) return;
    boat.setLatLng([s.pos.lat, s.pos.lon]);
    M.setBoatHeading(boat, s.heading);
    if ($('#trackChk').checked) trackLine.addLatLng([s.pos.lat, s.pos.lon]);
    targetLine.setLatLngs(t ? [[s.pos.lat, s.pos.lon], [t.lat, t.lon]] : []);
    fence.setRadius(P.geofence);
    if (follow && M.currentView === 'live') map.panTo([s.pos.lat, s.pos.lon], { animate: true, duration: 0.9, easeLinearity: 1 });
  }

  /* ---------- Einstellungen (wirken sofort) ---------- */
  const LC_KEYS = ['cruiseSpeed', 'maxThrottle', 'arriveRadius', 'loop'];
  let lightPending = null, pumpPending = null;
  function renderLcParams() {
    $('#lcParams').innerHTML = LC_KEYS.map(k => M.paramField(M.PARAM_DEFS.find(d => d.key === k), s.params[k])).join('');
    M.updateLimitNote($('#lcLimit'));
  }
  function updateLiveCtl() {
    $('#lcLight').querySelectorAll('.chip').forEach(b => {
      const id = Number(b.dataset.light);
      b.classList.toggle('active', id === s.light);
      b.classList.toggle('pending', id === lightPending);
    });
    if (lightPending === s.light) lightPending = null;
    $('#lcPumpState').textContent = `· ${s.pump.on ? 'läuft' : 'aus'} · ESC ${s.temps.esc.toFixed(0)} °C`;
    $('#lcPumpMode').querySelectorAll('.chip').forEach(b => {
      b.classList.toggle('active', b.dataset.pump === s.pump.mode);
      b.classList.toggle('pending', b.dataset.pump === pumpPending);
    });
    if (pumpPending === s.pump.mode) pumpPending = null;
    if (document.activeElement !== $('#lcPumpSpeed')) { $('#lcPumpSpeed').value = s.pump.speed; $('#lcPumpSpeedTxt').textContent = s.pump.speed + ' %'; }
    const tag = $('#lcSync');
    tag.textContent = s.paramSync === 'pending' ? 'Wird übertragen…' : 'Aktiv';
    tag.className = 'tag ' + (s.paramSync === 'pending' ? 'warn' : 'ok');
  }
  function buildLiveCtl() {
    $('#lcLight').innerHTML = M.LIGHT_MODES.map(m => `<button class="chip" data-light="${m.id}" title="${m.desc}">${m.name}</button>`).join('');
    renderLcParams(); updateLiveCtl();
    $('#lcLight').addEventListener('click', e => {
      const b = e.target.closest('[data-light]'); if (!b) return;
      const id = Number(b.dataset.light); if (id === s.light) return;
      lightPending = id; updateLiveCtl(); M.actions.setLight(id);
    });
    $('#lcPumpSpeed').addEventListener('input', e => { $('#lcPumpSpeedTxt').textContent = e.target.value + ' %'; });
    $('#lcPumpSpeed').addEventListener('change', e => M.actions.setPumpSpeed(Number(e.target.value)));
    $('#lcPumpMode').addEventListener('click', e => {
      const b = e.target.closest('[data-pump]'); if (!b || b.dataset.pump === s.pump.mode) return;
      pumpPending = b.dataset.pump; updateLiveCtl(); M.actions.setPumpMode(pumpPending);
    });
    $('#lcParams').addEventListener('change', e => {
      const inp = e.target.closest('[data-key]'); if (!inp) return;
      const d = M.PARAM_DEFS.find(x => x.key === inp.dataset.key);
      const p = M.clone(s.params); p[d.key] = M.readParam(d, inp);
      M.actions.sendParams(p);
    });
  }
  M.on('params', () => { if (!$('#lcParams').contains(document.activeElement)) renderLcParams(); updateLiveCtl(); });
  M.on('units', () => { renderLcParams(); update(); });
  M.on('tick', updateLiveCtl);

  /* ---------- Init ---------- */
  buildCompass(); buildHorizon(); buildLiveCtl();
  $('#followChk').addEventListener('change', e => { follow = e.target.checked; if (follow && map) map.panTo([s.pos.lat, s.pos.lon]); });
  $('#trackChk').addEventListener('change', e => {
    if (!map) return;
    trackLine.setLatLngs(e.target.checked ? s.track.map(p => [p.lat, p.lon]) : []);
  });
  $('#radiusChk').addEventListener('change', e => { if (map) e.target.checked ? radiusGroup.addTo(map) : radiusGroup.remove(); });
  $('#fenceChk').addEventListener('change', e => { if (map) e.target.checked ? fence.addTo(map) : fence.remove(); });
  $('#btnStart').addEventListener('click', () => M.actions.start());
  $('#btnManual').addEventListener('click', () => M.actions.manual());
  $('#btnSoft').addEventListener('click', () => M.actions.soft());

  /* Manuell Soft: Tempo-Regler (Anzeige in der gewaehlten Einheit, intern km/h) */
  const softKmh = () => { const v = Number($('#softRange').value); return M.units.speed === 'ms' ? v * 3.6 : v; };
  function renderSoft() {
    const on = s.mode === 'SOFT', row = $('#softRow'), r = $('#softRange');
    row.hidden = !on; if (!on) return;
    const max = M.speedLimit().kmh;
    r.max = +M.spd(max).toFixed(2); r.step = M.units.speed === 'ms' ? 0.1 : 0.5;
    if (document.activeElement !== r) r.value = +M.spd(s.soft.speed).toFixed(2);
    $('#softTxt').textContent = `${M.fmtSpd(s.soft.speed)} ${M.spdUnit()}`;
    $('#softHint').textContent = `Höchstens ${M.fmtSpd(max)} ${M.spdUnit()} (Reisegeschwindigkeit und Gas-Maximum). Das Ruder steuerst du mit der Funke.`;
  }
  $('#softRange').addEventListener('input', e => { $('#softTxt').textContent = `${M.fmt(Number(e.target.value), M.units.speed === 'ms' ? 1 : 1)} ${M.spdUnit()} …`; });
  $('#softRange').addEventListener('change', () => { M.actions.setSoftSpeed(softKmh()); $('#softRange').blur(); });
  const nudge = d => M.actions.setSoftSpeed(s.soft.speed + d * (M.units.speed === 'ms' ? 0.72 : 1));
  $('#softPlus').addEventListener('click', () => nudge(1));
  $('#softMinus').addEventListener('click', () => nudge(-1));
  $('#softZero').addEventListener('click', () => M.actions.setSoftSpeed(0));
  M.on('units', renderSoft);
  $('#btnStop').addEventListener('click', () => M.actions.stop());
  $('#btnRth').addEventListener('click', () => M.actions.rth());
  $('#btnArm').addEventListener('click', async () => {
    if (s.armed) return M.actions.disarm();
    const ok = await M.preflight(s.mode === 'TUNE' ? 'tune' : 'mission');
    if (ok) M.actions.arm();
  });
  $('#btnEstop').addEventListener('click', async () => {
    if (s.mode !== 'ESTOP') return M.actions.estop();                 // NOT-AUS wirkt sofort, ohne Rückfrage
    const ok = await M.confirm({
      title: 'NOT-AUS freigeben?',
      text: 'Das Boot bleibt danach nicht scharf und muss erneut scharf geschaltet werden.',
      type: 'FREIGEBEN', danger: true, confirmLabel: 'NOT-AUS freigeben'
    });
    if (ok) M.actions.release();
  });

  M.on('view', id => {
    if (id !== 'live') return;
    if (!map) initMap();
    setTimeout(() => { map.invalidateSize(); update(); }, 30);
  });
  M.on('mission', drawMission);
  M.on('home', () => {
    if (!map) return;
    homeMarker.setLatLng([s.home.lat, s.home.lon]);
    fence.setLatLng([s.home.lat, s.home.lon]);
    drawMission();
  });
  M.on('params', () => { if (fence) fence.setRadius(s.params.geofence); drawMission(); });
  M.on('tick', update);
  M.on('tick', () => { if (map && s.mode) drawActiveOnly(); });

  let lastActive = -1, lastMode = '';
  function drawActiveOnly() {            // Wegpunkt-Farben nur bei Aenderung neu zeichnen
    if (lastActive !== s.mission.active || lastMode !== s.mode) { lastActive = s.mission.active; lastMode = s.mode; drawMission(); }
  }
})();
