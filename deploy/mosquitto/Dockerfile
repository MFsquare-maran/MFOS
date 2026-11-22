FROM eclipse-mosquitto:2

USER root
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY mosquitto.conf.template acl.template ws.template /etc/mosquitto-tpl/
RUN chmod 0755 /usr/local/bin/entrypoint.sh && chmod 0644 /etc/mosquitto-tpl/*

# Laeuft NICHT als root (Benutzer mosquitto, UID 1883)
USER 1883
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
