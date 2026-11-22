# Web-Server hinter einem Reverse Proxy: Passwortschutz, Sicherheits-Header, Dashboard.
# HTTPS macht der Proxy. Build-Kontext ist der Projektordner (siehe docker-compose.yml: context: ..).
FROM caddy:2-alpine

COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY deploy/web/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY dashboard/ /srv/

RUN chmod 0755 /usr/local/bin/entrypoint.sh \
 && rm -f /srv/README.md \
 && chmod -R a+rX /srv

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
