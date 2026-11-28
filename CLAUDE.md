# CLAUDE.md – MFOS

Modellboot mit ESP32-Firmware (`firmware/`) und Web-Dashboard (`dashboard/`). Das Boot soll autonom Koordinaten abfahren, die man über das Netz schickt. Der Besitzer spricht Deutsch, **alle Texte in der Oberfläche, in Kommentaren und in Dokumenten sind deutsch** (Schweizer Schreibweise ohne «ß», also «gross», «Strasse»).

## Karte des Projekts

```
firmware/                 PlatformIO, ESP32 (Arduino). pins.h = zentrale Pin-Belegung
  lib/<Gerät>/            Treiber, eine Klasse pro Ordner
  src/MAIN/main.cpp       Hauptfirmware      src/TEST/main.cpp  Hardware-Selbsttest
dashboard/                HTML/CSS/JS ohne Build, Mockup mit Simulation (js/state.js)
deploy/                   Server als Docker-Compose-Stack für Portainer (siehe unten)
  docker-compose.yml      mosquitto (MQTT, Klartext), web (Caddy, Passwortschutz, Dashboard), hinter einem Reverse Proxy
  .env.example            Vorlage der Einstellungen; echte Werte nur in Portainer oder in .env (nie in Git)
docs/schnittstelle.md     VERTRAG Boot ↔ Dashboard (einzige Quelle der Wahrheit)
.claude/launch.json       startet das Dashboard in der Vorschau (Name: dashboard, Port 8765)
```

Stand: Treiber vorhanden, Dashboard als Mockup fertig, **Firmware kann die Schnittstelle noch nicht** (kein LTE, WLAN, MQTT, scharf/NOT-AUS, Navigation). Siehe `firmware/README.md`. Der Server-Stack in `deploy/` ist in Portainer deployt (Fehler anhand der Logs behoben, der Start nach dem letzten Fix ist noch zu bestätigen), ein Backend dahinter gibt es noch nicht. **Aktueller Stand, Entscheidungen, offene Punkte und die Reihenfolge fürs Weitermachen: `docs/stand-und-naechste-schritte.md`. Zuerst lesen, wenn eine Sitzung beginnt.**

## Befehle

```bash
# Dashboard: Server starten, dann http://localhost:8765
python -m http.server 8765 --directory dashboard      # in Claude Code: preview_start mit "dashboard"

# Firmware (PlatformIO, auf dem Entwicklungsrechner nicht installiert, Build nie geprüft)
pio run -d firmware -e MFOS_Main
pio run -d firmware -e MFOS_test
```

Es gibt **keine automatischen Tests**. Dashboard-Änderungen im Browser prüfen (Konsole auf Fehler, betroffene Ansicht durchklicken). Nach Änderungen an JS oder CSS den Browser-Cache umgehen (hartes Neuladen oder `?v=N` an die URL, Dateien mit `fetch(url, {cache: 'reload'})` neu holen), sonst testet man alten Code. Das Browser-Fenster der Vorschau zeigt `file://` nur als Schnappschuss, darum immer über den Server.

## Server (`deploy/`): Konventionen

- **Entschieden:** MQTT auf eigenem **Mosquitto**, kein ThingsBoard. Der Stack läuft **hinter einem Reverse Proxy** unter `mfos.mfsquare.ch`, **TLS macht der Proxy**. Der Stack enthält darum keine Zertifikate, kein Let's Encrypt, keine eigene CA. Das Dashboard ist von aussen erreichbar, darum zählt Sicherheit mehr als Bequemlichkeit.
- **Klartext-MQTT (Port 1883) nie ins Internet.** Der Reverse Proxy läuft auf einem **anderen Server**, der Port ist darum nur an der **LAN-Adresse** dieses Servers erreichbar (`MQTT_BIND`, Pflichtvariable), nie auf `0.0.0.0`, in der Firewall nur für den Proxy offen, nie am Router weitergeleitet. Das Boot muss über TLS des Proxys kommen (Weg A: Stream mit TLS auf 8883, Weg B: `wss://…/mqtt`, siehe `deploy/README.md`).
- **Nie Geheimnisse ins Repository:** keine Passwörter, Schlüssel, `.env`, Zertifikate (`.gitignore` und `.dockerignore` schützen, nicht darauf verlassen). In Dateien nur Platzhalter wie `CHANGE_ME_…`. Passwörter erzeugen `deploy/tools/gen-secrets.*`.
- **Dauerhafte Daten nur im Datenordner `DATA_DIR`** (Standard `/serverdata/server/mfos-dashboard`, je Dienst ein Unterordner, als Bind-Mount), **keine benannten Docker-Volumes**. Die Unterordner legt der Betreiber **einmal von Hand** an (`chown` auf den Benutzer des Dienstes, Befehl in `deploy/README.md`), es gibt keinen Init-Container. Neuer Dienst mit Daten: Befehl in der Anleitung ergänzen und im Startskript des Dienstes prüfen, dass der Ordner beschreibbar ist (Beispiel `deploy/mosquitto/entrypoint.sh`).
- Alles Einstellbare kommt aus Umgebungsvariablen (`deploy/.env.example` führt jede auf). Neue Variable: in `.env.example`, `docker-compose.yml` (mit `:?` bei Pflicht) und `deploy/README.md` nachziehen.
- Die Startskripte (`entrypoint.sh`) **verweigern den Start** bei fehlenden, kurzen (< 20 Zeichen) oder Platzhalter-Passwörtern. Das nicht aufweichen.
- Haltung der Container: kein Root wo möglich, `cap_drop: ALL`, `no-new-privileges`, schreibgeschütztes Dateisystem, Speicher- und Prozessgrenzen, kein `docker.sock`, Ports nur an der LAN-Adresse veröffentlichen (`WEB_BIND`, `MQTT_BIND`), nie ins Internet. Neue Dienste bekommen dieselbe Haltung (`x-hardening` in der Compose-Datei).
- Shell-Skripte und Container-Dateien **mit LF-Zeilenenden** (`.gitattributes` erzwingt es), POSIX-`sh` (Alpine/BusyBox), kein Bash-Spezifisches.
- Mosquitto-Konfiguration: Kommentare nur in eigenen Zeilen (keine am Zeilenende). Listener-Optionen wie `max_connections` **hinter** den jeweiligen `listener` schreiben, sonst legt Mosquitto einen zusätzlichen Standard-Listener auf Port 1883 an («Address in use»). `per_listener_settings` nicht verwenden (veraltet).
- Auf dem Entwicklungsrechner läuft **kein Docker**, Änderungen am Stack sind dort nicht startbar. Skripte mit `bash -n` prüfen, `docker-compose.yml` mit einem YAML-Parser, erzeugte Konfiguration mit einem Attrappen-Test, und **ehrlich sagen, dass der echte Start erst in Portainer geprüft wird**. Die Rückmeldung kommt dann über die Container-Logs des Besitzers.
- Das Dashboard läuft unter strenger CSP (siehe `deploy/web/Caddyfile`): keine Inline-Skripte, keine neuen Fremd-Domains ohne Eintrag dort.

## Dashboard: Konventionen

- **Kein Framework, kein Bundler.** Skripte als IIFE, gemeinsamer Namensraum `window.MFOS` (`M`). Ladereihenfolge steht am Ende von `index.html`: `tune-defs.js`, `state.js`, `ui.js`, `courses.js`, `recorder.js`, `map.js`, `tune-sim.js`, `view-*.js`, `app.js`. Abhängigkeiten nur nach unten, nie auf später geladene Dateien beim Laden (erst zur Laufzeit).
- **Eine Datenquelle:** `js/state.js` (`MFOS.state`, `MFOS.actions`, `MFOS.on('tick'|…)`). Ansichten lesen den Zustand und senden Befehle über `MFOS.actions`, sie erfinden keine Werte. Für den echten Betrieb wird nur `state.js` ersetzt.
- **Parameter** definiert allein `MFOS.PARAM_DEFS` (Schlüssel, Einheit, Bereich, Standard). Neues Feld dort ergänzen, die Ansicht Einstellungen zeichnet es selbst. Eingaben immer über `M.readParam` lesen, Felder über `M.paramField` zeichnen (km/h ↔ m/s).
- **Einheiten intern:** Geschwindigkeit km/h. Anzeige über `M.spd`, `M.fmtSpd`, `M.spdUnit`. Nie km/h fest in Text schreiben.
- **Sicherheitsabfragen** über `M.confirm({title, text, check, type, danger})`, nicht `window.confirm`.
- **Aktionen mit Quittung:** Befehle gehen durch `send()` in `state.js` (Verzögerung, Toast, Log). Schnelle Regler (Test) nutzen `testSet` ohne Quittung.
- Zeichnen bei jedem `tick` (1 Hz) nur, was sich ändert. Eingabefelder mit Fokus nicht überschreiben, Knöpfe nicht neu erzeugen, solange der Nutzer sie drückt.
- Karten: Esri-Kacheln (OpenStreetMap-Kacheln sind für diese App gesperrt, 403). Das Boot-Symbol passt sich der Karte an (`.map-dark`, `.map-light`, `.map-sat`).
- Hell und Dunkel über CSS-Variablen in `css/style.css`. Neue Farben als Variable anlegen.
- Das Dashboard soll auf Desktop **und** Handy funktionieren (Navigation unten ab 760 px).

## Firmware: Konventionen

- Neue Pins nur in `firmware/include/pins.h`. Pro Gerät eine Klasse in `firmware/lib/<Name>/`, `update()` nicht blockierend, im Task aufgerufen.
- Arduino-Core 2.x **und** 3.x müssen gehen (`#if ESP_ARDUINO_VERSION_MAJOR >= 3`, siehe `Actuators`).
- Alles, was Gas, Ruder oder Pumpe bewegt, läuft durch **eine** Stelle, die scharf, NOT-AUS, Testmodus und Grenzen prüft. Direktes Schreiben an ESC oder Servo ausserhalb davon ist ein Fehler.
- I2C Bus 2 (BMP280, INA226, PCA9685, ADS1115) wird von mehreren Tasks genutzt: nur mit Mutex.
- Kommentare auf Deutsch, im Stil des vorhandenen Codes.

## Schnittstelle (Kurzfassung, Details in `docs/schnittstelle.md`)

Transport: **MQTT 3.1.1 über TLS, JSON**, Broker Mosquitto (`deploy/`), TLS beendet der Reverse Proxy (`mfos.mfsquare.ch`, Port 8883 oder `wss` auf 443 unter `/mqtt`). Topics `mfos/<id>/telemetry|status|event|cmd|ack`. Das Boot meldet sich mit Benutzername = Kennung und starkem Passwort an, **prüft das Zertifikat** (Let's Encrypt, festgelegtes Wurzelzertifikat) und braucht dafür die richtige Uhrzeit. Ein Boot darf nur seine eigenen Topics.

**Die Firmware muss senden:**

| Was | Schlüssel / Inhalt |
|---|---|
| Telemetrie (schnell, Standard 1 s, bis 100 ms) | `t`, `lat`, `lon`, `speed`, `course`, `heading`, `roll`, `pitch`, `bat_v`, `bat_a`, `bat_w`, `bat_mah`, `bat_wh`, `temp_hull`, `temp_esc`, `cmd_throttle`, `cmd_rudder` |
| Zustand (sofort bei Änderung) | `mode` (`MANUAL`/`AUTO`/`RTH`/`STOP`/`ESTOP`), `armed`, `test`, `wp_active`, `mission_id`, `mission_name`, `pump_on`, `pump_mode`, `pump_speed`, `light_mode`, `leak`, `fix`, `link` (`lte`/`wifi`/`none`) |
| Langsam (≥ alle 10 s) | `pressure`, `sats`, `hdop`, `lte_dbm`, `lte_operator`, `lte_tech`, `wifi_ssid`, `wifi_rssi`, `wifi_ip`, `data_lte_mb_today`/`_reset`/`_total`, `uptime_s`, `fw`, `boot_id` |
| Ereignisse | `boot`, `armed`, `disarmed`, `estop`, `estop_released`, `mission_started`, `mission_done`, `home_reached`, `stopped`, `failsafe`, `geofence_exit`, `test_started`, `test_ended`, `net_switch`, `wifi_result`, `counter_reset` |
| Quittung zu jedem Befehl | `{id, ok}` oder `{id, ok:false, error}` innerhalb 2 s |
| Online-Status | retained, «offline» als Last Will |

**Die Firmware muss empfangen und ausführen können:**

| Gruppe | Befehle |
|---|---|
| Fahren | `arm`, `disarm`, `start`, `stop`, `rth`, `estop`, `release` |
| Konfiguration | `setMission` (Wegpunkte, auch `{home:true}`), `setHome`, `setParams` (`cruiseSpeed`, `maxThrottle`, `arriveRadius`, `loop`, `geofence`, `failsafe`, `linkTimeout`, `pumpOn`, `pumpOff`, `telemetry`, …) |
| Aktoren | `setLight` 0–5, `setPumpMode` `auto`/`on`/`off`, `setPumpSpeed` 10–100 |
| Zähler | `resetConsumption`, `resetLteData` |
| Verbindung | `setNetMode` `auto`/`lte`/`wifi`, `setWifi` (ssid, password), `forgetWifi` |
| Test | `testStart`, `testEnd`, `testSet` (`motor` mit Totmann, `servo`, `pump`, `pumpSpeed`, `light`) |
| Regler | `setTune` (Werte `<gruppe>.<name>`, Liste in `dashboard/js/tune-defs.js`), `tuneDefaults`, `tuneRestore`, `tuneMarkGood`, `tuneStep`/`tuneStop` (Sprungtest nur scharf und `AUTO`, Tuning-Telemetrie `tune`), siehe `docs/schnittstelle.md` 6a |

Befehlsform: `{"id","cmd","args","ts","ttl_ms"}`. Das Dashboard berechnet Akku-Prozent, Restlaufzeit, Distanzen, ETA, Alarme und Fahrten-Kennzahlen selbst, die Firmware liefert das nicht.

**Wer eine Seite der Schnittstelle ändert, ändert zuerst `docs/schnittstelle.md`, dann `dashboard/js/state.js` (Simulation und Schlüssel) und die Kurzfassungen in `CLAUDE.md` und `dashboard/README.md`.**

## Sicherheitsregeln, nie abschwächen

1. Nach jedem Start und nach NOT-AUS ist das Boot **nicht scharf**. `start` und `rth` nur wenn scharf.
2. NOT-AUS wirkt sofort ohne Rückfrage. Freigeben verlangt eine Eingabe und lässt das Boot entschärft.
3. Testmodus nur bei entschärftem, gestopptem Boot. Motor nur mit Totmann, höchstens 10 s am Stück. Pumpe höchstens 30 s.
4. Befehle verfallen (`ttl_ms`), nach Verbindungsabbruch wird nichts nachgeholt.
5. Alle Schranken gelten im Boot. Das Dashboard darf sie anzeigen, nie allein darauf verlassen.
6. WLAN-Passwörter nie anzeigen, protokollieren oder zurücksenden.
7. Die Firmware verbindet nie ohne Prüfung des Serverzertifikats (kein «unsicher»-Modus), auch nicht zum Testen.
8. Keine Zugangsdaten, Schlüssel oder `.env` ins Repository.

## Regeln für die Arbeit hier

- **Nichts über die Hardware behaupten, was nicht im Code oder Datenblatt steht.** Unbekanntes als «nicht geprüft» kennzeichnen (zum Beispiel ob der A7670E einen eigenen Datenzähler hat).
- Firmware wurde nie gebaut (kein PlatformIO). Ehrlich sagen, dass Firmware-Änderungen ungetestet sind.
- Beim Umbenennen oder Verschieben Verweise in den Dokumenten mitziehen.
- Keine Zugangsdaten, Schlüssel oder echte Koordinaten des Besitzers in Dateien schreiben (die Karte nutzt Platzhalter am Greifensee).
- Nicht committen oder pushen ohne ausdrückliche Bitte.

## Offene Entscheidungen

0. **Login-Bildschirm und Logout-Knopf** fürs Dashboard (heute nur Basic Auth: Browser-Fenster, kein Abmelden). Optionen und Empfehlung (Login im Backend) in `docs/stand-und-naechste-schritte.md`, Abschnitt 4. **Noch nicht entschieden und nicht gebaut.**
0b. **Seite «Tuning»** (vier Regler: Tempo, Kurs, Gierrate, Bahn, dazu Ruder, Gas, Annäherung, Filter, Strombegrenzung): **als Mockup gebaut** (`js/tune-defs.js` = Werteliste, Grenzen, Standardwerte; `js/tune-sim.js` = Platzhalter-Boot für die Sprungtests; `js/view-tuning.js`). Vertrag: `docs/schnittstelle.md` 6a, Begründung und offene Hardwarefragen: `docs/regler.md`. Die Standardwerte und das Platzhalter-Boot sind **nicht gemessen**. Die Firmware hat bisher keinen Regler.
1. **Backend** hinter Mosquitto: Speicherung, Fahrten, Kurse, Befehle mit Verfall, Anmeldung mit Zweitfaktor. (ThingsBoard ist entschieden **nicht**.) Bis dahin zeigt das Dashboard nur Simulation und sollte nicht mit echten Daten betrieben werden.
2. **UART:** ESP32 hat 3 UARTs (USB, GPS, SBUS), das LTE-Modem wäre die vierte. `pins.h` nennt UART1 für das Modem, `RcReceiver` nutzt standardmässig UART1.
3. **Vollgas-Geschwindigkeit** (Dashboard nimmt 14 km/h bei 100 % Gas an) messen und als Parameter einführen.
4. Aktion bei Geofence-Verlassen, kritischem Akku, kritischer ESC-Temperatur.
5. Option «Position halten» bei Verbindungsverlust (ESC fährt nur vorwärts): wahrscheinlich streichen.
6. Datenmenge bei 100 ms Sendeintervall über LTE (rund 400 MB pro Tag).
7. Anmeldung, mehrere Boote.
