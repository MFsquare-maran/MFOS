/* ===================================================================
   app.js  –  Start: Simulation anwerfen, erste Ansicht anzeigen
   =================================================================== */
(function () {
  'use strict';
  const M = window.MFOS;
  M.startSim();
  M.emit('alarms');
  const start = (location.hash || '').replace('#', '') || 'live';
  M.showView(start);
})();
