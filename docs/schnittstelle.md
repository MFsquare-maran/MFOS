# Schnittstelle Boot ↔ Dashboard

**Status:** Entwurf 0.1. Das Dashboard (`dashboard/`) setzt diese Schnittstelle bereits als Simulation um (`dashboard/js/state.js`). Die Firmware (`firmware/`) setzt davon noch nichts um, siehe `firmware/README.md`.

Dieses Dokument ist die **einzige Quelle der Wahrheit** für alles, was zwischen Boot und Dashboard fliesst. Wer eine Seite ändert, ändert hier den Vertrag und danach beide Seiten.

## 1. Grundregeln

1. **Das Boot ist die Wahrheit.** Das Dashboard zeigt nur, was das Boot meldet. Ein Knopfdruck ändert nichts in der Anzeige, bis das Boot es bestätigt (Ack) oder in der Telemetrie meldet.
2. **Sicherheit sitzt im Boot.** Jede Schranke, die das Dashboard zeigt (scharf, NOT-AUS, Testmodus, Grenzen), muss das Boot selbst durchsetzen. Ein Dashboard-Fehler oder Verbindungsabbruch darf nie etwas anfahren (Abschnitt 9).
3. **Befehle verfallen.** Jeder Befehl trägt eine Lebensdauer (`ttl_ms`). Das Boot führt abgelaufene Befehle nicht aus. Es holt nach einem Verbindungsabbruch nichts nach.
4. **Einheiten:** Geschwindigkeit in **km/h**, Winkel in **Grad**, Temperatur in **°C**, Druck in **hPa**, Strom **A**, Spannung **V**, Leistung **W**, Ladung **mAh**, Energie **Wh**, Datenvolumen **MB**. Zeit als **UTC in Millisekunden seit 1970** (`t`). Die Anzeige in m/s rechnet nur das Dashboard.
5. **Sollwerte sind keine Rückmeldung.** `cmd_throttle` und `cmd_rudder` sind das, was das Boot an ESC und Servo ausgibt. Eine Stellungsrückmeldung der Aktoren gibt es nicht.

## 2. Transport

**MQTT 3.1.1 über TLS** auf einem eigenen **Mosquitto**-Broker (entschieden; ThingsBoard wird nicht verwendet). Der Broker läuft im Docker-Stack `deploy/` hinter einem **Reverse Proxy** (Domain `mfos.mfsquare.ch`). **Den TLS-Teil übernimmt der Proxy**, der Broker selbst spricht nur Klartext und ist nie direkt aus dem Internet erreichbar. Siehe `deploy/README.md`. Ein schlankes eigenes Backend (Speicherung, Fahrten, Kurse, Befehle mit Verfallszeit) kommt später dazu und spricht mit dem Broker; es ist noch nicht gebaut.

**Verbindung des Boots (Pflicht für die Firmware):**

| Punkt | Vorgabe |
|---|---|
| Server und Port | `mfos.mfsquare.ch`. **Weg A:** Port **8883** mit TLS (der Proxy beendet TLS und leitet an Mosquitto). **Weg B:** Port **443**, `wss`, Pfad `/mqtt` (MQTT über WebSocket). Welcher Weg gilt, ist noch zu entscheiden (`deploy/README.md`). |
| Serverprüfung | Die Firmware prüft das Zertifikat des Proxys (Let's Encrypt) gegen ein festgelegtes Wurzelzertifikat (zum Beispiel **ISRG Root X1**) und verbindet **nie** ohne Prüfung. Der Hostname muss genau `mfos.mfsquare.ch` sein. Die Kette, die der Proxy ausliefert, ist vorher zu prüfen. |
| Anmeldung | Benutzername = Boots-Kennung `<id>`, Passwort = zufällig, mindestens 20 Zeichen. Kein anonymer Zugang. |
| Uhrzeit | Die TLS-Prüfung braucht die richtige Zeit (Gültigkeitszeitraum des Zertifikats). Das Boot holt sie vor dem Verbinden aus GPS, Netzzeit oder NTP. |
| Client-ID | Gleich der Boots-Kennung. |
| Last Will | Topic `mfos/<id>/status`, Nutzlast `{"online": false}`, retained, QoS 1. Beim Verbinden meldet das Boot `{"online": true}` retained. |
| Wiederverbinden | Mit wachsender Wartezeit (1 s bis 60 s), damit ein Fehler den Broker nicht überlastet. |

Rechte (ACL im Broker): Ein Boot darf **nur** `mfos/<id>/telemetry`, `status`, `event`, `ack`, `tune` schreiben und `mfos/<id>/cmd` lesen. Mehr geht nicht, auch nicht für ein anderes Boot.

Diese Schnittstelle ist so beschrieben (Topics und JSON), dass sie nicht an einen bestimmten Server gebunden ist.

Topics, `<id>` ist die Boots-Kennung, zum Beispiel `mfos-1`:

| Topic | Richtung | QoS | Inhalt |
|---|---|---|---|
| `mfos/<id>/telemetry` | Boot → Server | 0 | Messwerte (Abschnitt 3) |
| `mfos/<id>/status` | Boot → Server | 1, retained | `online`/`offline`; «offline» als Last Will |
| `mfos/<id>/event` | Boot → Server | 1 | Ereignisse (Abschnitt 4) |
| `mfos/<id>/tune` | Boot → Server | 1 | aufgezeichneter Verlauf eines Sprungtests (Abschnitt 6a) |
| `mfos/<id>/cmd` | Server → Boot | 1 | Befehle (Abschnitt 5) |
| `mfos/<id>/ack` | Boot → Server | 1 | Quittungen (Abschnitt 5) |

Der Boots-Broker-Zugang ist je Boot eigen (Benutzer plus Passwort oder Zertifikat). Das Dashboard bekommt nie die Boots-Zugangsdaten.

## 3. Telemetrie (Boot → Server)

Eine JSON-Nachricht, flaches Objekt. Alle Schlüssel sind optional; fehlt einer, behält das Dashboard den letzten Wert. «Schnell» heisst: in jedem Sendeintervall (Parameter `telemetry`, Standard 1 s, kleinster Wert 100 ms). «Langsam»: bei Änderung und mindestens alle 10 s. «Zustand»: ausserdem sofort bei jeder Änderung.

| Schlüssel | Typ | Einheit | Quelle (Hardware / Firmware) | Takt |
|---|---|---|---|---|
| `t` | int | ms UTC | GPS-Zeit oder Netzzeit | schnell |
| `lat`, `lon` | float | ° | GPS u-blox M8N, `gps.getLat/Lon()` | schnell |
| `speed` | float | km/h | `gps.getSpeedKmh()` | schnell |
| `course` | float | ° | `gps.getCourse()` | schnell |
| `heading` | float | ° 0–360 | IMU, `imu.getHeading()` | schnell |
| `roll`, `pitch` | float | ° | IMU LSM9DS1 | schnell |
| `bat_v`, `bat_a`, `bat_w` | float | V, A, W | INA226 | schnell |
| `bat_mah`, `bat_wh` | float | mAh, Wh | im Boot aufsummiert, im Flash gesichert | schnell |
| `temp_hull` | float | °C | BMP280 (Innenraum) | schnell |
| `temp_esc` | float | °C | NTC am ADS1115 (Fahrtregler) | schnell |
| `leak` | bool | – | Leck-Sensor am ADS1115, `ads.isWaterDetected()` | Zustand |
| `cmd_throttle` | float | % 0–100 | an den ESC ausgegeben | schnell |
| `cmd_rudder` | float | % 0–100, 50 = Mitte | an das Servo ausgegeben | schnell |
| `mode` | string | – | `MANUAL`, `SOFT`, `AUTO`, `RTH`, `STOP`, `ESTOP` | Zustand |
| `armed` | bool | – | scharf (Abschnitt 8) | Zustand |
| `test` | bool | – | Testmodus aktiv | Zustand |
| `wp_active` | int | 1-basiert | aktueller Wegpunkt | Zustand |
| `mission_id`, `mission_name` | string | – | Kurs auf dem Boot | Zustand |
| `pump_on` | bool | – | Kühlpumpe läuft | Zustand |
| `pump_mode` | string | – | `auto`, `on`, `off` | Zustand |
| `pump_speed` | int | % 10–100 | Drehzahl der Pumpe | Zustand |
| `light_mode` | int | 0–5 | Lichtmodus | Zustand |
| `pressure` | float | hPa | BMP280 | langsam |
| `sats` | int | – | GPS | langsam |
| `fix` | bool | – | GPS-Fix gültig | Zustand |
| `hdop` | float | – | GPS | langsam |
| `link` | string | – | aktive Verbindung: `lte`, `wifi`, `none` | Zustand |
| `lte_dbm` | int | dBm | Modem A7670E (`AT+CSQ` umgerechnet) | langsam |
| `lte_operator`, `lte_tech` | string | – | Modem | langsam |
| `wifi_ssid`, `wifi_rssi`, `wifi_ip` | string/int/string | –, dBm, – | ESP32-WLAN | langsam |
| `data_lte_mb_today`, `data_lte_mb_reset`, `data_lte_mb_total` | float | MB | Zähler im Boot (Schätzung, nur LTE) | langsam |
| `uptime_s`, `fw`, `boot_id` | int/string/string | s | Firmware-Version, Zufallswert pro Start | langsam |

Die Firmware liefert **keine** Alarme, Prozentwerte (Akku), Restlaufzeit, Distanzen oder Ankunftszeiten. Das rechnet das Dashboard aus (Abschnitt 11).

## 4. Ereignisse (Boot → Server)

`{"t": 1732290000000, "level": "info", "code": "mission_done", "text": "Mission abgeschlossen"}`

`level`: `info`, `ok`, `warn`, `crit`. `text` ist deutsch und wird im Ereignis-Log gezeigt. `code` ist maschinenlesbar:

| `code` | Bedeutung | `args` |
|---|---|---|
| `boot` | Boot gestartet (immer nicht scharf) | `reason` |
| `armed`, `disarmed` | Scharf-Zustand geändert | `reason` |
| `estop`, `estop_released` | NOT-AUS ausgelöst oder freigegeben | `source`: `dashboard`, `rc`, `boat` |
| `mission_started` | Mission begonnen | `id`, `name` |
| `mission_done` | letzter Wegpunkt erreicht, Schleife aus | – |
| `home_reached` | Return Home abgeschlossen | – |
| `stopped` | Stopp ausgeführt | – |
| `failsafe` | Verbindungsverlust-Aktion ausgelöst | `action` |
| `geofence_exit` | Geofence verlassen | `dist_m` |
| `test_started`, `test_ended` | Testmodus | `reason` |
| `net_switch` | Verbindung gewechselt | `link` |
| `wifi_result` | WLAN-Zugang ausprobiert | `ok`, `error` |
| `counter_reset` | Verbrauchs- oder Datenzähler zurückgesetzt | `which` |

Das Dashboard beendet eine **Fahrt** (Aufzeichnung), sobald `mode` auf `STOP` oder `ESTOP` wechselt. Den Grund dafür nimmt es aus dem zuletzt gemeldeten Ereignis (`stopped`, `estop`, `mission_done`, `home_reached`, `disarmed`, `failsafe`).

## 5. Befehle (Server → Boot) und Quittung

```json
{"id": "c-1a2b", "cmd": "start", "args": {}, "ts": 1732290000000, "ttl_ms": 5000}
```

Das Boot quittiert **innerhalb von 2 s** auf `mfos/<id>/ack`:

```json
{"id": "c-1a2b", "ok": true}
{"id": "c-1a2b", "ok": false, "error": "not_armed", "msg": "Boot ist nicht scharf"}
```

Fehlercodes: `no_run`, `wrong_mode`, `expired`, `not_armed`, `armed`, `estop_active`, `not_stopped`, `test_inactive`, `test_active`, `offline_link` (Befehl braucht Verbindung), `invalid_arg`, `no_wifi`, `busy`, `unsupported`.

| `cmd` | `args` | Vorbedingung | Wirkung |
|---|---|---|---|
| `arm` | – | kein NOT-AUS, kein Testmodus | scharf schalten |
| `disarm` | – | – | entschärfen; läuft eine Fahrt, wird sie gestoppt |
| `start` | – | scharf, kein NOT-AUS, Mission vorhanden | Mission ab `wp_active` fahren; neuer Kurs beginnt bei 1 |
| `manual` | – | scharf, kein NOT-AUS, nicht `TUNE` | Modus `MANUAL`: Gas und Ruder kommen vom Sender (SBUS), das Boot führt keine Mission aus. `maxThrottle` und alle Schranken gelten weiter |
| `soft` | – | scharf, kein NOT-AUS, nicht `TUNE` | Modus `SOFT` («Manuell Soft»): das Boot hält ein vom Dashboard gesetztes **Tempo** (Tempo-Regler), das **Ruder** kommt vom Sender. Tempo beim Eintritt 0 |
| `setSoftSpeed` | `kmh` 0 bis wirksames Tempo | Modus `SOFT` | Soll-Tempo setzen; das Boot begrenzt auf `cruiseSpeed`/`maxThrottle`. Das Tempo gilt nur solange die Verbindung steht: nach `linkTimeout` greift `failsafe` |
| `stop` | – | – | Motor aus, Ruder Mitte, Modus `STOP` |
| `rth` | – | scharf, kein NOT-AUS | zum Home-Punkt fahren, dann `STOP` |
| `estop` | – | – | **sofort** Motor aus, entschärfen, Modus `ESTOP` |
| `release` | – | Modus `ESTOP` | NOT-AUS freigeben; **bleibt entschärft**, Modus `STOP` |
| `setLight` | `mode` 0–5 | – | Lichtmodus (Abschnitt 7) |
| `setPumpMode` | `mode`: `auto`/`on`/`off` | – | Kühlpumpe |
| `setPumpSpeed` | `percent` 10–100 | – | Drehzahl der Kühlpumpe |
| `setMission` | `id`, `name`, `wps[]` | – | Kurs speichern (Flash). Schlüssel `wps` siehe unten |
| `setHome` | `lat`, `lon` | – | Home-Punkt speichern |
| `setParams` | Objekt, nur die geänderten Schlüssel | – | Parameter speichern (Abschnitt 6) |
| `resetConsumption` | – | – | `bat_mah`, `bat_wh` auf 0, auch im Flash |
| `resetLteData` | – | – | `data_lte_mb_reset` auf 0 |
| `setNetMode` | `mode`: `auto`/`lte`/`wifi` | `wifi` nur mit gespeichertem, verbundenem WLAN | Verbindungsart (Abschnitt 10) |
| `setWifi` | `ssid`, `password` | – | WLAN ausprobieren und speichern |
| `forgetWifi` | – | – | WLAN löschen, bei `wifi` zurück auf `auto` |
| `testStart` | – | entschärft, Modus `STOP`, kein NOT-AUS | Testmodus (Abschnitt 9) |
| `testEnd` | – | – | Testmodus beenden, alle Ausgänge aus |
| `testSet` | `kind` + Wert, siehe unten | Testmodus aktiv | Aktor ansteuern |
| `setTune` | Objekt `{ "speed.kp": 6, … }`, nur die geänderten Schlüssel | – | Regler- und Tuning-Werte setzen (Abschnitt 6a) |
| `tuneDefaults` | `group` (optional) | – | Standardwerte einer Gruppe oder aller Gruppen |
| `tuneRestore` | – | – | «Letzter guter Satz» wiederherstellen |
| `tuneMarkGood` | – | – | aktuellen Satz als «letzten guten» im Flash merken |
| `tuneStep` | `ctrl`: `speed`/`course`/`yaw`/`track`, `size` | scharf, Modus `TUNE`, kein NOT-AUS | Sprungtest starten (Abschnitt 6a) |
| `tuneMode` | `on`: `true`/`false` | `on: true` nur entschärft, `STOP`, kein NOT-AUS, kein Testmodus | Tuning-Modus ein/aus; aus: Modus `STOP`, entschärft |
| `tuneFetch` | `run`, `from` (Teilstück ab dieser Nummer, optional) | Lauf liegt noch im Boot | Verlauf oder fehlende Teilstücke erneut senden (Abschnitt 6a) |
| `tuneStop` | – | – | Sprungtest abbrechen, normale Regelung übernimmt |

**`wps`:** Liste von `{"lat": 47.35, "lon": 8.68}` oder `{"home": true}`. Der Eintrag `home` bedeutet die jeweils aktuelle Home-Position und wird erst bei der Fahrt aufgelöst. Höchstens 100 Punkte.

**`testSet`:**

| `kind` | Wert | Besonderheit |
|---|---|---|
| `motor` | `value` 0–100 (%) | **Totmann:** Das Dashboard sendet den Befehl alle 200 ms erneut, solange der Knopf gedrückt ist. Bleibt die Wiederholung 500 ms aus, stoppt das Boot. Höchstens 10 s am Stück. |
| `servo` | `value` 0–100 (%), 50 = Mitte | – |
| `pump` | `value` `true`/`false`/`null` (`null` = zurück auf den normalen Modus) | höchstens 30 s am Stück |
| `pumpSpeed` | `value` 10–100 | – |
| `light` | `ch`: `red`, `green`, `white1`, `white2`; `value` 0–100 (%) | – |

## 6. Parameter

Parameter gehören dem Boot (Flash) und werden mit `setParams` geändert. Das Boot meldet beim Start den vollen Satz im Ereignis `boot` (Feld `params`). «Wer» sagt, wer den Wert benutzt.

| Schlüssel | Einheit | Standard | Bereich | Wer | Bedeutung |
|---|---|---|---|---|---|
| `cruiseSpeed` | km/h | 5.6 | 1–14 | Boot | Zieltempo auf Mission und Return Home |
| `maxThrottle` | % | 70 | 20–100 | Boot | harte Gasgrenze; **die stärkere Begrenzung von `cruiseSpeed` und `maxThrottle` gilt** |
| `arriveRadius` | m | 8 | 2–30 | Boot | Kreis um Wegpunkt oder Home, ab dem er als erreicht gilt |
| `loop` | bool | true | – | Boot | nach dem letzten Wegpunkt wieder bei 1 beginnen (nur bei mehr als einem Punkt) |
| `geofence` | m | 600 | 50–3000 | beide | Radius um Home. Das Boot löst bei Verlassen eine Aktion aus (offen, siehe 13), das Dashboard zeigt den Alarm |
| `failsafe` | Text | `Return Home` | `Stopp`, `Return Home`, `Position halten` | Boot | Aktion bei Verbindungsverlust |
| `linkTimeout` | s | 10 | 3–120 | Boot | so lange ohne Befehl/Verbindung, bevor `failsafe` greift |
| `pumpOn` | °C | 40 | 20–90 | Boot | Kühlpumpe ein ab dieser ESC-Temperatur (Modus `auto`) |
| `pumpOff` | °C | 33 | 15–85 | Boot | Pumpe aus unter dieser Temperatur; muss kleiner sein als `pumpOn` |
| `telemetry` | Text | `1 s` | `100 ms`, `200 ms`, `500 ms`, `1 s`, `2 s`, `5 s`, `10 s` | Boot | Sendeintervall der schnellen Werte |
| `battWarn` | V | 14.4 | 12–17 | Dashboard | Akku-Warnung (4S-Akku angenommen) |
| `battCrit` | V | 13.8 | 12–17 | Dashboard, Boot | kritisch; das Boot soll hier handeln (offen, siehe 13) |
| `battCap` | mAh | 5000 | 500–20000 | Dashboard | für die Restlaufzeit |
| `escWarn` | °C | 60 | 30–120 | Dashboard | ESC-Warnung |
| `escCrit` | °C | 75 | 30–120 | Dashboard, Boot | kritisch; das Boot soll hier Gas reduzieren (offen) |
| `hullWarn` | °C | 45 | 20–80 | Dashboard | Innenraum-Warnung |
| `dataLimit` | MB | 1000 | 50–20000 | Dashboard | LTE-Monatsgrenze |

Dashboard-eigene Werte muss das Boot nicht speichern. In der heutigen Simulation gehen alle Parameter in einem Satz an das Boot; im echten System genügt das für die Spalte «Boot».

## 6a. Regler und Tuning

Vorlage und Begründung: `docs/regler.md`. Die Werte heissen `<gruppe>.<name>` und werden mit `setTune` gesetzt (nicht mit `setParams`). Die Liste mit Einheiten, Grenzen und Standardwerten steht **allein** in `dashboard/js/tune-defs.js` (`M.TUNE_GROUPS`); das Boot muss dieselben Grenzen durchsetzen und Werte ausserhalb mit `invalid_arg` ablehnen (das ganze Paket, nichts wird teilweise übernommen). Tempo-Werte sind km/h.

| Gruppe | Art | Werte |
|---|---|---|
| `speed` | PID | `kp`, `ki`, `ff`, `iLimit` |
| `course` | PID | `kp`, `ki`, `iLimit`, `maxRate`, `kd` |
| `yaw` | PID | `enabled`, `kp`, `ki`, `kd`, `iLimit`, `ff` |
| `track` | PID | `kp`, `ki`, `iLimit`, `maxCorr` |
| `rudder` | Werte | `trim`, `maxDefl`, `slew`, `deadband`, `reverse`, `minUs`, `maxUs` |
| `esc` | Werte | `rampUp`, `rampDown`, `startThr`, `minUs`, `maxUs` |
| `appr` | Werte | `turnAngle`, `turnFactor`, `nearDist`, `nearFactor` |
| `filt` | Werte | `headingAlpha`, `compassBlend`, `gpsSpeedAlpha`, `gpsCourseMinSpeed` |
| `curr` | Werte | `enabled`, `maxCurrent` |

- **Kaskade:** Bahn-Regler → Kurs-Regler → Gierraten-Regler → Ruder; Tempo-Regler → Gas. Ist `yaw.enabled = false`, stellt der Kurs-Regler das Ruder direkt (mit Gyro-Dämpfung `course.kd`).
- Das Boot meldet beim Start den vollen Satz im Ereignis `boot` (Feld `tune`) und nach jeder Änderung im Zustand (`tune_rev`, hochgezählt). Das Dashboard vergleicht Entwurf und aktiven Satz.
- **Weiche Übernahme:** Neue Werte gelten ab dem nächsten Regeltakt, Integratoren werden dabei so nachgeführt, dass das Stellsignal nicht springt.
- **Letzter guter Satz:** Das Boot hält zwei Sätze im Flash, den aktuellen und den letzten als gut markierten (`tuneMarkGood`).
- **Sprungtest** (`tuneStep`): nur im Modus `TUNE` bei scharfem Boot (keine Mission nötig) und nur mit Abbruch durch `tuneStop`, NOT-AUS, Entschärfen, Ende von `TUNE`, Verbindungsverlust und Ablauf von 90 s. Grösse `size`: Tempo-Sprung in km/h, Kurssprung in °, Drehraten-Sprung in °/s, Startabstand zur Linie in m (Grenzen in `tune-defs.js`, `test`).
- **Aufzeichnung im Boot, Upload danach** (nicht live): Live-Messwerte mit 10 bis 100 Hz über LTE und MQTT gehen verloren oder kommen durcheinander. Darum zeichnet das **Boot** den Sprungtest selbst auf, mit **eigenen Zeitstempeln** (ms seit Teststart) im Regeltakt, und schickt den fertigen Verlauf **nach dem Test** (oder nach Abbruch) auf `mfos/<id>/tune`, QoS 1. Während des Tests meldet es nur Zustand und Ereignisse (`tune_started`, `tune_ended`), keine Messwerte.
  - **Abtastrate** je Regler (Vorschlag): Gierrate 50 Hz, Kurs 25 Hz, Tempo 10 Hz, Bahn 10 Hz. Die höchste Rate, die der Regler wirklich rechnet, nie mehr als nötig, damit der Puffer im RAM klein bleibt (Ziel höchstens 2000 Zeilen, als 16-Bit-Zahlen mit Skalierung, etwa 40 KB; ob das im ESP32-RAM Platz hat, ist **nicht geprüft**).
  - **Kopf** (`kind: "tune_run"`): `{run, ctrl, size, set_rev, rate_hz, n, chunks, t0_ts, gps_hz, fields, scale, reason}`. `t0_ts` ist der Zeitpunkt des Sprungs (Epoch ms, wie `ts` der Befehle), `reason` der Grund des Endes (`done`, `stopped`, `estop`, `disarmed`, `link`, `timeout`).
  - **Teilstücke** (`kind: "tune_chunk"`): `{run, seq, rows}` mit höchstens etwa 4 KB je Nachricht. `rows` sind Zeilen in der Reihenfolge von `fields`; Zeit `t` in ms seit Sprung.
  - **Felder** (Rohwerte und Regleranteile): `t`, `sp` (Soll), `pv_raw` (Messwert roh), `pv` (gefiltert, so wie der Regler ihn sieht), `out` (Ausgang des Reglers vor den Grenzen), `act` (Ausgang nach Rampe, Slew und Grenzen, das was an ESC oder Servo geht), `p`, `i`, `d`, `ff`, dazu `gyro`, `heading`, `gps_speed`, `gps_fresh` (1, wenn der Wert in diesem Takt ein neues GPS-Ergebnis ist; so erkennt das Dashboard die echte GPS-Rate).
  - **Vollständigkeit:** Das Dashboard prüft `seq` lückenlos und fordert Fehlendes mit `tuneFetch` (`run`, `from`) nach. Das Boot hält **den letzten Lauf** im RAM, bis der nächste Test beginnt oder es neu startet. Danach `no_run`.
  - Der Verlauf wird **nicht** als Fahrt aufgezeichnet und nicht dauerhaft gespeichert; das Dashboard hält ihn im Browser (Vergleich mehrerer Läufe und CSV-Export sind **vorgesehen, noch nicht gebaut**).
- Ereignisse: `tune_started`, `tune_ended` (mit `reason`: `done`, `stopped`, `estop`, `disarmed`, `link`, `timeout`).
- Die Kennzahlen (Anstiegszeit, Überschwingen, Beruhigungszeit, bleibende Abweichung) rechnet das Dashboard aus dem **gefilterten Messwert `pv`** des aufgezeichneten Laufs (nicht aus wahren Werten, die es am echten Boot nicht gibt). Es warnt, wenn zu wenige GPS-Messpunkte (`gps_fresh`) im Anstieg liegen.

## 7. Licht, Pumpe, Aktoren

- **Lichtmodi** (`setLight`, Kanäle am PCA9685: Rot 0, Grün 1, Weiss 1 = 2, Weiss 2 = 3, beide Weiss am Mast): 0 aus, 1 alles an, 2 Positionslichter (Rot und Grün fest), 3 Positionslichter fest plus weisser Doppelblitz, 4 nur weisser Doppelblitz, 5 alle zusammen blinken (500 ms an, 500 ms aus).
- **Kühlpumpe** (PCA9685-Kanal 4, Wasserpumpe für den ESC): Modus `auto` schaltet mit Hysterese nach `temp_esc` (ein ab `pumpOn`, aus unter `pumpOff`). `on` und `off` zwingen. Die Drehzahl `pump_speed` gilt, wann immer die Pumpe läuft.
- **ESC** (GPIO 25) und **Servo** (GPIO 18): 50 Hz, 1000 bis 2000 µs für 0 bis 100 %. Der ESC läuft nur vorwärts, 0 % ist Stillstand.

## 8. Modi und «scharf»

Modi (`mode`): `MANUAL` (Fernsteuerung, Gas und Ruder vom Sender), `SOFT` (Tempo vom Dashboard, Ruder vom Sender), `AUTO` (Mission), `RTH` (Return Home), `TUNE` (Tuning, nur von der Seite Tuning aus), `STOP`, `ESTOP`.

| Regel | Beschreibung |
|---|---|
| Nach jedem Start | **nicht scharf**, Modus `STOP` |
| `start` und `rth` | nur wenn `armed` und kein `ESTOP`, sonst Ack mit `not_armed` |
| `estop` | setzt `armed = false`, Modus `ESTOP` |
| `release` | Modus `STOP`, `armed` bleibt `false` |
| `arm` | abgelehnt bei `ESTOP` oder aktivem Testmodus |
| `disarm` | `armed = false`; war der Modus `AUTO`, `RTH`, `MANUAL` oder `SOFT`, wird er `STOP` |
| `tuneMode` an | nur aus `STOP`, entschärft; danach darf mit `arm` scharf geschaltet werden. In `TUNE` werden `start` und `rth` mit `wrong_mode` abgelehnt |
| Tuning beendet | `tuneMode` aus, Verbindungsverlust, NOT-AUS oder Seitenwechsel: Modus `STOP` (bzw. `ESTOP`), `armed = false` |
| Mission zu Ende | bei `loop = false` oder nur einem Punkt: Modus `STOP` |
| Return Home erreicht | Modus `STOP` |

## 8a. Checkliste vor dem Scharfschalten

Das Dashboard zeigt sie bei jedem «Scharf schalten» (Live und Tuning). Sie ist ein Schritt für den **Menschen**; das Boot kennt sie nicht und darf sich nicht darauf verlassen (Schranken gelten im Boot).

- **Automatisch geprüft** (das Dashboard liest die Telemetrie und den Zustand selbst): Verbindung, Alter der letzten Meldung (> 10 s sperrt), GPS (Fix, Satelliten, HDOP), Leck-Sensor, Akku (`battWarn`/`battCrit`), ESC-Temperatur, Funksignal, Lage (Roll/Pitch > 20° warnt), Innenraum-Temperatur, Testmodus aus. Bei Fahrt zusätzlich: Kurs geladen, Abstand Boot–Home innerhalb `geofence`, alle Wegpunkte innerhalb `geofence`, Akku reicht für die Kurslänge (Rest geteilt durch nötige Zeit, unter 1,0 sperrt, unter 1,5 warnt), Kurs/Home/Einstellungen vom Boot bestätigt. ✕ sperrt das Scharfschalten, ! warnt nur.
- **Von Hand abzuhaken** (alle Pflicht). Fahrt: Wasser und Propeller frei; Rumpf dicht und Akku gesichert; Kurs und Home geprüft. Tuning zusätzlich: Sender an und NOT-AUS in Reichweite, Rückholplan bekannt, mindestens 50 m freie Wasserfläche, Boot während der Tests beobachten (bei Auffälligkeit NOT-AUS).
- Umgesetzt in `dashboard/js/ui.js` (`M.preflight`, `M.preflightAuto`, `M.preflightChecks`).

## 9. Sicherheitsanforderungen an die Firmware

1. **Nicht scharf nach dem Einschalten.** `armed` ist nach jedem Start und nach jedem NOT-AUS `false`, auch nach einem Watchdog-Reset.
2. **NOT-AUS hat Vorrang** vor allem anderen, auch vor einem laufenden Test. Er sollte zusätzlich per Fernsteuerung (SBUS-Schalter) auslösbar sein. Ablauf: Gas 0, Ruder Mitte, Pumpe und Lichter unverändert, `armed = false`.
3. **Befehls-Lebensdauer prüfen** (`ttl_ms`, Zeitstempel `ts`); abgelaufene Befehle mit `expired` ablehnen. Nach einem Wiederverbinden werden keine alten Befehle ausgeführt (kein Server-Puffer mit langer Lebensdauer).
4. **Verbindungsverlust:** Meldet sich der Server länger als `linkTimeout`, löst die Aktion aus `failsafe` aus. Im Testmodus geht dabei sofort alles aus.
5. **Testmodus:** nur entschärft und in `STOP`. Motor nur mit Totmann (alle 200 ms erneuert, 500 ms Ausfall = Stopp), höchstens 10 s am Stück. Pumpe höchstens 30 s. Der Testmodus endet bei: `testEnd`, Scharf schalten, NOT-AUS, Verbindungsverlust, 5 min ohne Bedienung.
6. **Grenzen im Boot durchsetzen:** `maxThrottle` und `cruiseSpeed` nie überschreiten, im Testmodus ist bis 100 % erlaubt.
7. **Geofence:** Verlässt das Boot den Radius um Home, handelt es selbst (offen, was).
8. **Fernsteuerung (RC):** Ein Zugriff des Senders auf Gas oder Ruder in `AUTO` soll die Kontrolle auf `MANUAL` übergeben (offen). Signalverlust des Senders löst ein definiertes Verhalten aus (heute fehlt es in der Firmware).
9. **Watchdog** auf dem Hauptloop, sodass ein Hänger den Motor nicht weiterlaufen lässt.
10. **Passwörter** (WLAN) nur verschlüsselt empfangen, im Flash (NVS) speichern und **nie** zurücksenden oder protokollieren.
11. **Strommessung:** `INA.setMaxCurrentShunt(maxA, 0.003)` muss zum echten Spitzenstrom passen. `src/MAIN` nutzt 10 A, `src/TEST` 25 A. Über `maxA` sind Strom, Leistung und mAh falsch.

## 10. Verbindung: WLAN und LTE

- Das Boot kann über **LTE** (Modem A7670E, UART) oder **WLAN** (ESP32, nur 2,4 GHz) mit dem Broker sprechen. `setNetMode`: `auto` (WLAN, wenn gespeichert und erreichbar, sonst LTE), `lte`, `wifi` (ohne Rückfall).
- `setWifi` speichert den Zugang erst nach einem **erfolgreichen** Verbindungsversuch (ca. 20 s). Schlägt er fehl, bleibt die bisherige Verbindung, und das Boot meldet `wifi_result` mit `ok: false`.
- Beim Wechsel baut das Boot die MQTT-Verbindung neu auf (kurze Lücke), meldet `net_switch` und setzt `link`.
- **Datenzähler:** Das Boot zählt gesendete und empfangene Bytes plus etwa 10 bis 30 % Zuschlag, nur wenn `link = lte`. Verbindlich ist die Anzeige des SIM-Anbieters. Ob der A7670E einen eigenen Zähler hat, steht im AT-Handbuch (nicht geprüft).
- Zeit: GPS-Zeit oder Netzzeit; ohne gültige Zeit sendet das Boot kein `t`, und der Server setzt den Empfangszeitpunkt.

## 11. Was das Dashboard selbst berechnet

Das muss das Boot **nicht** liefern:

- **Akku-Prozent:** linear aus `bat_v`, 13,6 V = 0 %, 16,8 V = 100 % (4S-LiPo angenommen, im Code `M.soc`).
- **Restlaufzeit:** (`battCap` − `bat_mah`) geteilt durch `bat_a`.
- **Distanz, Ankunftszeit, Abweichung zum Soll-Kurs, Strecke, Dauer.**
- **Alarme:** Verbindung weg, Leck, Akku, ESC-Temperatur, Innenraum, GPS-Fix, Funksignal, Geofence, NOT-AUS, LTE-Datengrenze. Sie ergeben sich aus der Telemetrie und den Schwellen in den Parametern.
- **Wirksames Tempo** aus `cruiseSpeed` und `maxThrottle` (14 km/h bei 100 % Gas angenommen, siehe 13).

## 12. Aufzeichnung (Fahrten)

- Eine **Fahrt** beginnt, wenn `mode` zu `AUTO` oder `RTH` wird, und endet bei `STOP` oder `ESTOP`. Fahrten unter 5 s werden verworfen.
- Aufgezeichnet wird **auf dem Server**, nicht im Browser, damit auch bei geschlossenem Dashboard nichts fehlt. Heute (Mockup) macht das Dashboard es im Browser.
- Gespeichert wird jeder Telemetrie-Messwert der Fahrt. Kennzahlen (Dauer, Strecke, Geschwindigkeiten, Energie, Extremwerte) rechnet der Server.
- Export: CSV (25 Spalten), GPX (Track mit Zeit, Geschwindigkeit, Kurs, Spannung, Strom, ESC-Temperatur), JSON (alles). Das Dashboard enthält die Formate bereits (`dashboard/js/recorder.js`).

## 13. Offene Punkte

1. **Backend:** Der Broker steht (Mosquitto, `deploy/`). Offen ist das Backend dahinter: Speicherung der Zeitreihen, Fahrten und Kurse auf dem Server, Befehle mit Verfallszeit, Benutzer und Anmeldung für das Dashboard, Anbindung des Dashboards (WebSocket oder REST).
2. **Vollgas-Geschwindigkeit:** Das Dashboard nimmt 14 km/h bei 100 % Gas an (für «wirksames Tempo»). Der echte Wert ist zu messen und sollte ein Parameter werden (`topSpeed`).
3. **Geofence-Aktion:** Was tut das Boot beim Verlassen: stoppen, Return Home oder nur warnen?
4. **Aktion bei kritischem Akku oder ESC:** `battCrit`, `escCrit`.
5. **«Position halten»:** Dein ESC fährt nur vorwärts; ein echtes Halten ist damit grob (Pulsen um den Punkt). Vorschlag: Option streichen.
6. **Datenmenge bei 100 ms:** rund 4,6 kB/s je 460-Byte-Nachricht, also etwa 400 MB pro Tag über LTE. Dafür Bündeln mehrerer Messwerte oder ein kompaktes Format prüfen.
7. **Anmeldung im Dashboard:** Heute ein Passwort per HTTP Basic Auth (Browser-Fenster, kein Abmelden, ohne Zweitfaktor). Gewünscht sind eine echte Login-Seite und ein Logout-Knopf. Mit echten Daten und Befehlen braucht es mehr (Zweitfaktor oder VPN). Optionen und Empfehlung: `docs/stand-und-naechste-schritte.md`, Abschnitt 4.
8. **Mehrere Boote:** Die Topics tragen schon eine Kennung. Der Stack kennt aber einen Boot-Benutzer und das Dashboard nur ein Boot.
9. **Zertifikat je Boot (mTLS)** statt Passwort im Flash, als spätere Verschärfung.
10. **TLS über das LTE-Modem:** Ob TLS auf dem A7670E (AT-Befehle) oder im ESP32 (über die Modem-Verbindung) läuft, ist nicht entschieden und nicht geprüft.
11. **Weg A oder B für MQTT** (TCP-Stream mit TLS im Proxy oder WebSocket über HTTPS). Weg B braucht in der Firmware einen MQTT-Client mit WebSocket-Unterstützung. Vor dem Bau der Firmware-Anbindung entscheiden.
