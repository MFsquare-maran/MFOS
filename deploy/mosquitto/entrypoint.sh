#!/bin/sh
# Startet Mosquitto: prueft die Zugangsdaten, erzeugt Passwort-Datei (nur Hashes),
# Rechte-Datei und Konfiguration im fluechtigen Speicher (/run/mosquitto).
set -eu

fail() { echo "FEHLER: $*" >&2; exit 1; }

check_user() {   # Name, Wert
  printf '%s' "$2" | grep -Eq '^[a-z0-9][a-z0-9-]{2,31}$' \
    || fail "$1 muss 3 bis 32 Zeichen haben (a-z, 0-9, -)"
}
check_pass() {   # Name, Wert
  [ "${#2}" -ge 20 ] || fail "$1 ist zu kurz (mindestens 20 Zeichen). Erzeuge ein starkes Passwort mit tools/gen-secrets.sh"
  case "$2" in
    *CHANGE_ME*|*change_me*|*changeme*|*password*|*passwort*) fail "$1 ist noch ein Platzhalter" ;;
  esac
}

: "${MQTT_BOAT_USER:?MQTT_BOAT_USER fehlt}"
: "${MQTT_BOAT_PASSWORD:?MQTT_BOAT_PASSWORD fehlt}"
: "${MQTT_BACKEND_USER:?MQTT_BACKEND_USER fehlt}"
: "${MQTT_BACKEND_PASSWORD:?MQTT_BACKEND_PASSWORD fehlt}"

check_user MQTT_BOAT_USER "$MQTT_BOAT_USER"
check_user MQTT_BACKEND_USER "$MQTT_BACKEND_USER"
check_pass MQTT_BOAT_PASSWORD "$MQTT_BOAT_PASSWORD"
check_pass MQTT_BACKEND_PASSWORD "$MQTT_BACKEND_PASSWORD"
case "${MQTT_WEBSOCKETS:-false}" in true|false) ;; *) fail "MQTT_WEBSOCKETS muss true oder false sein" ;; esac
[ "$MQTT_BOAT_USER" != "$MQTT_BACKEND_USER" ] || fail "Boot und Backend brauchen verschiedene Benutzernamen"
[ "$MQTT_BOAT_PASSWORD" != "$MQTT_BACKEND_PASSWORD" ] || fail "Boot und Backend brauchen verschiedene Passwoerter"
[ "$MQTT_BOAT_USER" != "mfos-health" ] && [ "$MQTT_BACKEND_USER" != "mfos-health" ] \
  || fail "Der Name mfos-health ist reserviert"

# Der Datenordner muss dem Benutzer 1883 gehoeren und beschreibbar sein. Legt Docker den Ordner selbst an,
# gehoert er root, dann kann der Broker nichts speichern.
[ -d /mosquitto/data ] && [ -w /mosquitto/data ] \
  || fail "Der Datenordner ist nicht beschreibbar. Auf dem Server EINMAL ausfuehren (DATA_DIR anpassen): sudo mkdir -p /serverdata/server/mfos-dashboard/mosquitto && sudo chown 1883:1883 /serverdata/server/mfos-dashboard/mosquitto && sudo chmod 700 /serverdata/server/mfos-dashboard/mosquitto"

RUN=/run/mosquitto
mkdir -p "$RUN"
umask 077

# Healthcheck-Passwort: zufaellig bei jedem Start, nur im fluechtigen Speicher
HEALTH_PASS="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40)"
printf '%s' "$HEALTH_PASS" > "$RUN/health.pass"

# Passwort-Datei: Mosquitto speichert nur Hashes (PBKDF2-SHA512)
mosquitto_passwd -c -b "$RUN/passwd" "$MQTT_BOAT_USER" "$MQTT_BOAT_PASSWORD" >/dev/null
mosquitto_passwd -b "$RUN/passwd" "$MQTT_BACKEND_USER" "$MQTT_BACKEND_PASSWORD" >/dev/null
mosquitto_passwd -b "$RUN/passwd" mfos-health "$HEALTH_PASS" >/dev/null
chmod 0600 "$RUN/passwd"

sed "s/__BACKEND_USER__/$MQTT_BACKEND_USER/g" /etc/mosquitto-tpl/acl.template > "$RUN/acl"
sed "s#__RUN__#$RUN#g" /etc/mosquitto-tpl/mosquitto.conf.template > "$RUN/mosquitto.conf"
case "${MQTT_WEBSOCKETS:-false}" in
  true)  cat /etc/mosquitto-tpl/ws.template >> "$RUN/mosquitto.conf"; WS_INFO="an (Port 9001, nur im Docker-Netz)" ;;
  false) WS_INFO="aus" ;;
  *)     fail "MQTT_WEBSOCKETS muss true oder false sein" ;;
esac
chmod 0600 "$RUN/acl" "$RUN/mosquitto.conf"

unset MQTT_BOAT_PASSWORD MQTT_BACKEND_PASSWORD HEALTH_PASS

echo "Mosquitto startet (Klartext, TLS macht der Proxy). Boot-Benutzer: $MQTT_BOAT_USER, Backend-Benutzer: $MQTT_BACKEND_USER, WebSocket: $WS_INFO"
exec mosquitto -c "$RUN/mosquitto.conf"
