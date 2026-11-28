# MFOS Firmware

PlatformIO-Projekt (Arduino-Framework) für den ESP32 im Boot. Der Vertrag mit dem Dashboard steht in `../docs/schnittstelle.md`.

## Bauen

```bash
pio run -d firmware -e MFOS_Main                 # Hauptfirmware (src/MAIN)
pio run -d firmware -e MFOS_test                 # Hardware-Selbsttest (src/TEST)
pio run -d firmware -e MFOS_Main -t upload       # aufspielen
pio device monitor -d firmware                   # serielle Ausgabe, 115200 Baud
```

Oder in VS Code den Ordner `firmware/` öffnen (PlatformIO-Erweiterung). Das Projekt wurde in diesem Repository nicht gebaut, weil PlatformIO auf dem Entwicklungsrechner nicht verfügbar war. Nach dem Verschieben in `firmware/` ist ein erster Build zu prüfen.

## Aufbau

```
firmware/
├── platformio.ini        zwei Environments: MFOS_Main und MFOS_test
├── include/pins.h        zentrale Pin-Belegung, EINE Stelle für alle GPIOs
├── lib/                  Treiber, je eine Klasse pro Ordner
│   ├── ADS1115/          NTC (ESC-Temperatur) + Leck-Sensor
│   ├── Actuators/        ESC und Ruder-Servo per LEDC-PWM (50 Hz, 1000–2000 µs)
│   ├── GPS/              u-blox M8N über TinyGPS++
│   ├── LSM9DS1Sensor/    IMU: Roll, Pitch, Kompass (Hard-Iron-Offsets fest im Code)
│   ├── Lights/           Lichtmodi 0–5 über den PCA9685
│   ├── PCA9685/          Treiber-Wrapper für den PWM-Baustein (Lichter, Pumpe)
│   ├── Pump/             Kühlpumpe (Kanal 4)
│   └── RC/               SBUS-Empfänger Radiolink R12DSM, 16 Kanäle
├── src/MAIN/main.cpp     Hauptfirmware
├── src/TEST/main.cpp     Selbsttest aller Komponenten, nur zum Prüfen gedacht
└── test/                 (leer)
```

Bibliotheken von aussen: Adafruit PWM Servo Driver, BMP280, ADS1X15, Unified Sensor, SparkFun LSM9DS1, robtillaart INA226, TinyGPSPlus.

## Hauptfirmware heute

- `setup()` startet alle Geräte und meldet OK oder FAIL über die serielle Schnittstelle.
- Zwei FreeRTOS-Tasks auf Core 0, Takt 10 ms:
  - `lightsTask` (Priorität 1): Lichter und ADS1115.
  - `controllerTask` (Priorität 10): Fernsteuerung, GPS, IMU lesen und **Gas und Ruder direkt vom Sender durchreichen**.
- `loop()` (Core 1) gibt jede Sekunde alle Messwerte aus und schaltet Pumpe und Licht über RC-Kanal 8 und 9.

## Was für die Schnittstelle noch fehlt

| Thema | Stand |
|---|---|
| LTE-Modem A7670E ansteuern (Pins sind definiert) | fehlt |
| WLAN, Umschaltung LTE ↔ WLAN, Zugangsdaten im Flash | fehlt |
| MQTT-Client über **TLS** zu `mfos.mfsquare.ch` (Port 8883 oder `wss` auf 443, siehe `../deploy/README.md`), Zertifikat gegen ein festgelegtes Wurzelzertifikat (Let's Encrypt, z. B. ISRG Root X1) prüfen, nie unsicher verbinden. Benutzername = Boots-Kennung, Last Will, Wiederverbinden. Dazu die richtige Uhrzeit vor dem Verbinden (GPS, Netzzeit oder NTP) | fehlt |
| Telemetrie, Befehle, Quittungen, Ereignisse (Nachrichtenformat in `../docs/schnittstelle.md`) | fehlt |
| Zustandsautomat mit scharf/nicht scharf, NOT-AUS, Modi | fehlt |
| Failsafe bei Funk- oder Verbindungsverlust | fehlt (Signalverlust des Senders wird nur ausgegeben) |
| Navigation: Wegpunkte, Return Home, Geofence, Tempo- und Gasgrenze | fehlt |
| Parameter und Kurs im Flash (NVS) | fehlt |
| Kühlpumpe automatisch nach ESC-Temperatur, Drehzahl | Pumpe nur ein/aus, Auto fehlt |
| mAh/Wh aufsummieren, Reset, im Flash sichern | fehlt |
| LTE-Datenzähler | fehlt |
| Testmodus mit Totmann-Motor | fehlt |
| Zeit (GPS oder Netzzeit) | fehlt |
| Watchdog | fehlt |
| Regler (Tempo, Kurs, Gierrate, Bahn), `setTune`, Tuning-Aufzeichnung (`docs/regler.md`, `docs/schnittstelle.md` 6a) | fehlt |
| **GPS-Rate des M8N auf 5 oder 10 Hz stellen** (`UBX-CFG-RATE`, Baudrate hoch mit `UBX-CFG-PRT`), echte Rate messen und melden (`docs/regler.md` 5a). Heute nur 9600 Baud, vermutlich 1 Hz | fehlt |
| Kurs mit Gyro stützen (Mischung Gyro und Kompass), heute nur Magnetometer; vorher Kompass-Prüfung bei Motorstrom (`docs/regler.md` 5a) | fehlt, Prüfung offen |

## Bekannte Auffälligkeiten

Beim Lesen der Hauptfirmware aufgefallen, nicht geprüft oder behoben:

1. **Beide Tasks** schreiben ihr Handle in `hLightsTask`, das des Licht-Tasks geht verloren.
2. **I2C Bus 2** wird von mehreren Stellen ohne Mutex benutzt (`lightsTask` mit ADS1115, `loop()` mit BMP280 und INA226).
3. **RC-Kanal 8 und 9** werden mit `> 0.0f` verglichen, die Werte reichen aber von 0 bis 100 %. Die Bedingung ist fast immer wahr; vermutlich ist eine Schwelle um 50 gemeint.
4. **Kein Failsafe:** `rc.hasSignal()` wird nur ausgegeben, `actuators.stop()` nie aufgerufen.
5. **UART-Konflikt:** `pins.h` legt das LTE-Modem auf UART1, `RcReceiver` nutzt standardmässig ebenfalls UART1. Der ESP32 hat drei UARTs (USB, GPS, SBUS), das Modem wäre die vierte.
6. **INA226:** `setMaxCurrentShunt(10.0, 0.003)` in der Hauptfirmware, 25 A im Selbsttest. Über 10 A ist die Messung falsch.
7. **Kommentare:** `platformio.ini` sagt, es werde ein pioarduino-Fork mit Arduino-Core 3.x genutzt, eingetragen ist aber `espressif32@6.5.0` (Core 2.x). Der Code unterstützt beide Versionen (`#if ESP_ARDUINO_VERSION_MAJOR >= 3`), nur der Kommentar passt nicht. In `main.cpp` stehen veraltete Texte («Licht-Task» bei beiden Tasks).
8. **IMU:** Deklination (Bern), Einbauwinkel und die Magnetometer-Offsets stehen fest im Code.

## Regeln für Änderungen

- Neue Pins nur in `include/pins.h`.
- Pro Gerät eine Klasse in `lib/<Name>/`, Aufrufe nicht blockierend (`update()` im Task).
- Alles, was das Boot bewegt (Gas, Ruder, Pumpe), geht durch eine Stelle, die `armed`, NOT-AUS und Grenzen prüft (sobald es sie gibt).
- Kommentare auf Deutsch, wie im bestehenden Code.
- Was das Dashboard erwartet, steht in `../docs/schnittstelle.md`. Ändert sich etwas, dort zuerst anpassen.
