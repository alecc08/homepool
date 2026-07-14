#!/bin/sh
set -e

# Only substitutes ${BACKEND_URL} — nginx variables ($host, $remote_addr…) are preserved
: "${BACKEND_URL:?La variable BACKEND_URL est requise}"
envsubst '${BACKEND_URL}' < /etc/nginx/templates/nginx.conf.template > /etc/nginx/conf.d/default.conf

exec nginx -g "daemon off;"
