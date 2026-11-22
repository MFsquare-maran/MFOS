/* ===================================================================
   map.js  –  Leaflet-Hilfen: Karten mit Dunkel/Hell/Satellit,
              Boots-, Wegpunkt- und Home-Marker
   =================================================================== */
(function () {
  'use strict';
  const M = window.MFOS;

  // Esri-Kacheln (ohne API-Key). OSM-Tiles sind für Apps ohne eigene
  // Tile-Policy-Konformität gesperrt (403) und werden bewusst nicht genutzt.
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  const ATTR = 'Tiles &copy; Esri';
  const mk = () => ({
    dark: L.tileLayer(ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { attribution: ATTR, maxNativeZoom: 16, maxZoom: 19 }),
    light: L.tileLayer(ESRI + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}', { attribution: ATTR, maxNativeZoom: 19, maxZoom: 19 }),
    sat: L.tileLayer(ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: ATTR, maxNativeZoom: 19, maxZoom: 19 })
  });

  const entries = [];
  // Das Boot ist schwarz/weiss und passt sich der Karte an (Farben in style.css: .map-dark / .map-light / .map-sat)
  const setKind = (map, kind) => {
    const el = map.getContainer();
    el.classList.remove('map-dark', 'map-light', 'map-sat');
    el.classList.add('map-' + kind);
  };
  M.maps = {
    create(id, opts = {}) {
      const c = opts.center || M.state.home;
      const map = L.map(id, { zoomControl: true, attributionControl: true }).setView([c.lat, c.lon], opts.zoom || 16);
      const layers = mk();
      layers[M.theme()].addTo(map);
      setKind(map, M.theme());
      map.on('baselayerchange', e => {
        const kind = e.layer === layers.sat ? 'sat' : e.layer === layers.dark ? 'dark' : 'light';
        setKind(map, kind);
      });
      L.control.layers({ 'Dunkel': layers.dark, 'Hell': layers.light, 'Satellit': layers.sat }, null, { collapsed: true, position: 'topright' }).addTo(map);
      entries.push({ map, layers });
      return map;
    }
  };
  M.on('theme', t => entries.forEach(({ map, layers }) => {
    if (map.hasLayer(layers.sat)) return;
    map.removeLayer(layers.dark); map.removeLayer(layers.light);
    layers[t].addTo(map);
  }));

  /* ---------- Marker ---------- */
  M.mapIcons = {
    boat() {
      // Boot von oben: Bug zeigt nach oben (wird per CSS auf den Kurs gedreht)
      return L.divIcon({
        className: 'boat-icon', iconSize: [26, 64], iconAnchor: [13, 32],
        html: `<svg viewBox="0 0 24 60" aria-label="Boot">
          <g stroke-linejoin="round" stroke-linecap="round">
            <rect class="hull" x="9.3" y="55" width="5.4" height="4" rx="1.2"/>
            <path class="hull" d="M12 1.5C15.8 11 20.3 22 20.8 34C21 42 20.8 50 19.8 56H4.2C3.2 50 3 42 3.2 34C3.7 22 8.2 11 12 1.5Z"/>
            <path class="det" d="M6.8 31Q12 26 17.2 31M7.2 40Q12 35.2 16.8 40" fill="none" stroke-width="1.1"/>
          </g></svg>`
      });
    },
    wp(n, state = '') {
      return L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="wp-pin ${state}">${n}</div>` });
    },
    home() {
      return L.divIcon({ className: '', iconSize: [0, 0], html: '<div class="wp-pin home">H</div>' });
    }
  };
  M.setBoatHeading = (marker, deg) => {
    const el = marker.getElement && marker.getElement();
    const svg = el && el.querySelector('svg');
    if (svg) svg.style.transform = `rotate(${deg}deg)`;
  };

  /* Karten neu zeichnen, wenn die Ansicht sichtbar wird */
  M.invalidateOnShow = (viewId, getMap) => M.on('view', id => {
    if (id !== viewId) return;
    const m = getMap(); if (m) setTimeout(() => m.invalidateSize(), 30);
  });
})();
