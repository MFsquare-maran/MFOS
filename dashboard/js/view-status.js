/* ===================================================================
   view-status.js  –  Verbindung, Sensor-Status, Ereignis-Log,
                      Demo-Auslöser (nur Mockup)
   =================================================================== */
(function () {
  'use strict';
  const M = window.MFOS, s = M.state, $ = M.$;

  const SENSORS = [
    ['PCA9685', 'Licht-/Pumpentreiber · Bus2 0x40', () => 'OK'],
    ['INA226', 'Strom/Spannung · Bus2 0x45', () => `${M.fmt(s.power.v, 2)} V · ${M.fmt(s.power.a, 1)} A`],
    ['BMP280', 'Druck/Temperatur · Bus2 0x76', () => `${M.fmt(s.pressure, 1)} hPa · ${M.fmt(s.temps.hull, 1)} °C`],
    ['ADS1115', 'NTC (ESC) + Leck-Sensor · Bus2 0x48', () => `ESC ${M.fmt(s.temps.esc, 1)} °C · Leck ${s.leak ? 'JA' : 'nein'}`],
    ['LSM9DS1', 'IMU · Bus1', () => `Roll ${M.fmt(s.roll, 1)}° · Pitch ${M.fmt(s.pitch, 1)}°`],
    ['GPS u-blox M8N', 'UART2', () => s.gps.fix ? `Fix · ${s.gps.sats} Sat. · HDOP ${M.fmt(s.gps.hdop, 1)}` : 'Kein Fix', () => s.gps.fix],
    ['LTE A7670E', 'UART1', () => `${s.lte.dbm.toFixed(0)} dBm`, () => s.online || s.net.active === 'wifi'],
    ['WLAN ESP32', 'intern', () => s.net.wifi.saved ? `${s.net.wifi.ssid} · ${s.net.wifi.rssi.toFixed(0)} dBm` : 'nicht eingerichtet']
  ];

  function render() {
    const ago = Math.round((s.now - s.lastSeen) / 1000);
    const up = Math.round((Date.now() - s.bootAt) / 1000) + 240;
    const row = (k, v, cls = '') => `<div><span>${k}</span><b class="${cls}">${v}</b></div>`;
    $('#stConn').innerHTML =
      row('Status', s.online ? 'Online' : 'OFFLINE', s.online ? 'ok-txt' : 'crit-txt') +
      row('Letzter Kontakt', s.online ? 'jetzt' : `vor ${ago} s`) +
      row('Aktive Verbindung', s.net.active === 'wifi' ? `WLAN «${s.net.wifi.ssid}»` : s.net.active === 'lte' ? 'LTE' : 'keine', s.net.active === 'none' ? 'crit-txt' : '') +
      row('Verbindungsart', { auto: 'Auto (WLAN bevorzugt)', lte: 'Nur LTE', wifi: 'Nur WLAN' }[s.net.mode]) +
      row('WLAN', s.net.wifi.saved ? `${s.net.wifi.ssid} · ${s.net.wifi.ip} · ${s.net.wifi.rssi.toFixed(0)} dBm` : 'nicht eingerichtet') +
      row('LTE', `${s.lte.operator} · ${s.lte.tech} · ${s.lte.dbm.toFixed(0)} dBm (${M.lteBars(s.lte.dbm)}/4)`) +
      row('LTE-Daten', `${s.data.sinceReset.toFixed(0)} von ${s.params.dataLimit} MB (Schätzung)`) +
      row('Latenz', s.online ? `${s.latency} ms` : '–') +
      row('Betriebszeit', M.fmtDur(up)) +
      row('Firmware', 'MFOS FW 1.0.0') +
      row('Modus', M.MODES[s.mode]);

    $('#stSensors').innerHTML = '<tr><th>Gerät</th><th>Wert</th><th></th></tr>' + SENSORS.map(x => {
      const ok = x[3] ? x[3]() : true;
      return `<tr><td><b>${x[0]}</b><br><small class="muted">${x[1]}</small></td><td>${x[2]()}</td>
        <td><span class="lv ${ok ? 'ok' : 'warn'}">${ok ? 'OK' : 'Problem'}</span></td></tr>`;
    }).join('');

    $('#stLog').innerHTML = '<tr><th>Zeit</th><th>Stufe</th><th>Ereignis</th></tr>' +
      (s.eventLog.length ? s.eventLog.slice(0, 40).map(e =>
        `<tr><td class="mono">${M.fmtTime(e.t)}</td><td><span class="lv ${e.level}">${{ info: 'Info', ok: 'OK', warn: 'Warnung', crit: 'Alarm' }[e.level] || e.level}</span></td><td>${e.text}</td></tr>`).join('')
        : '<tr><td colspan="3" class="muted">Noch keine Ereignisse</td></tr>');
  }

  const SIMS = [
    ['leak', 'Wassereinbruch (Leck-Sensor)'], ['escHot', 'ESC überhitzt'], ['lowBatt', 'Akku fast leer'],
    ['gpsLoss', 'GPS-Fix verloren'], ['lteWeak', 'LTE-Signal schwach'], ['wifiAway', 'WLAN ausser Reichweite'], ['offline', 'Verbindung unterbrochen']
  ];
  $('#simToggles').insertAdjacentHTML('afterend', '<div class="btn-row"><button class="btn" id="simReboot">Boot neu starten (nicht scharf)</button></div>');
  $('#simReboot').addEventListener('click', () => { M.simReboot(); M.toast('Demo: Boot neu gestartet', 'info'); });
  $('#simToggles').innerHTML = SIMS.map(([k, t]) => `
    <div class="field"><label>${t}</label><label class="switch"><input type="checkbox" data-sim="${k}"><span></span></label></div>`).join('');
  $('#simToggles').addEventListener('change', e => {
    const k = e.target.dataset.sim; if (!k) return;
    s.sim[k] = e.target.checked;
    M.toast(`Demo: ${SIMS.find(x => x[0] === k)[1]} ${e.target.checked ? 'an' : 'aus'}`, 'info');
  });

  M.on('tick', () => { if (M.currentView === 'status') render(); });
  M.on('log', () => { if (M.currentView === 'status') render(); });
  M.on('view', id => { if (id === 'status') render(); });
})();
