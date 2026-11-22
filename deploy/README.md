# MFOS Server

Alles, was auf dem Server läuft, in **einem Docker-Compose-Stack**: ein MQTT-Broker (Mosquitto) für das Boot und ein passwortgeschützter Web-Server mit dem Dashboard. Der Stack läuft **hinter einem Reverse Proxy** (zum Beispiel Nginx Proxy Manager) unter einer Domain wie `mfos.mfsquare.ch`. **TLS macht der Proxy**, dieser Stack enthält keine Zertifikate. Gedacht für Portainer (Stack aus dem Git-Repository).

> **Stand:** Der Stack wurde beim Schreiben **nicht gestartet**, weil auf dem Entwicklungsrechner kein Docker lief. Skripte, Konfiguration und Passwortprüfungen sind geprüft, der erste echte Start steht noch aus.

## Was läuft

| Container | Aufgabe | Interner Port | Ins Internet |
|---|---|---|---|
| `mfos-web` | Caddy: Passwortschutz, Sicherheits-Header, liefert das Dashboard aus, optional MQTT-WebSocket unter `/mqtt` | 8080 (HTTP) | nein, nur über den Proxy |
| `mfos-mosquitto` | MQTT-Broker: Anmeldung Pflicht, Rechte pro Boot | 1883 (Klartext), 9001 (WebSocket, optional) | nein, nur über den Proxy |

Beide Container hängen im Docker-Netz deines Proxys (`PROXY_NETWORK`). Der Stack veröffentlicht **keinen Port ins Internet**. Zusätzlich sind Ports auf `127.0.0.1` gebunden (`8080`, `1883`), falls dein Proxy auf demselben Rechner ausserhalb von Docker läuft.

## Was dein Reverse Proxy tun muss

Weil hier nichts verschlüsselt, ist der Proxy dafür verantwortlich. Das sind die Pflichtpunkte:

1. **HTTPS mit gültigem Zertifikat** für `mfos.mfsquare.ch` (Let's Encrypt), HTTP wird auf HTTPS umgeleitet (*Force SSL*).
2. **Proxy Host** `mfos.mfsquare.ch` → Schema `http`, Weiterleiten an Host `mfos-web`, Port `8080`.
3. **Keine Access List des Proxys einschalten.** Das Dashboard hat sein eigenes Passwort (HTTP Basic Auth). Zwei Basic-Auth-Schichten nutzen denselben Header und blockieren sich gegenseitig.
4. **Die Verwaltungsoberfläche des Proxys nicht öffentlich** erreichbar machen (bei Nginx Proxy Manager Port 81).
5. **MQTT für das Boot verschlüsseln**, siehe nächster Abschnitt. Das ist der wichtigste Punkt.

## MQTT: wie das Boot sicher hineinkommt

Auf dem Weg vom Boot (LTE) zum Server laufen Benutzername und Passwort. Diese Strecke **muss verschlüsselt** sein. Mosquitto selbst spricht hier nur Klartext, also muss der Proxy die Verschlüsselung machen. Es gibt zwei Wege:

**Weg A: TCP-Stream mit TLS auf Port 8883** (der übliche MQTT-Weg)
- Im Proxy einen **Stream** anlegen: eingehend `8883` → weiter an `mfos-mosquitto:1883`, **mit dem Zertifikat von `mfos.mfsquare.ch`** (TLS im Proxy beenden).
- Bei Nginx Proxy Manager gibt es das nur, wenn der Stream ein Zertifikatsfeld hat. Das hängt von der Version ab. **Fehlt das Feld, ist ein Stream reines Weiterleiten ohne TLS, und das darf nicht ins Internet** (Passwörter im Klartext). Dann Weg B nehmen.
- Router: Port 8883 auf den Proxy weiterleiten.

**Weg B: MQTT über WebSocket auf der normalen HTTPS-Adresse**
- In den Variablen `MQTT_WEBSOCKETS=true` setzen. Dann reicht `mfos-web` den Broker unter `/mqtt` durch: Das Boot verbindet sich mit `wss://mfos.mfsquare.ch/mqtt` auf Port 443. Nichts weiter im Proxy nötig ausser: am Proxy Host **«Websockets Support»** einschalten.
- Vorteil: Alles geht durch den einen HTTPS-Eingang, kein zusätzlicher Port.
- Nachteil: Die **Firmware muss MQTT über WebSocket können**. Gängige Arduino-Bibliotheken wie PubSubClient können das nicht; der MQTT-Client von ESP-IDF kann `wss` (meines Wissens, vor der Entscheidung prüfen). Über das LTE-Modem per AT-Befehlen ist es wahrscheinlich nicht möglich.
- Dieser Weg ist **ungetestet**.

Ein **dritter Weg ist nicht erlaubt:** Port 1883 direkt ins Internet. Der Stack bindet ihn darum nur an `127.0.0.1`. Stelle `MQTT_BIND` nie auf `0.0.0.0`, wenn der Server aus dem Internet erreichbar ist.

Welcher Weg bei dir passt, hängt vom Proxy und von der Firmware ab. Entscheide das, **bevor** die Firmware ihren MQTT-Teil bekommt. Passt keiner, kann ich TLS wieder direkt in Mosquitto einbauen (eigene CA, Port 8883 ohne Proxy-Beteiligung).

## Einrichten

**1. Docker-Netz des Proxys bestimmen.** Der Proxy und der Stack müssen im selben Docker-Netz hängen. Hat dein Proxy schon eines (zum Beispiel `proxy`), trage dessen Namen als `PROXY_NETWORK` ein. Sonst legst du eines an (`docker network create proxy`) und hängst den Proxy-Container daran. Ohne das Netz bricht das Starten mit einer Fehlermeldung ab.

**2. Passwörter erzeugen** (lokal, nirgends sonst hinschreiben):

```bash
sh deploy/tools/gen-secrets.sh                                          # Linux, Mac, Git Bash
powershell -ExecutionPolicy Bypass -File deploy\tools\gen-secrets.ps1   # Windows
```

**3. Stack in Portainer anlegen:** *Stacks → Add stack → Repository*

| Feld | Wert |
|---|---|
| Repository URL | `https://github.com/MFsquare-maran/MFOS` |
| Repository reference | `refs/heads/main` |
| Compose path | `deploy/docker-compose.yml` |
| Authentication | nur bei **privatem** Repository: GitHub-Token mit **nur Lesezugriff** auf den Inhalt (Fine-grained Token) |
| Environment variables | *Advanced mode*: den Inhalt von `deploy/.env.example` einfügen, die Passwörter aus Schritt 2 und `PROXY_NETWORK` eintragen |

Dann *Deploy the stack*. Beim ersten Mal baut Portainer die Bilder, das dauert ein paar Minuten. «Automatic updates» (GitOps) besser **ausgeschaltet** lassen: Sonst geht jeder Push auf `main` ungeprüft in den Betrieb.

Ohne Portainer: `deploy/.env.example` nach `deploy/.env` kopieren, ausfüllen und `docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build`.

**4. Proxy einrichten** (siehe oben): Proxy Host `mfos.mfsquare.ch` → `mfos-web:8080`, Zertifikat, *Force SSL*, keine Access List. Dazu den MQTT-Weg A oder B.

**5. Prüfen:**

- Beide Container stehen auf *healthy*.
- `https://mfos.mfsquare.ch` fragt nach Benutzer und Passwort, ohne Anmeldung ist nichts zu sehen. `http://…` leitet auf HTTPS um.
- Direkt von aussen auf `mfos.mfsquare.ch:1883` darf **nichts** antworten.
- MQTT-Test (Weg A, ersetze Passwort):

```bash
docker run --rm eclipse-mosquitto:2 \
  mosquitto_pub -h mfos.mfsquare.ch -p 8883 --capath /etc/ssl/certs \
  -u mfos-1 -P 'DEIN_BOOT_PASSWORT' -t mfos/mfos-1/telemetry -m '{"t":0}'
```

Das muss ohne Fehler durchlaufen. Mit falschem Passwort muss «not authorised» kommen. Meldet der Test «certificate verify failed», fehlt dem Test-Container nur das Wurzelzertifikat von Let's Encrypt (dann `--cafile` mit dem Wurzelzertifikat angeben), das ist kein Fehler des Stacks.

## Boot anbinden

Die Firmware braucht diese Werte (Aufbau der Nachrichten: `docs/schnittstelle.md`):

| Einstellung | Wert |
|---|---|
| Server | `mfos.mfsquare.ch` |
| Port / Weg | Weg A: `8883` mit TLS. Weg B: `443`, `wss`, Pfad `/mqtt` |
| Benutzername | `MQTT_BOAT_USER` (= Kennung des Boots) |
| Passwort | `MQTT_BOAT_PASSWORD` |
| Zertifikatsprüfung | Die Firmware **muss das Zertifikat prüfen**, nie «unsicher» verbinden. Das Zertifikat kommt von Let's Encrypt. Als Vertrauensanker bietet sich das Wurzelzertifikat **ISRG Root X1** an (lange gültig). Welche Kette dein Proxy ausliefert, vor dem Festlegen prüfen. |
| Uhrzeit | Die Zertifikatsprüfung braucht die richtige Zeit. Das Boot holt sie vor dem Verbinden (GPS, Netzzeit oder NTP). |
| Topics | schreiben: `mfos/<Benutzername>/telemetry`, `status`, `event`, `ack`; lesen: `mfos/<Benutzername>/cmd` |

Ein Boot kann nie ein anderes Boot lesen oder steuern.

## Sicherheitsmodell

| Wer | Maßnahme | Wogegen |
|---|---|---|
| **Proxy** | HTTPS mit echtem Zertifikat, Umleitung auf HTTPS | Mitlesen und Verändern im Netz |
| **Proxy** | TLS für MQTT (Weg A oder B), Verwaltungsoberfläche nicht öffentlich | Mitlesen von MQTT-Passwörtern |
| Stack | Dashboard hinter Passwort (mindestens 20 Zeichen, bcrypt-Hash), zusätzlich zum Proxy | Zugriff Unbefugter, falls der Proxy falsch eingestellt ist |
| Stack | `allow_anonymous false`, je Benutzer ein starkes Passwort (PBKDF2-Hash im Broker) | Fremde am Broker |
| Stack | **ACL pro Boot** (`mfos/<id>/…`) | Ein gestohlenes Boot-Passwort öffnet nichts anderes |
| Stack | Start verweigert bei schwachen, fehlenden oder Platzhalter-Passwörtern | Vergessene Standardwerte |
| Stack | Keine Passwörter in Git, Bildern oder Compose-Datei. `.env` ist ignoriert, das Klartext-Passwort wird im Web-Container nach dem Hashen entfernt | Geheimnisse im Repository |
| Stack | Container ohne Root, alle Rechte entzogen, `no-new-privileges`, schreibgeschütztes Dateisystem, Speicher- und Prozessgrenzen, kein Docker-Socket | Ausbruch bei einer Lücke |
| Stack | Keine Ports ins Internet, Klartext-Port nur im Docker-Netz und auf localhost | Direkter Zugriff am Proxy vorbei |
| Stack | Sicherheits-Header (CSP, X-Frame-Options, Referrer-Policy, HSTS …) | Einschleusen von Skripten, Einbetten |
| Stack | Offizielle Basis-Bilder, Dependabot meldet wöchentlich neue Versionen | Veraltete, verwundbare Software |

## Grenzen, ehrlich gesagt

- **Die Verschlüsselung hängt am Proxy.** Der Stack kann nicht prüfen, ob dein Proxy TLS wirklich für MQTT macht. Ein falsch eingestellter Stream (ohne TLS) schickt Passwörter im Klartext. Das unbedingt testen (zum Beispiel mit einem Paketmitschnitt oder indem ein Verbindungsversuch ohne TLS scheitern muss).
- **Kein Zweitfaktor, keine Sperre bei Fehlversuchen.** Die Anmeldung ist ein Passwort per HTTP Basic Auth. Gegen Raten hilft nur die Länge (32 zufällige Zeichen sind praktisch nicht zu erraten). Wer es besser will: das Dashboard nur per **VPN** (WireGuard, Tailscale) erreichbar machen, oder davor Authelia, CrowdSec oder Cloudflare Access setzen.
- **MQTT hat keine eingebaute Bremse für Raten.** Auch hier schützt die Passwortlänge. `max_connections` ist auf 100 begrenzt. Der Broker sieht nur die Adresse des Proxys, nicht die des Boots.
- **Das Boot-Passwort liegt im Flash der Firmware.** Wer das Boot in die Hand bekommt, kann es auslesen. Dann das Passwort in den Variablen ändern und neu starten.
- **Geheimnisse in Portainer:** Wer Portainer- oder Docker-Zugriff hat, sieht die Umgebungsvariablen. Portainer gut absichern (starkes Passwort, Zweitfaktor, nicht öffentlich).
- **Das Dashboard zeigt noch simulierte Daten** und ist nicht mit dem Broker verbunden. Ein Backend kommt als Nächstes.
- **Dashboard-Bibliotheken** (Leaflet, Chart.js) kommen von cdnjs. Besser wäre, sie selbst auszuliefern.
- **Server und Betriebssystem** (Updates, SSH, Firewall) liegen bei dir.
- **Ein Boot:** Der Stack kennt einen Boot-Benutzer. Mehrere Boote brauchen eine kleine Erweiterung.

## Betrieb

- **Aktualisieren:** In Portainer *Pull and redeploy* (baut neu). Vorher die Änderungen auf `main` ansehen.
- **Passwort ändern:** Variable ändern, *Update the stack*. Beim Boot-Passwort danach die Firmware anpassen.
- **Sichern:** Volume `mosquitto_data` (gespeicherte Nachrichten). Mehr hat der Stack nicht zu sichern, Zertifikate liegen beim Proxy.
- **Logs:** In Portainer je Container. Mosquitto protokolliert Verbindungen und Fehlversuche, keine Passwörter.
- **Fehlersuche:** Der Stack startet nicht → Container-Log lesen, die Meldung nennt die fehlerhafte Variable. Fehler «network proxy not found» → Docker-Netz anlegen oder `PROXY_NETWORK` korrigieren. Proxy zeigt «502» → heisst der Container wirklich `mfos-web`, und hängt der Proxy im selben Docker-Netz? Boot verbindet nicht → Uhrzeit, Zertifikatskette, Port und Weg A oder B prüfen.

## Dateien

```
deploy/
├── docker-compose.yml     der Stack (mosquitto, web)
├── .env.example           Vorlage der Einstellungen (echte Werte nie ins Repository)
├── mosquitto/             Broker: Konfigurations- und Rechte-Vorlage, Startskript mit Passwortprüfung
├── web/                   Caddy: Caddyfile (Header, Passwortschutz, /mqtt), Startskript, Dashboard-Dateien
└── tools/                 gen-secrets.sh und .ps1 für starke Passwörter
```
