# MFOS Dashboard

Weboberfläche zum Planen, Überwachen und Steuern des Modellboots. Reines HTML, CSS und JavaScript, **ohne Build-Schritt und ohne Framework**.

**Stand: Mockup.** Alle Werte kommen aus einer Simulation (`js/state.js`). Die Anbindung ans echte Boot gibt es noch nicht. Was das Boot dafür können muss, steht im Abschnitt «Schnittstelle» unten und vollständig in [`../docs/schnittstelle.md`](../docs/schnittstelle.md).

## Starten

Internet nötig (Karte und Diagramme laden von einem CDN). Aus dem Projektordner:

```bash
python -m http.server 8765 --directory dashboard
```

Dann `http://localhost:8765` öffnen. Das Öffnen per Doppelklick geht oft auch, manche Browser sperren dann aber Dateien. In Claude Code startet `.claude/launch.json` denselben Server (`preview_start` mit dem Namen `dashboard`).

Nach Änderungen an JavaScript oder CSS hilft ein hartes Neuladen (Strg + Umschalt + R), sonst zeigt der Browser alte Dateien.

## Ansichten

| Ansicht | Inhalt |
|---|---|
| **Live** | Karte mit Boot, Spur, Wegpunkten, Home, Geofence und Ankunftsradius. Kompass und Lage, Antriebssysteme (Soll Gas und Ruder), Telemetrie-Liste, Einstellungen (Licht, Kühlpumpe, Reisegeschwindigkeit, Maximales Gas, Ankunftsradius). Knöpfe: Scharf schalten, Mission starten, Manuell (Funke), Manuell Soft (Tempo vom Dashboard, Ruder von der Funke), Stopp, Return Home, NOT-AUS |
| **Mission** | Wegpunkte per Klick setzen, verschieben, sortieren. Home-Position einstellen und als Wegpunkt «H» einbauen. Als Kurs speichern, an das Boot senden |
| **Kurse** | Kursbibliothek mit Namen. Import (GPX, GeoJSON, JSON, CSV), Export (GPX, JSON), Kennzahlen (Länge, Dauer, weiteste Entfernung von Home), «Auf Boot spielen» |
| **Telemetrie** | Kacheln und neun einzelne Zeitreihen. Zeitfenster 1 min bis 5 h oder eigener Wert, Zoom |
| **Einstellungen** | **Verbindung** (Auto, Nur LTE, Nur WLAN, WLAN-Zugang) und alle Parameter, Zähler zurücksetzen (Akku, LTE-Daten) |
| **Tuning** | Regler (Tempo, Kurs, Gierrate, Bahn) und weitere Tuning-Werte bearbeiten, mit Quittung senden, Tuning-Modus mit eigenem Scharfschalten (nur auf dieser Seite), Sprungtest mit Diagramm und Kennzahlen, letzter guter Satz, Profile, Export/Import. Mockup: die Verläufe rechnet ein Platzhalter-Boot (`tune-sim.js`) |
| **Tests** | Aktoren einzeln prüfen: Motor, Ruder-Servo, Kühlpumpe, vier Lichtkanäle |
| **Replay** | Aufgezeichnete Fahrten abspielen, Kennzahlen, Download als CSV, GPX oder JSON |
| **Status** | Verbindung, Sensoren, Ereignis-Log, Demo-Auslöser für Alarme |

**Leiste oben (auf jeder Ansicht):** Online-Status, scharf oder nicht, Modus, aktive Verbindung (LTE oder WLAN) mit Signal, LTE-Datenverbrauch, GPS, Akku mit Batterie-Symbol (grün, orange, rot), Strom und Leistung, Verbrauch, Restlaufzeit, Temperaturen Innenraum und ESC, Pumpe, Licht, Leck, Aufnahme (REC), Einheit km/h oder m/s, Hell/Dunkel. Alarme erscheinen als Leiste darunter (nur Anzeige, keine E-Mail).

## Sicherheit

- **Scharf schalten:** Nach dem Einschalten ist das Boot nicht scharf. Mission starten, Manuell (Funke) und Return Home sind gesperrt, bis man scharf schaltet (Bestätigung mit Haken). Entschärfen geht sofort.
- **NOT-AUS** wirkt sofort ohne Rückfrage und entschärft. **Freigeben** verlangt das eingetippte Wort FREIGEBEN, danach bleibt das Boot entschärft.
- **Testmodus:** nur bei entschärftem, gestopptem Boot, mit Bestätigung. Der Motor läuft nur, solange der Knopf gedrückt bleibt (bis 100 %, höchstens 10 s). Die Pumpe läuft höchstens 30 s. Alles geht aus beim Verlassen des Reiters, nach 5 min ohne Bedienung, beim Scharf schalten, bei NOT-AUS und Verbindungsverlust.
- **Wirksames Tempo:** Es gilt die stärkere Begrenzung von «Reisegeschwindigkeit» und «Maximales Gas».

Das Dashboard zeigt diese Schranken nur an. **Durchsetzen muss sie die Firmware** (siehe unten).

## Schnittstelle: was die Firmware senden und empfangen können muss

Vollständig mit allen Schlüsseln, Einheiten und Fehlercodes: [`../docs/schnittstelle.md`](../docs/schnittstelle.md). Hier die Kurzfassung. Transport ist **MQTT mit JSON**, das Backend ist noch offen.

**Die Firmware sendet (Boot → Server)**

| Was | Inhalt | Takt |
|---|---|---|
| Telemetrie | Position, Geschwindigkeit, Kurs, Lage (Roll, Pitch, Heading), Akku (V, A, W, mAh, Wh), Temperaturen (Innenraum, ESC), Druck, Leck, Soll Gas und Ruder, Modus, scharf, Testmodus, aktiver Wegpunkt, Kurs-Name, Pumpe (Modus, Drehzahl, läuft), Licht, GPS (Satelliten, Fix), Verbindung (LTE/WLAN, Signal), Datenzähler, Firmware-Version | Parameter «Sendeintervall», Standard 1 s, kleinster Wert 100 ms; Zustände auch sofort bei Änderung |
| Ereignisse | Boot, scharf/entschärft, NOT-AUS, Mission gestartet und fertig, Home erreicht, Failsafe, Geofence, Testmodus, Verbindungswechsel, WLAN-Ergebnis, Zähler zurückgesetzt | bei Eintritt |
| Quittungen | `ok` oder Fehlercode zu jedem Befehl | innerhalb 2 s |
| Online-Status | online, bei Ausfall «offline» (Last Will) | – |

**Die Firmware empfängt und führt aus (Server → Boot)**

| Gruppe | Befehle |
|---|---|
| Fahren | `arm`, `disarm`, `start`, `stop`, `rth`, `estop`, `release` |
| Konfiguration | `setMission` (Kurs mit Wegpunkten, auch `{"home": true}`), `setHome`, `setParams` (Reisegeschwindigkeit, Maximales Gas, Ankunftsradius, Schleife, Geofence, Failsafe, Timeout, Pumpen-Schwellen, Sendeintervall u. a.) |
| Aktoren | `setLight` (0–5), `setPumpMode` (`auto`/`on`/`off`), `setPumpSpeed` (10–100 %) |
| Zähler | `resetConsumption`, `resetLteData` |
| Verbindung | `setNetMode` (`auto`/`lte`/`wifi`), `setWifi` (SSID, Passwort), `forgetWifi` |
| Test | `testStart`, `testEnd`, `testSet` (Motor mit Totmann, Servo, Pumpe, Pumpen-Drehzahl, Licht-Kanäle) |
| Regler | `setTune`, `tuneDefaults`, `tuneRestore`, `tuneMarkGood`, `tuneMode`, `tuneStep`/`tuneStop` (siehe `docs/schnittstelle.md` 6a) |

**Was die Firmware dabei garantieren muss** (Auszug, Details in Abschnitt 9 der Schnittstelle):

1. Nach jedem Start und nach jedem NOT-AUS **nicht scharf**.
2. `start` und `rth` nur wenn scharf, sonst ablehnen.
3. Befehle haben eine Lebensdauer (`ttl_ms`), abgelaufene werden verworfen, nach einem Verbindungsabbruch wird nichts nachgeholt.
4. Verbindungsverlust länger als das Timeout löst die eingestellte Aktion aus, im Testmodus geht sofort alles aus.
5. Motortest nur mit Totmann (Wiederholung alle 200 ms, 500 ms Ausfall = Stopp, höchstens 10 s).
6. Reisegeschwindigkeit und Maximales Gas durchsetzen, die stärkere Grenze gilt.
7. WLAN-Passwort nie zurücksenden oder protokollieren.

**Was das Dashboard selbst rechnet und die Firmware nicht liefern muss:** Akku-Prozent, Restlaufzeit, Distanzen und Ankunftszeit, alle Alarme, Strecke und Kennzahlen der Fahrten.

## Vom Mockup zum echten Boot

`js/state.js` ist die einzige Stelle, die Werte erzeugt. Alle Ansichten lesen nur `MFOS.state` und senden Befehle über `MFOS.actions`. Für den echten Betrieb ersetzt man dort:

1. `step()` (Simulation, 1 Mal pro Sekunde) durch das Einlesen der Telemetrie.
2. `MFOS.actions` (heute simulierte Quittung nach kurzer Zeit) durch echte Befehle mit Quittung.
3. Die Aufzeichnung in `js/recorder.js` und den Kurs-Speicher in `js/courses.js` (heute im Browser, `localStorage`) durch Server-Speicher. Aufgezeichnet werden muss auf dem **Server**, sonst fehlen Daten bei geschlossenem Dashboard.

| Feld in `MFOS.state` | Telemetrie-Schlüssel |
|---|---|
| `pos.lat`, `pos.lon`, `speed`, `heading` | `lat`, `lon`, `speed`, `heading` |
| `roll`, `pitch` | `roll`, `pitch` |
| `power.v`, `.a`, `.w`, `.mah`, `.wh` | `bat_v`, `bat_a`, `bat_w`, `bat_mah`, `bat_wh` |
| `temps.hull`, `temps.esc`, `pressure` | `temp_hull`, `temp_esc`, `pressure` |
| `cmd.throttle`, `cmd.rudder` | `cmd_throttle`, `cmd_rudder` |
| `mode`, `armed`, `test.active` | `mode`, `armed`, `test` |
| `pump.on`, `.mode`, `.speed`, `light` | `pump_on`, `pump_mode`, `pump_speed`, `light_mode` |
| `gps.sats`, `gps.fix` | `sats`, `fix` |
| `net.active`, `lte.dbm`, `net.wifi.*` | `link`, `lte_dbm`, `wifi_*` |
| `data.today`, `.sinceReset`, `.total` | `data_lte_mb_today`, `_reset`, `_total` |

## Aufbau

```
dashboard/
├── index.html           Gerüst aller Ansichten
├── css/style.css        Design (dunkel und hell, auch für das Handy)
├── img/logo.svg         Logo, auch als Favicon
└── js/
    ├── state.js         Simulation, Geo-Helfer, Alarme, Befehle, Parameter-Definitionen
    ├── ui.js            Icons, Navigation, Leiste oben, Alarm-Leiste, Bestätigungsdialog, Einheiten
    ├── map.js           Leaflet-Karten (Dunkel, Hell, Satellit) und Marker
    ├── courses.js       Kursbibliothek: Speicher, Kennzahlen, Import und Export
    ├── recorder.js      Fahrten aufzeichnen, Kennzahlen, Export (CSV, GPX, JSON)
    ├── view-live.js     Ansicht Live
    ├── view-mission.js  Ansicht Mission (Planer, Home)
    ├── view-courses.js  Ansicht Kurse
    ├── view-energy.js   Ansicht Telemetrie (Graphen)
    ├── view-control.js  Ansicht Einstellungen (Verbindung, Parameter, Zähler)
    ├── tune-defs.js     Tuning: Werteliste, Grenzen, Standardwerte (vor state.js geladen)
    ├── tune-sim.js      Tuning: Platzhalter-Boot für die Sprungtests (entfällt mit echtem Boot)
    ├── view-tuning.js   Ansicht Tuning
    ├── view-tests.js    Ansicht Tests
    ├── view-replay.js   Ansicht Replay
    ├── view-status.js   Ansicht Status
    └── app.js           Start
```

Bibliotheken kommen von einem CDN: Leaflet 1.9.4, Chart.js 4.4.1 mit Zoom-Plugin 2.0.1 und Hammer.js 2.0.8.

## Hinweise zum Mockup

- Karte und Position (Greifensee) und die Beispiel-Wegpunkte sind Platzhalter.
- Kartenkacheln von Esri (Dunkel, Hell, Satellit). OpenStreetMap geht nicht: Der Server sperrt Apps, die seine Tile-Regeln nicht erfüllen (Fehler 403).
- Im Browser gespeichert (`localStorage`): Kurse, aufgezeichnete Fahrten (letzte 15), Hell/Dunkel, Einheit km/h oder m/s.
- Die Fahrten «Demo» im Replay und die Startwerte des LTE-Zählers sind erfunden.
- Der Verlauf der Graphen liegt im Arbeitsspeicher (höchstens 5 Stunden) und ist nach einem Neuladen weg.
- Demo-Regeln: Ein WLAN-Passwort mit «falsch» oder «wrong» schlägt fehl. Unter Status lassen sich Alarme, WLAN ausser Reichweite und ein Neustart des Boots auslösen.
- Das Sendeintervall ändert die Simulation nicht (sie läuft immer im 1-Sekunden-Takt).

Arbeitsregeln für Änderungen am Dashboard stehen in [`../CLAUDE.md`](../CLAUDE.md).
