#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
root="${SETPOINT_ROOT:-/srv/setpoint}"
# Serialise timer/manual invocations, including ACME staging dry runs.
exec 9>"${root}/certbot-work/renew.lock"
flock -n 9 || exit 0
case "${1:-}" in
  --dry-run)
    docker compose --profile certificate run --rm certbot renew \
      --cert-name setpoint.example.com --non-interactive --dry-run
    exit
    ;;
  '') ;;
  *) echo 'Usage: renew-certificate.sh [--dry-run]' >&2; exit 2 ;;
esac
docker compose --profile certificate run --rm certbot renew \
  --cert-name setpoint.example.com --non-interactive \
  --deploy-hook 'touch /var/lib/letsencrypt/reload-required'
# Persist the marker until validation AND reload succeed, including retry runs.
if [[ -f "${root}/certbot-work/reload-required" ]]; then
  docker compose --profile production exec -T nginx nginx -t
  docker compose --profile production exec -T nginx nginx -s reload
  rm -- "${root}/certbot-work/reload-required"
fi
