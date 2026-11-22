# MFOS

Ein **Modellboot mit Elektronik**, das autonom fahren kann: Man gibt ihm Koordinaten über das Netz, es fährt die Route ab und meldet dabei laufend Messwerte. Das Projekt besteht aus zwei Teilen:

- **Firmware** (`firmware/`) für den ESP32 im Boot: Sensoren, Antrieb, Ruder, Pumpe, Lichter, Fernsteuerung, später Navigation und Funkverbindung.
- **Dashboard** (`dashboard/`): Weboberfläche zum Planen, Überwachen und Steuern. Heute läuft sie mit **simulierten Daten** (Mockup), die Anbindung ans echte Boot fehlt noch.

```
   Fernsteuerung (Radiolink R12DSM, SBUS)
          │ Funk
          ▼
┌─────────────────────────┐   LTE (A7670E)   ┌───────────────┐   Browser   ┌───────────────┐
│ Boot: ESP32 + Sensoren  │ ───────────────▶ │ Broker/Server │ ──────────▶ │   Dashboard   │
│ Motor, Ruder, Pumpe,    │ ◀─────────────── │ (MQTT, offen) │ ◀────────── │ (dashboard/)  │
│ Lichter, GPS, IMU       │   oder WLAN      └───────────────┘             └───────────────┘
└─────────────────────────┘
   Firmware: firmware/            Vertrag: docs/schnittstelle.md
```

## Ordner

| Ordner / Datei | Inhalt |
|---|---|
| `firmware/` | PlatformIO-Projekt für den ESP32 (Hauptfirmware, Hardware-Selbsttest, Treiber). Siehe `firmware/README.md`. |
| `dashboard/` | Web-Dashboard ohne Build-Schritt (HTML, CSS, JavaScript). Siehe `dashboard/README.md`. |
| `docs/schnittstelle.md` | **Vertrag zwischen Boot und Dashboard**: was die Firmware senden und empfangen können muss. |
| `CLAUDE.md` | Arbeitsanweisungen für Claude Code in diesem Projekt. |
| `.claude/launch.json` | Startet das Dashboard in der Vorschau von Claude Code. |

## Hardware

Mikrocontroller: **LILYGO T-A7670G R2** (ESP32-WROVER-E mit LTE-Modem A7670E). Alle Pins stehen in `firmware/include/pins.h`.

| Teil | Anschluss |
|---|---|
| IMU LSM9DS1 (Lage, Kompass) | I2C Bus 1: SDA 19, SCL 23 |
| BMP280 (Druck, Innentemperatur), INA226 (Spannung, Strom), PCA9685 (Lichter, Pumpe), ADS1115 (ESC-Temperatur, Leck-Sensor) | I2C Bus 2: SDA 32, SCL 33 |
| GPS u-blox M8N | UART2: RX 21, TX 22 |
| LTE-Modem A7670E | TX 26, RX 27, PWRKEY 4 |
| Servo (Ruder) / ESC (Fahrtregler) | GPIO 18 / GPIO 25 |
| Fernsteuerung (SBUS) | GPIO 34 (nur Eingang) |
| PCA9685 Output-Enable | GPIO 5 |
| PCA9685-Kanäle | 0 Rot, 1 Grün, 2 Weiss 1, 3 Weiss 2 (beide am Mast), 4 Kühlpumpe |

## Schnellstart

**Dashboard ansehen** (Internet nötig für Karte und Diagramme):

```bash
python -m http.server 8765 --directory dashboard
```

Dann `http://localhost:8765` öffnen. Wenn du die Datei direkt per Doppelklick öffnest, kann der Browser einzelne Dateien sperren, darum der kleine Server.

**Firmware bauen** (PlatformIO nötig):

```bash
pio run -d firmware -e MFOS_Main      # Hauptfirmware
pio run -d firmware -e MFOS_test      # Hardware-Selbsttest
pio run -d firmware -e MFOS_Main -t upload
pio device monitor -d firmware
```

In VS Code den Ordner `firmware/` als PlatformIO-Projekt öffnen.

## Stand

| Bereich | Stand |
|---|---|
| Treiber (GPS, IMU, INA226, BMP280, ADS1115, PCA9685, Licht, Pumpe, SBUS, ESC, Servo) | vorhanden, im Selbsttest und in der Hauptfirmware angesprochen |
| Fahren per Fernsteuerung | Gas und Ruder werden vom Sender durchgereicht, **ohne Failsafe** |
| Funkverbindung (LTE, WLAN, MQTT) | **fehlt** |
| Navigation (Wegpunkte abfahren, Return Home, Geofence) | **fehlt** |
| Scharf schalten, NOT-AUS, Testmodus, Befehls-Verfall | **fehlt** in der Firmware, im Dashboard als Simulation fertig |
| Dashboard | fertig als Mockup: Live, Mission, Kurse, Telemetrie, Einstellungen, Tests, Replay, Status |
| Backend (Speicherung, Aufzeichnung, Anmeldung) | **fehlt**, Entscheidung offen |

## Sicherheit

Ein Modellboot mit Propeller kann verletzen. Grundsätze, die im Dashboard gezeigt und in der Firmware durchgesetzt werden müssen (Details in `docs/schnittstelle.md`, Abschnitt 9):

1. Nach dem Einschalten ist das Boot **nicht scharf**. Mission und Return Home sind gesperrt, bis jemand bewusst scharf schaltet.
2. **NOT-AUS** wirkt sofort. Die Freigabe verlangt eine Eingabe und lässt das Boot weiter entschärft.
3. Der **Testmodus** für Aktoren geht nur bei entschärftem, gestopptem Boot. Der Motor läuft nur, solange der Knopf gedrückt bleibt.
4. **Befehle verfallen**. Nach einem Verbindungsabbruch wird nichts nachgeholt.
5. Alle Grenzen gelten im Boot, nicht nur im Dashboard.

## Offene Entscheidungen

1. **Transport und Backend.** Der Transport ist **MQTT** (klein, passt zu LTE, Last Will, Wiederverbinden). Ob dahinter **ThingsBoard** oder ein **eigener Broker mit schlankem Backend** steht, ist offen. Meine Einschätzung heute: Weil das Dashboard eine eigene Oberfläche ist, nutzt man von ThingsBoard nur Broker, Datenbank und Schnittstelle, und das Wichtige muss man trotzdem selbst bauen: Fahrten-Aufzeichnung, Kursverwaltung, Downloads und vor allem Befehle mit Verfallszeit (ThingsBoard kann Befehle für ein Gerät aufbewahren und später ausführen, das wollen wir bei Antrieb und Start nicht). Der Totmann-Motortest braucht zudem einen schnellen eigenen Datenstrom. Deshalb würde ich **Mosquitto (oder EMQX) plus ein schlankes eigenes Backend** bevorzugen. Die Schnittstelle in `docs/schnittstelle.md` ist transportunabhängig, ThingsBoard bliebe über einen Adapter möglich.
2. **UART-Belegung.** Der ESP32 hat drei UARTs: USB-Debug, GPS und die Fernsteuerung. Das LTE-Modem braucht eine vierte. `pins.h` nennt für das Modem UART1, die SBUS-Klasse nutzt standardmässig ebenfalls UART1. Das muss vor der Modem-Anbindung gelöst werden (zum Beispiel GPS über eine Software-UART, 9600 Baud).
3. Weitere Punkte stehen in `docs/schnittstelle.md`, Abschnitt 13.
