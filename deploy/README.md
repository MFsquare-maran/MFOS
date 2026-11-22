# MFOS Server

Alles, was auf dem Server läuft, in **einem Docker-Compose-Stack**: ein MQTT-Broker (Mosquitto) für das Boot und ein passwortgeschützter Web-Server mit dem Dashboard. Der Stack läuft **hinter einem Reverse Proxy auf einem anderen Server** (zum Beispiel Nginx Proxy Manager) unter einer Domain wie `mfos.mfsquare.ch`. **TLS macht der Proxy**, dieser Stack enthält keine Zertifikate. Gedacht für Portainer (Stack aus dem Git-Repository).

```
Internet ──TLS──▶ Reverse Proxy (Server 1) ──Klartext, nur im LAN──▶ dieser Stack (Server 2)
                  mfos.mfsquare.ch                                   :8080 Dashboard, :1883 MQTT
```

> **Stand:** Der Stack wurde beim Schreiben **nicht gestartet**, weil auf dem Entwicklungsrechner kein Docker lief. Skripte, Konfiguration und Passwortprüfungen sind geprüft, der erste echte Start steht noch aus.

## Was läuft

| Container | Aufgabe | Interner Port | Ins Internet |
|---|---|---|---|
| `mfos-web` | Caddy: Passwortschutz, Sicherheits-Header, liefert das Dashboard aus, optional MQTT-WebSocket unter `/mqtt` | 8080 (HTTP) | nein, nur der Proxy im LAN |
| `mfos-mosquitto` | MQTT-Broker: Anmeldung Pflicht, Rechte pro Boot | 1883 (Klartext), 9001 (WebSocket, optional, nur intern) | nein, nur der Proxy im LAN |

Weil der Proxy auf einem **anderen Server** läuft, gibt es kein gemeinsames Docker-Netz. Der Stack veröffentlicht die Ports `8080` und `1883` deshalb **an der LAN-Adresse dieses Servers** (`WEB_BIND`, `MQTT_BIND`), und der Proxy spricht sie über diese Adresse an. Beide Variablen sind Pflicht, damit nicht versehentlich alle Netzwerkkarten offen sind.

**Die Strecke vom Proxy zu diesem Server ist unverschlüsselt** (HTTP, MQTT mit Passwort). Das ist in einem vertrauenswürdigen LAN in Ordnung, nicht über das Internet. Liegen die zwei Server nicht im selben geschützten Netz, brauchst du dazwischen ein VPN (WireGuard, Tailscale) und trägst dessen Adresse als `WEB_BIND` und `MQTT_BIND` ein.

## Einstellungen (Umgebungsvariablen)

Alles Einstellbare kommt aus Variablen (Vorlage `deploy/.env.example`). In der Compose-Datei steht nichts fest, auch keine Ports.

| Variable | Pflicht | Standard | Bedeutung |
|---|---|---|---|
| `DASHBOARD_USER` | ja | – | Benutzername für das Dashboard |
| `DASHBOARD_PASSWORD` | ja | – | Passwort für das Dashboard (mindestens 20 Zeichen) |
| `MQTT_BOAT_USER` | nein | `mfos-1` | Benutzername des Boots = Kennung (`mfos/<Name>/…`) |
| `MQTT_BOAT_PASSWORD` | ja | – | Passwort des Boots (mindestens 20 Zeichen) |
| `MQTT_BACKEND_USER` | nein | `mfos-backend` | Benutzername des späteren Backends |
| `MQTT_BACKEND_PASSWORD` | ja | – | Passwort des Backends (mindestens 20 Zeichen, anders als das des Boots) |
| `WEB_BIND` | ja | – | LAN-Adresse dieses Servers für das Dashboard (nie `0.0.0.0`) |
| `WEB_PORT` | nein | `8080` | Port des Dashboards auf diesem Server |
| `MQTT_BIND` | ja | – | LAN-Adresse dieses Servers für MQTT (nie `0.0.0.0`) |
| `MQTT_PORT` | nein | `1883` | MQTT-Port auf diesem Server |
| `DATA_DIR` | nein | `/serverdata/server/mfos-dashboard` | Datenordner auf dem Server (absoluter Pfad), siehe unten |
| `MQTT_WEBSOCKETS` | nein | `false` | MQTT über WebSocket unter `/mqtt` (siehe Weg B) |

`WEB_PORT` und `MQTT_PORT` sind die Ports **auf diesem Server**, unter denen der Proxy den Stack erreicht. Die Ports **innerhalb** der Container (8080, 1883, 9001) bleiben fest, sie sind von aussen nicht sichtbar. Ändere die Ports nur, wenn sie auf dem Server schon belegt sind, und trage dann im Proxy denselben Port ein.

## Datenordner

Alles, was dauerhaft gespeichert wird, liegt **in einem Ordner auf dem Server**, nicht in Docker-Volumes. Standard ist `/serverdata/server/mfos-dashboard`, einstellbar über `DATA_DIR`.

```
/serverdata/server/mfos-dashboard/
└── mosquitto/     Daten des MQTT-Brokers (gespeicherte Nachrichten, Sitzungen). Keine Passwörter.
```

- **Einmal von Hand anlegen** (auf dem Server, ersetze den Pfad, wenn du `DATA_DIR` geändert hast). Der Broker läuft nicht als Root und braucht Besitzrechte auf seinem Ordner:

```bash
sudo mkdir -p /serverdata/server/mfos-dashboard/mosquitto && sudo chown 1883:1883 /serverdata/server/mfos-dashboard/mosquitto && sudo chmod 700 /serverdata/server/mfos-dashboard/mosquitto
```

- Vergisst du das, legt Docker den Ordner als Root an, und `mfos-mosquitto` bricht mit der Meldung «Der Datenordner ist nicht beschreibbar» und genau diesem Befehl ab.
- Der Ordner muss auf **diesem Server** liegen (nicht auf einer Netzwerkfreigabe ohne Rechteverwaltung, der Broker braucht Besitzrechte).
- Bei späteren Erweiterungen (Backend) kommen weitere Unterordner dazu.
- Der Web-Server speichert nichts, er arbeitet im Arbeitsspeicher.
- **Sichern:** Diesen Ordner kopieren. Mehr ist nicht zu sichern.
- Ändert sich `DATA_DIR`, bleiben die alten Daten am alten Ort, der Broker startet am neuen leer. Kopiere sie bei Bedarf selbst um.

## Was dein Reverse Proxy tun muss

Weil hier nichts verschlüsselt, ist der Proxy dafür verantwortlich. Das sind die Pflichtpunkte:

1. **HTTPS mit gültigem Zertifikat** für `mfos.mfsquare.ch` (Let's Encrypt), HTTP wird auf HTTPS umgeleitet (*Force SSL*).
2. **Proxy Host** `mfos.mfsquare.ch` → Schema `http`, Weiterleiten an die **LAN-Adresse dieses Servers** (`WEB_BIND`), Port `8080`.
3. **Keine Access List des Proxys einschalten.** Das Dashboard hat sein eigenes Passwort (HTTP Basic Auth). Zwei Basic-Auth-Schichten nutzen denselben Header und blockieren sich gegenseitig.
4. **Die Verwaltungsoberfläche des Proxys nicht öffentlich** erreichbar machen (bei Nginx Proxy Manager Port 81).
5. **MQTT für das Boot verschlüsseln**, siehe nächster Abschnitt. Das ist der wichtigste Punkt.

## MQTT: wie das Boot sicher hineinkommt

Auf dem Weg vom Boot (LTE) zum Server laufen Benutzername und Passwort. Diese Strecke **muss verschlüsselt** sein. Mosquitto selbst spricht hier nur Klartext, also muss der Proxy die Verschlüsselung machen. Es gibt zwei Wege:

**Weg A: TCP-Stream mit TLS auf Port 8883** (der übliche MQTT-Weg)
- Im Proxy einen **Stream** anlegen: eingehend `8883` → weiter an `<MQTT_BIND>:1883` (LAN-Adresse dieses Servers), **mit dem Zertifikat von `mfos.mfsquare.ch`** (TLS im Proxy beenden).
- Bei Nginx Proxy Manager gibt es das nur, wenn der Stream ein Zertifikatsfeld hat. Das hängt von der Version ab. **Fehlt das Feld, ist ein Stream reines Weiterleiten ohne TLS, und das darf nicht ins Internet** (Passwörter im Klartext). Dann Weg B nehmen.
- Router: Port 8883 auf den Proxy weiterleiten.

**Weg B: MQTT über WebSocket auf der normalen HTTPS-Adresse**
- In den Variablen `MQTT_WEBSOCKETS=true` setzen. Dann reicht `mfos-web` den Broker unter `/mqtt` durch: Das Boot verbindet sich mit `wss://mfos.mfsquare.ch/mqtt` auf Port 443. Nichts weiter im Proxy nötig ausser: am Proxy Host **«Websockets Support»** einschalten.
- Vorteil: Alles geht durch den einen HTTPS-Eingang, kein zusätzlicher Port.
- Nachteil: Die **Firmware muss MQTT über WebSocket können**. Gängige Arduino-Bibliotheken wie PubSubClient können das nicht; der MQTT-Client von ESP-IDF kann `wss` (meines Wissens, vor der Entscheidung prüfen). Über das LTE-Modem per AT-Befehlen ist es wahrscheinlich nicht möglich.
- Dieser Weg ist **ungetestet**.

Ein **dritter Weg ist nicht erlaubt:** Port 1883 direkt ins Internet. Der Stack bindet ihn darum nur an die LAN-Adresse. Stelle `MQTT_BIND` nie auf `0.0.0.0`, und leite am Router **nie** 1883 oder 8080 auf diesen Server weiter.

Welcher Weg bei dir passt, hängt vom Proxy und von der Firmware ab. Entscheide das, **bevor** die Firmware ihren MQTT-Teil bekommt. Passt keiner, kann ich TLS wieder direkt in Mosquitto einbauen (eigene CA, Port 8883 ohne Proxy-Beteiligung).

## Einrichten

**1. LAN-Adresse dieses Servers bestimmen** (zum Beispiel `192.168.1.20`, am besten fest per Router oder Server-Einstellung, damit sie sich nicht ändert). Sie kommt als `WEB_BIND` und `MQTT_BIND` in die Variablen. **Firewall:** Auf diesem Server die Ports `8080` und `1883` **nur für die Adresse des Proxys** freigeben, zum Beispiel mit ufw:

```bash
sudo ufw allow from 192.168.1.10 to any port 8080,1883 proto tcp
```

(`192.168.1.10` ist hier die Adresse deines Proxys, ersetze sie.) Docker umgeht ufw bei veröffentlichten Ports teilweise. Prüfe deshalb zusätzlich von einem anderen Gerät im LAN, dass `8080` nicht erreichbar ist (Schritt 5).

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
| Environment variables | *Advanced mode*: den Inhalt von `deploy/.env.example` einfügen, die Passwörter aus Schritt 2 sowie `WEB_BIND` und `MQTT_BIND` (Schritt 1) eintragen |

Dann *Deploy the stack*. Beim ersten Mal baut Portainer die Bilder, das dauert ein paar Minuten. «Automatic updates» (GitOps) besser **ausgeschaltet** lassen: Sonst geht jeder Push auf `main` ungeprüft in den Betrieb.

Ohne Portainer: `deploy/.env.example` nach `deploy/.env` kopieren, ausfüllen und `docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build`.

**4. Proxy einrichten** (siehe oben): Proxy Host `mfos.mfsquare.ch` → `http://<WEB_BIND>:8080`, Zertifikat, *Force SSL*, keine Access List. Dazu den MQTT-Weg A oder B.

**5. Prüfen:**

- Beide Container stehen auf *healthy*. Im Datenordner liegen nach dem ersten Start Dateien von Mosquitto (`mosquitto.db`).
- Auf diesem Server: `curl -s -o /dev/null -w "%{http_code}\n" http://<WEB_BIND>:8080/` muss **401** liefern (Passwort verlangt), mit `-u admin:DEIN_PASSWORT` **200**.
- Vom **Proxy-Server** aus dieselbe Adresse aufrufen: Das muss funktionieren. Von einem **anderen** Gerät im LAN darf es **nicht** gehen (Firewall).
- `https://mfos.mfsquare.ch` fragt nach Benutzer und Passwort, ohne Anmeldung ist nichts zu sehen. `http://…` leitet auf HTTPS um.
- Von aussen (zum Beispiel per Handy-Netz) auf `mfos.mfsquare.ch:1883` und `:8080` darf **nichts** antworten.
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
| Stack, Firewall | Ports nur an der LAN-Adresse, in der Firewall nur für den Proxy offen, nie am Router weitergeleitet | Direkter Zugriff am Proxy vorbei |
| Stack | Sicherheits-Header (CSP, X-Frame-Options, Referrer-Policy, HSTS …) | Einschleusen von Skripten, Einbetten |
| Stack | Offizielle Basis-Bilder, Dependabot meldet wöchentlich neue Versionen | Veraltete, verwundbare Software |

## Grenzen, ehrlich gesagt

- **Proxy → Server ist unverschlüsselt.** Wer im selben LAN mitlesen kann, sieht Dashboard-Passwort und MQTT-Passwörter. Das LAN muss vertrauenswürdig sein, sonst VPN dazwischen.
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

- **Aktualisieren:** In Portainer *Pull and redeploy*. Die Bilder von `mosquitto` und `web` werden bei **jedem** Start oder Update des Stacks neu gebaut (`pull_policy: build`), samt frischem Basis-Bild. Du musst «Re-build» nicht extra einschalten. Vorher die Änderungen auf `main` ansehen. Das setzt ein aktuelles Docker Compose (Version 2) voraus; baut Portainer trotzdem nicht neu, im Stack-Editor *Re-pull image and redeploy* einschalten.
- **Passwort ändern:** Variable ändern, *Update the stack*. Beim Boot-Passwort danach die Firmware anpassen.
- **Sichern:** Den Datenordner (`DATA_DIR`) kopieren. Mehr hat der Stack nicht zu sichern, Zertifikate liegen beim Proxy.
- **Logs:** In Portainer je Container. Mosquitto protokolliert Verbindungen und Fehlversuche, keine Passwörter.
- **Fehlersuche:** Der Stack startet nicht → Container-Log lesen, die Meldung nennt die fehlerhafte Variable. Meldung «WEB_BIND fehlt» → die LAN-Adresse in den Variablen eintragen. Proxy zeigt «502» → ist `WEB_BIND:8080` vom Proxy-Server aus erreichbar (Firewall, richtige Adresse, Container healthy)? Boot verbindet nicht → Uhrzeit, Zertifikatskette, Port und Weg A oder B prüfen.

## Dateien

```
deploy/
├── docker-compose.yml     der Stack (mosquitto, web)
├── .env.example           Vorlage der Einstellungen (echte Werte nie ins Repository)
├── mosquitto/             Broker: Konfigurations- und Rechte-Vorlage, Startskript mit Passwortprüfung
├── web/                   Caddy: Caddyfile (Header, Passwortschutz, /mqtt), Startskript, Dashboard-Dateien
└── tools/                 gen-secrets.sh und .ps1 für starke Passwörter
```
