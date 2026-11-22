#!/bin/sh
# Prueft die Zugangsdaten, bildet den bcrypt-Hash des Dashboard-Passworts und startet Caddy.
set -eu

fail() { echo "FEHLER: $*" >&2; exit 1; }

: "${DASHBOARD_USER:?DASHBOARD_USER fehlt}"
: "${DASHBOARD_PASSWORD:?DASHBOARD_PASSWORD fehlt}"

printf '%s' "$DASHBOARD_USER" | grep -Eq '^[A-Za-z0-9._-]{3,32}$' \
  || fail "DASHBOARD_USER muss 3 bis 32 Zeichen haben (Buchstaben, Ziffern, . _ -)"
[ "${#DASHBOARD_PASSWORD}" -ge 20 ] \
  || fail "DASHBOARD_PASSWORD ist zu kurz (mindestens 20 Zeichen). Erzeuge eines mit tools/gen-secrets.sh"
case "$DASHBOARD_PASSWORD" in
  *CHANGE_ME*|*change_me*|*changeme*|*password*|*passwort*) fail "DASHBOARD_PASSWORD ist noch ein Platzhalter" ;;
esac

# Nur der Hash bleibt im Prozess; das Klartext-Passwort wird entfernt.
DASHBOARD_HASH="$(caddy hash-password --plaintext "$DASHBOARD_PASSWORD")"
export DASHBOARD_HASH
unset DASHBOARD_PASSWORD

echo "Web-Server startet (Klartext hinter dem Reverse Proxy, Benutzer: $DASHBOARD_USER)"
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
