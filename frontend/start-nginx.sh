#!/bin/sh
set -eu

: "${BACKEND_UPSTREAM:?BACKEND_UPSTREAM es obligatorio}"

# Usa los servidores DNS que Docker o Railway asignan al contenedor.
NGINX_RESOLVERS="$(awk '$1 == "nameserver" {
    if ($2 ~ /:/) printf "[%s] ", $2;
    else printf "%s ", $2;
}' /etc/resolv.conf)"
if [ -z "$NGINX_RESOLVERS" ]; then
    echo 'No se encontró un servidor DNS en /etc/resolv.conf' >&2
    exit 1
fi
export NGINX_RESOLVERS

envsubst '$BACKEND_UPSTREAM $NGINX_RESOLVERS' \
    < /etc/nginx/nginx.conf.template > /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
