#!/bin/sh
# Erzeugt starke, zufaellige Passwoerter fuer deploy/.env (Linux, Mac, Git Bash).
# Aufruf:  sh deploy/tools/gen-secrets.sh
# Die Ausgabe nur in die .env oder die Portainer-Variablen kopieren, sonst nirgends hin.
set -eu

rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-32}"; }

echo "# Zufaellige Passwoerter (je 32 Zeichen, nur Buchstaben und Ziffern):"
echo "DASHBOARD_PASSWORD=$(rand 32)"
echo "MQTT_BOAT_PASSWORD=$(rand 32)"
echo "MQTT_BACKEND_PASSWORD=$(rand 32)"
echo
echo "# Das Boot-Passwort kommt zusaetzlich in die Firmware, die anderen nirgends hin."
