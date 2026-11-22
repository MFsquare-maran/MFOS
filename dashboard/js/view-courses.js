/* ===================================================================
   view-courses.js  –  Kursbibliothek: Liste, Details mit Vorschau,
                       Import/Export, Umbenennen, "Auf Boot spielen"
   =================================================================== */
(function () {
  'use strict';
  const M = window.MFOS, s = M.state, $ = M.$;
  let selId = null, map, layer, armedDelete = null;

  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtDate = ms => ms ? new Date(ms).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'noch nie';
  const onBoat = c => s.mission.courseId === c.id;

  /* ---------- Liste ---------- */
  function renderList() {
    const all = M.courses.all();
    if (selId && !M.courses.get(selId)) selId = null;
    if (!selId && all.length) selId = all[0].id;
    $('#courseList').innerHTML = all.length ? all.map(c => {
      const st = M.courseStats(c.wps);
      return `<li><button class="course-item ${c.id === selId ? 'active' : ''}" data-id="${c.id}">
        <span class="ci-top"><b>${esc(c.name)}</b>${onBoat(c) ? '<span class="tag ok">Auf Boot</span>' : ''}</span>
        <small>${st.count} WP · ${M.fmtDist(st.length)} · ca. ${M.fmtDur(st.duration)} · geändert ${fmtDate(c.modified)}</small>
      </button></li>`;
    }).join('') : '<li class="muted small">Noch keine Kurse – importiere eine Datei oder speichere einen Kurs im Planer.</li>';
  }

  /* ---------- Details ---------- */
  function renderDetail() {
    if (map) { try { map.remove(); } catch (e) { /* ignore */ } map = null; }
    const box = $('#courseDetail');
    const c = selId && M.courses.get(selId);
    if (!c) { box.innerHTML = '<h3>Kurs</h3><p class="muted">Kurs aus der Liste wählen.</p>'; map = null; return; }
    const st = M.courseStats(c.wps);
    const kv = (k, v, cls = '') => `<div><span>${k}</span><b class="${cls}">${v}</b></div>`;
    box.innerHTML = `
      <h3>Kurs</h3>
      <input class="cname" id="cName" value="${esc(c.name)}" maxlength="60" aria-label="Kursname">
      <div class="mini-map" id="courseMap"></div>
      ${st.outOfFence ? `<p class="notice">Dieser Kurs verlässt den Geofence (${M.fmtDist(st.maxHome)} von Home, erlaubt ${M.fmtDist(s.params.geofence)}).</p>` : ''}
      <div class="kv">
        ${kv('Wegpunkte', st.count + (st.hasHome ? ' (mit Home)' : ''))}
        ${kv('Länge', M.fmtDist(st.length))}
        ${kv('Geschätzte Dauer', `${M.fmtDur(st.duration)} bei ${M.fmtSpd(M.speedLimit().kmh)} ${M.spdUnit()}`)}
        ${kv('Weiteste Entfernung von Home', M.fmtDist(st.maxHome), st.outOfFence ? 'warn-txt' : '')}
        ${kv('Start / Ende', `${st.startsAtHome ? 'Home' : 'Frei'} / ${st.endsAtHome ? 'Home' : 'Frei'}`)}
        ${kv('Erstellt', fmtDate(c.created))}
        ${kv('Geändert', fmtDate(c.modified))}
        ${kv('Zuletzt aufs Boot gespielt', fmtDate(c.lastSent))}
        ${kv('Aktuell auf dem Boot', onBoat(c) ? 'Ja' : 'Nein', onBoat(c) ? 'ok-txt' : '')}
      </div>
      <div class="btn-row">
        <button class="btn primary" data-act="send"><i data-icon="upload"></i> Auf Boot spielen</button>
        <button class="btn" data-act="edit">Im Planer bearbeiten</button>
      </div>
      <div class="btn-row">
        <button class="btn ghost" data-act="dup">Duplizieren</button>
        <button class="btn ghost" data-act="gpx">Export GPX</button>
        <button class="btn ghost" data-act="json">Export JSON</button>
        <button class="btn danger" data-act="del">${armedDelete === c.id ? 'Wirklich löschen?' : 'Löschen'}</button>
      </div>`;
    M.hydrateIcons(box);
    drawPreview(c);
  }

  function drawPreview(c) {
    map = L.map('courseMap', { zoomControl: false, attributionControl: false, dragging: true, scrollWheelZoom: false });
    L.tileLayer(M.theme() === 'dark'
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
      : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      { maxNativeZoom: 16, maxZoom: 19 }).addTo(map);
    const r = M.resolveWps(c.wps);
    const pts = r.map(p => [p.lat, p.lon]);
    L.polyline(pts, { color: '#ffb74d', weight: 3, dashArray: '8 6' }).addTo(map);
    c.wps.forEach((w, i) => L.marker(pts[i], { icon: w.home ? M.mapIcons.home() : M.mapIcons.wp(i + 1), interactive: false }).addTo(map));
    L.marker([s.home.lat, s.home.lon], { icon: M.mapIcons.home(), interactive: false, opacity: .6 }).addTo(map);
    map.fitBounds(pts.concat([[s.home.lat, s.home.lon]]), { padding: [24, 24], maxZoom: 17 });
  }

  const refresh = () => { renderList(); renderDetail(); };

  /* ---------- Aktionen ---------- */
  $('#courseList').addEventListener('click', e => {
    const b = e.target.closest('.course-item'); if (!b) return;
    selId = b.dataset.id; armedDelete = null; renderList(); renderDetail();
  });

  $('#courseDetail').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const c = M.courses.get(selId); if (!c) return;
    const act = b.dataset.act;
    if (act === 'send') M.actions.sendMission(c.wps, { id: c.id, name: c.name });
    else if (act === 'edit') { M.planner.load(c); M.showView('mission'); }
    else if (act === 'dup') { const n = M.courses.duplicate(c.id); selId = n.id; refresh(); M.toast(`«${n.name}» angelegt`, 'ok'); }
    else if (act === 'gpx' || act === 'json') M.exportCourse(c, act);
    else if (act === 'del') {
      if (armedDelete !== c.id) { armedDelete = c.id; renderDetail(); setTimeout(() => { if (armedDelete === c.id) { armedDelete = null; renderDetail(); } }, 3000); return; }
      armedDelete = null; M.courses.remove(c.id); M.toast(`«${c.name}» gelöscht`, 'info');
    }
  });

  $('#courseDetail').addEventListener('change', e => {
    if (e.target.id !== 'cName') return;
    const name = e.target.value.trim();
    if (!name) { e.target.value = M.courses.get(selId).name; return M.toast('Name darf nicht leer sein', 'warn'); }
    M.courses.update(selId, { name });
    if (onBoat(M.courses.get(selId))) s.mission.name = name;
  });

  /* ---------- Import ---------- */
  function importFiles(files) {
    [...files].forEach(f => {
      if (f.size > 2 * 1024 * 1024) return M.toast(`${f.name}: Datei zu gross (max. 2 MB)`, 'crit');
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const r = M.parseCourseFile(f.name, String(rd.result));
          const c = M.courses.add(r.name, r.wps);
          selId = c.id; refresh();                 // add() hat vorher schon neu gezeichnet, noch mit alter Auswahl
          M.toast(`«${c.name}» importiert · ${r.wps.length} WP${r.thinned ? ` (von ${r.total} ausgedünnt)` : ''}`, 'ok');
        } catch (err) { M.toast(`${f.name}: ${err.message}`, 'crit'); }
      };
      rd.onerror = () => M.toast(`${f.name}: nicht lesbar`, 'crit');
      rd.readAsText(f);
    });
  }
  $('#cImport').addEventListener('change', e => { importFiles(e.target.files); e.target.value = ''; });
  const dz = $('#cDrop');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => importFiles(e.dataTransfer.files));

  $('#cNew').addEventListener('click', () => { M.planner.load(null); M.showView('mission'); });

  /* ---------- Events ---------- */
  M.on('courses', () => { if (M.currentView === 'courses') refresh(); });
  M.on('mission', () => { if (M.currentView === 'courses') refresh(); });
  M.on('home', () => { if (M.currentView === 'courses') refresh(); });
  M.on('theme', () => { if (M.currentView === 'courses') renderDetail(); });
  M.on('view', id => { if (id === 'courses') refresh(); });
})();
