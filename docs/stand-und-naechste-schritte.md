# Stand und nächste Schritte (Übergabe)

**Stand: 22.11.2026.** Diese Datei fasst zusammen, wo das Projekt steht, was entschieden ist, was noch offen ist und wie man morgen weitermacht. Sie ersetzt keine anderen Dokumente, sie verweist darauf.

## 1. Überblick

| Teil | Stand | Geprüft? |
|---|---|---|
| **Firmware** (`firmware/`) | Treiber für Sensoren, Antrieb, Ruder, Pumpe, Lichter, Fernsteuerung vorhanden. **Die Schnittstelle fehlt komplett** (kein LTE, WLAN, MQTT, scharf/NOT-AUS, Navigation, Failsafe). | Nie gebaut (kein PlatformIO) |
| **Dashboard** (`dashboard/`) | Als Mockup fertig: Live, Mission, Kurse, Telemetrie, Einstellungen, Tuning, Tests, Replay, Status. Alle Werte sind **simuliert**. | Im Browser durchgeklickt, keine Konsolenfehler |
| **Server-Stack** (`deploy/`) | Mosquitto und passwortgeschützter Web-Server als Docker-Compose-Stack für Portainer, hinter einem Reverse Proxy auf einem anderen Server. In Portainer deployt, Fehler wurden anhand der Logs behoben (siehe 3). | Skripte, YAML, Passwortprüfungen, erzeugte Konfiguration geprüft. **Der Start nach dem letzten Fix ist noch nicht bestätigt.** |
| **Backend** (Speicherung, Aufzeichnung, Kurse, Befehle mit Verfallszeit, Anmeldung) | **Fehlt.** | – |
| **Schnittstelle** (`docs/schnittstelle.md`) | Vertrag als Entwurf 0.1. | – |

Stand des Stacks vor dieser Übergabe: Commit `c480eb2` («Stack: Init-Container entfernt, Datenordner einmal von Hand anlegen»). Mit `git log` sieht man, was seitdem dazukam.

## 2. Server: Aufbau und Entscheidungen

```
Internet ──TLS──▶ Reverse Proxy (Server 1) ──Klartext, nur LAN──▶ Stack (Server 2, Portainer)
                  Nginx Proxy Manager                              mfos-web :WEB_PORT, mfos-mosquitto :MQTT_PORT
                  mfos.mfsquare.ch
```

**Entschieden:**
- Transport **MQTT**, Broker **Mosquitto**, **kein ThingsBoard** (Gründe in `README.md`, «Offene Entscheidungen»).
- **TLS macht der Reverse Proxy**, der Stack hat keine Zertifikate, kein Let's Encrypt, keine eigene CA. Domain: `mfos.mfsquare.ch`.
- Der Proxy läuft auf einem **anderen Server** als der Stack. Es gibt kein gemeinsames Docker-Netz. Der Stack veröffentlicht `8080` und `1883` an der LAN-Adresse von Server 2 (`WEB_BIND`, `MQTT_BIND`, Pflicht), die Strecke Proxy → Server 2 ist **unverschlüsselt** und nur im LAN gedacht.
- **Host-Ports** sind per Variable einstellbar. In Portainer gesetzt: `WEB_PORT=3333`, `MQTT_PORT=1885`. Die Ports innerhalb der Container (8080, 1883, 9001) bleiben fest.
- **Alle dauerhaften Daten** liegen als Bind-Mount in `DATA_DIR` (Standard `/serverdata/server/mfos-dashboard`), **keine benannten Docker-Volumes**. Den Unterordner `mosquitto` legt man **einmal von Hand** an (Befehl in `deploy/README.md`, Abschnitt «Datenordner»). Es gibt keinen Init-Container.
- Bilder von `mosquitto` und `web` werden bei jedem Start oder Update **neu gebaut** (`pull_policy: build`, `build.pull: true`).
- Passwörter: mindestens 20 Zeichen, die Container starten sonst nicht. Erzeugen mit `deploy/tools/gen-secrets.sh` oder `.ps1`.
- Der MQTT-Benutzername des Boots ist in Portainer `mfos` (Topics `mfos/mfos/…`). Das funktioniert. Hübscher wäre eine Kennung wie `boot-1`.
- Konkrete Werte (LAN-Adresse, Passwörter) stehen bewusst **nicht** im Repository, sondern nur in den Portainer-Variablen.

**Empfohlene Einstellungen im Proxy** (Nginx Proxy Manager):
- Proxy Host `mfos.mfsquare.ch`: Schema `http`, Weiterleiten an die LAN-Adresse von Server 2, Port `WEB_PORT`.
- **Keine Access List** (der Web-Server hat Basic Auth, zwei Schichten blockieren sich).
- Cache Assets **aus**. Gängige Exploits blockieren **an**. Websockets Support **aus, bis nötig** (Weg B oder späteres Backend).
- SSL: neues Zertifikat, Erzwinge SSL, HTTP/2, HSTS (auch Sub-domains) an, DNS Challenge aus. Port 80 muss für Let's Encrypt erreichbar sein.
- Verwaltungsoberfläche des Proxys (Port 81) nicht öffentlich.
- Firewall auf Server 2: `WEB_PORT` und `MQTT_PORT` nur für die Adresse des Proxys. Am Router nie weiterleiten.

## 3. Was beim ersten Deploy passiert ist (und gelernt wurde)

| Problem im Log | Ursache (meine Konfiguration) | Behoben in |
|---|---|---|
| `mfos-mosquitto`: «Address in use», Neustart-Schleife | `max_connections` stand **vor** dem ersten `listener`. Mosquitto legte einen zusätzlichen Standard-Listener auf 1883 an. | `d065dcc` |
| `mfos-web`: `mkdir /config/caddy: permission denied` | Die tmpfs-Verzeichnisse gehörten root, der Container läuft als 10001. | `fb887fb` |
| `mfos-web`: «HTTP/2 skipped» | Nur Warnungen, kein TLS im Container. | `fb887fb` |
| Altes Image blieb nach dem Fix im Einsatz | Portainer baute nicht neu. | `ae28a2a` (`pull_policy: build`) |
| Zusätzlicher gestoppter Container `mfos-init` | Einmal-Job zum Anlegen des Datenordners. | `c480eb2` (entfernt) |

Aus dem Log ersichtlich: Die Passwortprüfung greift, der Datenordner wird beschrieben («Restored 0 …»), und der Web-Server läuft (`serving initial configuration`). Regeln daraus stehen in `CLAUDE.md` (Abschnitt «Server»).

## 4. Offenes Thema: Login-Bildschirm und Logout-Knopf

**Frage des Besitzers:** Gibt es keinen echten Login-Bildschirm? Und es braucht einen Logout-Knopf.

**Stand heute:** Das Dashboard ist mit **HTTP Basic Auth** (Caddy) geschützt. Der Browser zeigt dafür ein **eingebautes Passwortfenster**, keine eigene Seite. Das hat Grenzen, die sich mit Basic Auth **nicht** beheben lassen:
- **Kein gestalteter Login-Bildschirm.** Das Fenster gehört dem Browser.
- **Kein echtes Abmelden.** Der Browser merkt sich die Zugangsdaten, bis er geschlossen wird. Der Server kann sie nicht zuverlässig löschen.
- Kein Zweitfaktor, keine Sperre nach Fehlversuchen (schon in `deploy/README.md` unter «Grenzen» genannt).

**Optionen:**

| Option | Login-Seite | Logout | Aufwand und Risiko |
|---|---|---|---|
| **A. Notbehelf:** Seite `/logout`, die 401 liefert | nein | unzuverlässig (Chrome und Firefox verhalten sich verschieden) | klein, aber schlechte Lösung |
| **B. Caddy-Plugin** (z. B. `caddy-security`) | ja, mit Sitzung | ja, auch Zweitfaktor möglich | Caddy muss selbst gebaut werden (nicht mehr das offizielle Bild), mehr Pflege |
| **C. Authelia** (eigener Login-Dienst vor Caddy, `forward_auth`) | ja | ja, mit Zweitfaktor und Sperre | ein weiterer Container, eigene Geheimnisse (Sitzungs-, Verschlüsselungsschlüssel), Datenbank |
| **D. Login im geplanten Backend** | ja, eigene Seite im Stil des Dashboards | ja, Knopf in der Leiste | Das Backend wird ohnehin gebraucht (Aufzeichnung, Kurse, Befehle). Mehr Bauaufwand, dafür alles an einer Stelle. |

**Empfehlung:** **D**, weil das Backend kommt und die Anmeldung dann mit Benutzern, Sitzung, Sperre nach Fehlversuchen und Zweitfaktor an einer Stelle liegt. Bis dahin bleibt Basic Auth (mit langem Zufallspasswort). Wer schnell eine echte Login-Seite will, nimmt **C**. **A** nur, wenn der Knopf sofort sein soll und die Schwäche bekannt ist.

**Anforderungen, egal welche Option** (für morgen):
- Sitzungs-Cookie mit `HttpOnly`, `Secure`, `SameSite=Strict`. «Secure» heisst: Der Proxy muss `X-Forwarded-Proto` durchreichen, und der Web-Server muss dem Proxy vertrauen.
- Abmelden macht die Sitzung **auf dem Server** ungültig, nicht nur im Browser.
- Sperre nach mehreren Fehlversuchen, kein Hinweis, ob Benutzer oder Passwort falsch war.
- Schutz vor Seitenfälschung (CSRF-Token oder `SameSite`).
- WebSocket-Verbindungen (spätere Live-Daten) brauchen dieselbe Anmeldung.
- Die Basic Auth entfällt dann, sonst gibt es zwei Abfragen. Die Access List des Proxys bleibt aus.
- Der Logout-Knopf kommt in die Leiste oben (neben Hell/Dunkel, Einheit). Im Mockup ohne Funktion, er braucht die echte Anmeldung.
- Die Anmeldeseite braucht keine Fremd-Skripte (die Content-Security-Policy in `deploy/web/Caddyfile` gilt weiter).

**Zu entscheiden morgen:** Welche Option (A bis D), und ob das Backend vorgezogen wird.

## 5. Offene Punkte, nach Wichtigkeit

1. **Deploy bestätigen.** In Portainer *Pull and redeploy*, dann prüfen (Liste in Abschnitt 6).
2. **MQTT-Verschlüsselung klären (Weg A oder B).** Weg A: Stream im Proxy mit TLS auf 8883 (geht nur, wenn dein Proxy Streams mit Zertifikat kann). Weg B: MQTT über WebSocket (`MQTT_WEBSOCKETS=true`, `wss://mfos.mfsquare.ch/mqtt`, setzt in der Firmware einen MQTT-Client mit WebSocket voraus). **Ohne eines von beiden darf das Boot nicht übers Internet verbinden**, sonst gehen Passwörter im Klartext.
3. **Login-Bildschirm und Logout** (Abschnitt 4).
4. **Backend:** Zeitreihen und Fahrten speichern, Kurse, Befehle mit Verfallszeit, Benutzer, Anbindung des Dashboards (WebSocket oder REST). Erst dann sollte das Dashboard mit echten Daten betrieben werden.
5. **Firmware:**
   - UART-Konflikt lösen (USB, GPS, SBUS, LTE-Modem brauchen vier, der ESP32 hat drei).
   - Zuerst einen Build prüfen (`pio run -d firmware -e MFOS_Main`).
   - Dann MQTT über TLS mit Zertifikatsprüfung, Uhrzeit vor dem Verbinden, Befehle und Quittungen, scharf/NOT-AUS, Failsafe, Navigation.
   - Details und bekannte Auffälligkeiten: `firmware/README.md`.
6. **Dashboard:** `js/state.js` durch die echte Datenquelle ersetzen (Anleitung in `dashboard/README.md`). Aufzeichnung auf den Server verlegen.
7. **Härtung später:** Zweitfaktor oder VPN fürs Dashboard, Bibliotheken selbst ausliefern (statt cdnjs), Zertifikat je Boot (mTLS), mehrere Boote.
8. **Seite «Tuning» für alle Regler (neu, 28.11.).** Zuerst klären, welche Regler das Boot braucht. Entwurf der Reglerliste (vier Regler eingeplant: Tempo, Kurs, Gierrate, Bahn; Kühlpumpe bleibt Ein/Aus) und die offenen Fragen dazu: `docs/regler.md`. **Erledigt:** Schnittstelle (`docs/schnittstelle.md` 6a) und Seite als Mockup (Sprungtests laufen gegen ein Platzhalter-Boot, im Browser geprüft: Senden mit Quittung, Grenzenprüfung, Abbruch bei NOT-AUS/Entschärfen/Seite verlassen, m/s, Handy). **Offen:** die Hardwarefragen in `docs/regler.md` Abschnitt 5, die echte Firmware (Regler, `setTune`, Tuning-Telemetrie) und das Messen der Kennlinie Gas → Tempo.
9. **Weitere Punkte der Schnittstelle:** `docs/schnittstelle.md`, Abschnitt 13 (Vollgas-Geschwindigkeit messen, Geofence-Aktion, kritischer Akku, «Position halten» streichen, Datenmenge bei 100 ms).

## 6. So geht es morgen weiter

**Prüfliste nach dem Deploy** (Werte durch deine ersetzen):
- In Portainer stehen `mfos-mosquitto` und `mfos-web` auf **healthy**. Der alte Container `mfos-init` ist gelöscht.
- Datenordner angelegt (einmal): `sudo mkdir -p /serverdata/server/mfos-dashboard/mosquitto && sudo chown 1883:1883 /serverdata/server/mfos-dashboard/mosquitto && sudo chmod 700 /serverdata/server/mfos-dashboard/mosquitto`.
- `curl -s -o /dev/null -w "%{http_code}\n" http://<LAN-ADRESSE>:3333/` liefert **401**, mit `-u admin:PASSWORT` **200**.
- MQTT im Container: `docker exec mfos-mosquitto mosquitto_pub -h 127.0.0.1 -p 1883 -u mfos -P '<BOOT-PASSWORT>' -t mfos/mfos/telemetry -m '{"t":0}'` ohne Fehler.
- `https://mfos.mfsquare.ch` fragt nach Benutzer und Passwort.
- Von aussen darf auf `WEB_PORT` und `MQTT_PORT` nichts antworten.

**Mitbringen, wenn etwas nicht klappt:** das Log des betroffenen Containers (`mfos-mosquitto` oder `mfos-web`).

**Für die Entscheidungen:** ob dein Proxy Streams mit Zertifikat kann (Weg A), und welche MQTT-Bibliothek die Firmware nutzen soll (davon hängt Weg B ab).

**Arbeitsweise:** Es wird nur committet und gepusht, wenn der Besitzer es sagt. Regeln und Konventionen: `CLAUDE.md`.

## 7. Wichtige Dateien

| Datei | Wofür |
|---|---|
| `README.md` | Überblick, Hardware, Stand, offene Entscheidungen |
| `CLAUDE.md` | Arbeitsregeln für Claude Code, Konventionen, Sicherheitsregeln |
| `docs/schnittstelle.md` | Vertrag Boot ↔ Dashboard (einzige Quelle der Wahrheit) |
| `docs/regler.md` | Entwurf: welche Regler das Boot braucht, Grundlage für die Seite «Tuning» |
| `deploy/README.md` | Server einrichten, Variablen, Proxy, Sicherheitsmodell, Betrieb |
| `deploy/docker-compose.yml`, `deploy/.env.example` | der Stack und seine Einstellungen |
| `firmware/README.md` | Firmware: Aufbau, was fehlt, Auffälligkeiten |
| `dashboard/README.md` | Dashboard: Ansichten, Weg zum echten Boot |
