# Regler und Tuning (Entwurf)

**Status:** Entwurf, 28.11.2026. Grundlage für die Dashboard-Seite «Tuning». Es gibt noch **keine Firmware** dafür; die Seite ist als **Mockup gebaut** (siehe Abschnitt 4). Dieses Dokument klärt zuerst, **welche Regler das Boot braucht**. Was aus dem vorhandenen Code folgt, steht in Abschnitt 1. Was Annahme ist, ist als «Annahme» oder «nicht geprüft» markiert und hängt an den offenen Fragen in Abschnitt 5.

## 1. Ausgangslage (aus dem Code)

- **Ein Antrieb:** ESC an GPIO 25, Signal 50 Hz, 1000 bis 2000 µs. Gas 0 bis 100 %. Die Konstante `THROTTLE_IDLE_PCT = 0` bedeutet laut Kommentar im Code «Vorwärts-only-Regler, 0 % = Stillstand». Es gibt also **keinen Rückwärtsgang und keine Bremse**.
- **Ein Ruder:** Servo an GPIO 18, gleiches Signal, 0 bis 100 %, **50 % = Mitte**. Die Endpunkte 1000 und 2000 µs sind fest im Code.
- **Lenken geht nur mit dem Ruder, Tempo nur mit Gas.** Es gibt keinen Querstrahl und keinen Differentialschub.
- **Keine Rückmeldung der Aktoren** (weder Ruderstellung noch Drehzahl). Die Regler arbeiten mit dem, was die Sensoren am Boot messen.
- **Sensoren:** GPS u-blox M8N (Position, Tempo über Grund, Kurs über Grund, Satelliten), IMU LSM9DS1 (Heading mit Neigungskorrektur, Gyro, Roll/Pitch), INA226 (Spannung, Strom), NTC am ESC, BMP280, Leck-Sensor.
- **Regeltakt:** Der Task `controllerTask` läuft heute alle 10 ms (100 Hz) und reicht nur Gas und Ruder vom Sender durch. Es gibt noch keinen Regler.
- **Dashboard-Simulation:** Dort lenkt ein reiner P-Regler (`Ruder = 50 + Kursfehler/40 · 50`), das Tempo ist eine einfache Abbildung von Gas. Das ist nur ein Mockup und keine Vorlage für die Firmware.
- **Heading-Filter heute:** Tiefpass mit festem Faktor 0,9 (etwa 100 ms bei 10 ms Takt), feste Magnetometer-Offsets, feste Deklination (Bern) und feste Einbaulage.
- **GPS-Rate:** Der Code stellt am Modul nichts ein, nur die Baudrate (9600). Die Aktualisierungsrate ist vermutlich die Werkseinstellung (1 Hz). **Nicht geprüft.** Laut Datenblatt kann der M8N mehr (5 bis 10 Hz, nicht geprüft); dafür braucht die Firmware einen UBX-Befehl und eine höhere Baudrate.
- **IMU im Detail (aus `lib/LSM9DS1Sensor`):** Gyro und Beschleunigung werden im Regeltakt (10 ms) gelesen; die Abtastrate des Gyros ist die Library-Voreinstellung (laut Datenblatt/Library vermutlich 952 Hz, **nicht geprüft**). Das Magnetometer läuft mit 40 Hz. Der **Kurs kommt nur vom Magnetometer** (neigungskompensiert, Tiefpass 0,9 je 10 ms, also etwa 0,1 s), **ohne Mischung mit dem Gyro**. Gyro-Bias wird beim Start bestimmt (Boot muss still liegen). Welche Chip-Achse beim Einbau die Gierachse ist, ist **nicht geprüft**.

## 2. Aufbau der Regelung

Zwischen Missionsplan und Aktoren liegen eine **Führung** (rechnet, kein Regler) und die **Regler**:

```
Missionsplan (Wegpunkte, Home, Ankunftsradius)
        │
        ▼
 FÜHRUNG  ──▶ Soll-Kurs ──▶ [2] Kurs-Regler ──▶ Soll-Gierrate ──▶ [3] Gierraten-Regler ──▶ Ruder (50 % = Mitte)
 (Linie zum    ▲                  ▲                                    ▲
  Wegpunkt,    │                  └── Heading (IMU)                    └── Gierrate (Gyro)
  Vorausschau) └── [4] Bahn-Regler (Querabweichung zur Linie)
        │
        └──▶ Soll-Tempo ──▶ [1] Tempo-Regler ──▶ Gas (0 bis maxThrottle)
                               ▲
                               └── Tempo über Grund (GPS)

 Kühlpumpe: bleibt Ein/Aus mit Hysterese (kein Regler)
 Strombegrenzer: Strom (INA226) ──▶ begrenzt Gas
```

## 3. Die Regler

### A. Eingeplant (PID)

Vier Regler. Drei davon bilden eine **Kaskade** (Bahn-Regler ganz aussen, dann Kurs-Regler, dann Gierraten-Regler innen), der vierte regelt das Tempo:

| Nr. | Regler | Soll | Ist | Ausgang | Takt | Art |
|---|---|---|---|---|---|---|
| 1 | **Tempo-Regler** | `cruiseSpeed` (km/h, begrenzt durch `maxThrottle`) | GPS-Tempo über Grund | Gas 0 bis `maxThrottle` | 5 Hz bis 10 Hz | PI mit Vorsteuerung |
| 2 | **Kurs-Regler** (mittlerer Kreis) | Soll-Kurs (Kurs der Linie plus Korrektur des Bahn-Reglers) | Heading (IMU), in Fahrt mit GPS-Kurs abgeglichen | **Soll-Gierrate** in °/s | 20 Hz bis 50 Hz | P, kleines I |
| 3 | **Gierraten-Regler** (innerer Kreis) | Soll-Gierrate aus dem Kurs-Regler | Gierrate (Gyro Z) | Ruder 0 bis 100 % (50 = Mitte) | 50 Hz bis 100 Hz | PI, ggf. D |
| 4 | **Bahn-Regler** (äusserster Kreis, Kursabweichung zur Linie) | Querabweichung 0 m (Boot genau auf der Linie) | Querabweichung zur Linie zwischen den Punkten, aus der GPS-Position | **Kurs-Korrektur** in Grad, wird zum Kurs der Linie addiert | 1 Hz bis 5 Hz (GPS) | P, I |

- **Tempo-Regler:** Ohne Vorsteuerung (gemessene Kennlinie «Gas ↔ Tempo») arbeitet er sehr träge. Das Gas darf nie negativ werden (ESC nur vorwärts), also braucht er **Anti-Windup** und eine **Anlauframpe**. Das Boot hat zudem viel Trägheit, deshalb ist er langsam. Mit 1 Hz GPS wird die Regelung grob (im Dashboard-Simulator mit der Auswahl «GPS-Rate» ausprobierbar: bei 1 Hz überschwingt der Tempo-Sprung deutlich stärker als bei 5 oder 10 Hz).
- **Kurs-Regler:** Der Fehler wird auf −180 bis +180° umgebrochen. Der Ausgang (Soll-Gierrate) ist auf eine **maximale Drehrate** begrenzt, das bestimmt, wie hart das Boot eindreht. Die Dämpfung kommt vom inneren Kreis.
- **Gierraten-Regler:** Die **Gierrate** ist, wie schnell sich das Boot dreht (Grad pro Sekunde), der Gyro misst sie direkt. Der Regler stellt das Ruder so, dass die gemessene Drehung zur Vorgabe passt. Das reagiert schnell und verhindert, dass das Boot über das Ziel hinausschiesst und **schlängelt**. Der Ausgang ist auf den maximalen Ruderausschlag begrenzt. Das Gyro-Rauschen wird gefiltert. Der Gyro wird beim Start kalibriert (das macht `imu.begin` schon, das Boot muss dabei stillstehen).
- **Vorschlag für den Anfang:** Der innere Kreis lässt sich auf der Tuning-Seite **ausschalten**. Dann stellt der Kurs-Regler (mit einem D-Anteil aus dem Gyro) das Ruder direkt. So kann man erst den einfachen Fall abstimmen und den inneren Kreis danach dazuschalten.

- **Bahn-Regler:** Er misst, wie weit das Boot **seitlich** von der Linie zwischen den zwei Wegpunkten liegt (Querabweichung), und dreht den Soll-Kurs ein Stück zur Linie hin. So folgt das Boot der Linie selbst bei Wind und Strömung, statt nur auf den nächsten Punkt zuzufahren und dabei seitlich abzutreiben. Der **I-Anteil** gleicht dauernden Seitwind oder Strömung aus. Die Korrektur ist auf eine **maximale Kurs-Korrektur** begrenzt (zum Beispiel ±45°), damit das Boot nie quer zur Linie läuft. Besonderheiten:
  - Die Linie läuft vom **vorigen Wegpunkt** zum nächsten. Bei der ersten Strecke und bei Return Home ist der Anfang die Position, an der das Boot gerade war.
  - Beim **Wechsel zum nächsten Wegpunkt** (Ankunftsradius erreicht) ändert sich die Linie. Der I-Anteil wird dann zurückgesetzt oder eingefroren, sonst zieht er das Boot in die falsche Richtung.
  - Er ist an die **GPS-Rate** gebunden (1 Hz bis 5 Hz) und der langsamste Kreis der Kaskade. Mit 1 Hz GPS wird er grob.

### B. Kein PID, aber Tuning-Werte (gehören auf dieselbe Seite)

| Gruppe | Werte |
|---|---|
| **Ruder** (keine Rückmeldung, also reine Einstellung) | Mitte (Trimm), Endpunkte in µs, maximaler Ausschlag, Stellgeschwindigkeit (Slew), Richtung umkehren, Totbereich |
| **Gas / ESC** | Gas-Rampe (Anstieg, Abfall), Totband, Anlaufschwelle (kleinstes Gas, bei dem das Boot fährt), PWM-Grenzen, **Kennlinie Gas → Tempo** (Stützpunkte) für die Vorsteuerung |
| **Annäherung und Kurven** | Tempo-Reduktion in Kurven (Faktor, Kursfehler ab dem reduziert wird), Verlangsamen vor dem Wegpunkt (Distanz, Faktor), Vorausschau-Distanz |
| **Filter** | Heading-Tiefpass (heute fest 0,9), Mischung Gyro und Kompass, ab welchem Tempo der GPS-Kurs einfliesst, GPS-Tempo-Filter |
| **Strombegrenzung** | Gas begrenzen, wenn der Strom (INA226) eine Grenze übersteigt, als Schutz von Akku und ESC |

### C. Bewusst kein Regler

- **Kühlpumpe:** Sie bleibt **Ein/Aus mit Hysterese** (Bang-Bang): ein ab `pumpOn`, aus unter `pumpOff`, mit der eingestellten Drehzahl. Entschieden, es gibt keinen Pumpen-Regler.

### D. Nicht nötig bei dieser Hardware

- **Position halten** (2D-Positionsregler): Der ESC fährt nur vorwärts. Das Boot würde um den Punkt kreisen. Die Option steht auch bei den offenen Punkten zum Streichen.
- **Roll- und Pitch-Stabilisierung:** Es gibt keine Aktoren dafür.
- **Differentialschub oder Querstrahl:** nicht vorhanden.

**Handbetrieb mit Hilfen** (später möglich, nicht eingeplant): «Kurs halten» und «Tempo halten» im Handbetrieb nutzen dieselben Regler 1 bis 3.

## 4. Die Seite «Tuning» im Dashboard (als Mockup gebaut, 28.11.2026)

**Gebaut:** vier Reglerkarten mit Entwurf/aktiv, «Senden» mit Quittung, «Verwerfen», «Standardwerte», Sprungtest (Tempo, Kurs, Gierrate, Bahn) mit Diagramm (Soll, Ist, Ausgang, P/I/D/Vorsteuerung) und Kennzahlen, «Letzter guter Satz», Profile (Browser), Export/Import als JSON, Tuning-Werte für Ruder, Gas, Annäherung, Filter, Strom. Der Sprungtest läuft im Mockup gegen ein **Platzhalter-Boot** (`dashboard/js/tune-sim.js`, einfache Modelle, nicht gemessen), nur im **Tuning-Modus** (`TUNE`) bei scharfem Boot (ohne Mission) und mit dem **gesendeten** Satz. Nicht im Simulator wirksam (in der Oberfläche markiert): Impulsbreiten, Richtung umkehren, Kompass-Anteil, Kurvenreduktion, Verlangsamen vor dem Wegpunkt, Strombegrenzung. Den Entwurf unten lesen wie ursprünglich geplant.

Pro Regler eine Karte (Tempo, Kurs, Gierrate, Bahn) mit einem Schalter **«Gierraten-Regler an/aus»** (siehe Vorschlag in Abschnitt 3). Jede Karte enthält:

- **Werten:** Kp, Ki, Kd, Ausgangsgrenzen, Grenze des I-Anteils (Anti-Windup), Filter für den D-Anteil, Totbereich, Vorsteuerung. Senden mit Quittung, «Standardwerte», «Letzter guter Satz» wiederherstellen.
- **Live-Diagramm:** Soll, Ist, Ausgang und die **Anteile P, I und D** einzeln. Die Daten kommen **nicht live**: Das Boot zeichnet den Sprungtest selbst auf (eigene Zeitstempel, Regeltakt) und schickt den Verlauf danach (`docs/schnittstelle.md` 6a).
- **Sprungantwort:** Knöpfe wie «Kurssprung +20°» oder «Tempo +1 km/h» mit Aufzeichnung der Antwort und Kennzahlen (Anstiegszeit, Überschwingen, Beruhigungszeit, bleibende Abweichung).
- **Profile** («ruhiges Wasser», «Wind»), Speichern und Laden, Export als JSON.

**Sicherheit (Pflicht, gilt im Boot):**
- Das Boot prüft **Grenzen für jeden Wert** (zum Beispiel höchstens ein sinnvolles Kp) und lehnt Werte ausserhalb ab.
- Neue Werte wirken erst nach der Quittung und **weich** (kein Sprung im Ausgang).
- Ein Sprungtest läuft nur bei **scharfem Boot** und mit sichtbarem NOT-AUS, und er bricht bei Verlassen der Seite, bei Verbindungsverlust und bei NOT-AUS ab.
- Die letzten guten Werte bleiben im Boot gespeichert, ein Neustart nimmt nie ungeprüfte Werte.

**Schnittstelle (kommt nach `docs/schnittstelle.md`, sobald die Reglerliste feststeht):** Parameter `pid.<regler>.kp|ki|kd|…`, Befehle `setPid` und `tuneStart`/`tuneStop`/`tuneStep`, Aufzeichnung im Boot mit Upload auf `mfos/<id>/tune` (Soll, Ist roh und gefiltert, Ausgang, P, I, D, Gyro, Kurs, GPS-Tempo). Das ist inzwischen in `docs/schnittstelle.md` 6a festgeschrieben. Die Schnittstelle kennt heute `cruiseSpeed` und `maxThrottle`, die der Tempo-Regler weiterverwendet. Die dort angenommenen 14 km/h bei Vollgas würde die gemessene Kennlinie ersetzen.

## 5. Offene Fragen (davon hängt die Liste ab)

1. **Antrieb und Lenkung:** Normaler Propeller mit Ruderblatt, oder Jet mit Düse? Wie gross ist der Ruderausschlag, und wie enge Kurven fährt das Boot?
2. **ESC:** Hat er wirklich keinen Rückwärtsgang und keine Bremse? Regelt er die Drehzahl selbst (Governor-Modus)? Das ändert den Tempo-Regler.
3. **Boot:** Rumpfform (Verdränger oder Gleiter), Länge, Höchsttempo. Wie genau soll es der Route folgen (zum Beispiel innerhalb 2 m)? Das legt fest, wie scharf der **Bahn-Regler (4)** eingestellt wird (Vorausschau, Grenze der Kurs-Korrektur).
4. **GPS-Rate:** Darf die Firmware den M8N auf 5 oder 10 Hz stellen? Tempo- und Bahnregelung profitieren stark davon. Heute vermutlich 1 Hz (nicht geprüft). **Aufgabe für die Firmware, siehe Abschnitt 5a.**
5. **Kompass im Betrieb:** Die Magnetometer-Offsets sind fest eingetragen. Stört der Motorstrom das Heading? Gibt es eine Messung, wie sich der Kompass im Fahrbetrieb verhält? **Prüfablauf: Abschnitt 5a.**
6. **Handbetrieb mit Hilfen** («Kurs halten», «Tempo halten»): ja oder nein?
7. **Wie wird getunt:** nur auf dem Wasser mit Sprungantwort, oder auch eine automatische Einstellung (Auto-Tuning) gewünscht?

## 5a. Prüfungen und Aufgaben vor dem Tuning (Hardware)

**Kompass-Prüfung (Motorstrom):** Der Kurs kommt nur vom Magnetometer. Der Strom von Motor und ESC (bis etwa 30 A) kann es je nach Gas verschieben. Das Magnetometer-Offset im Chip deckt nur den festen Anteil ab (Hard-Iron).

1. Boot **gesichert** (Propeller frei, Boot festgehalten oder fest montiert), Testmodus an (Seite «Tests»), Boot flach und still, nicht bewegen.
2. Kurs (`heading`) bei Gas 0 % notieren (30 s mitteln).
3. Gas in Stufen erhöhen (10, 20, 40, 70, 100 %, je 10 s, **Totmann, höchstens 10 s am Stück**), den Kurs bei jeder Stufe mitteln, danach wieder Gas 0 % und Kurs prüfen.
4. Auswertung: Änderung des Kurses je Stufe in Grad. Richtwert (Annahme, nicht gemessen): unter 2° ist unkritisch, über 5° bei Reisegas ist für den Kurs-Regler ein Problem.
5. Ist sie zu gross: Magnetometer weiter weg vom Motor und von den Stromleitungen montieren, Leitungen verdrillen, oder den Kurs mit dem Gyro stützen (Mischung Gyro und Kompass, siehe Tuning-Wert «Kompass-Anteil», **in der Firmware noch nicht umgesetzt**).
6. Dazu einmal prüfen: Dreht sich der Kurs im Uhrzeigersinn, wenn das Boot nach rechts dreht? Welche Gyro-Achse ist die Gierachse?

**GPS-Rate (Aufgabe für die Firmware, noch nicht umgesetzt):** Beim Start per UBX-Befehl die Messrate des M8N auf 5 oder 10 Hz stellen (`UBX-CFG-RATE`) und dafür die Baudrate erhöhen (z. B. 38400 oder 115200, `UBX-CFG-PRT`); nur die nötigen NMEA-Sätze lassen. Danach die echte Rate messen und als `gps_hz` melden (Vorschlag, noch nicht im Vertrag). Ohne diese Änderung hat das Tempo-Tuning nur wenige Messpunkte im Anstieg. Bis dahin steht der Simulator auf 1 Hz.

## 6. Nächste Schritte

1. Fragen in Abschnitt 5 beantworten, Prüfungen aus Abschnitt 5a durchführen, danach die Reglerliste festschreiben.
2. Parameter, Befehle und Telemetrie in `docs/schnittstelle.md` eintragen.
3. ~~Seite «Tuning» im Dashboard als Mockup bauen~~ (erledigt). Danach: Hardwarefragen klären, dann die Firmware.
