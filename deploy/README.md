# Debian deployment bundle

These files do not activate the deployment. Production services require the
`production` profile; Certbot requires `certificate`. Do not enable workers or
start the production profile until migration gates in the operations runbook pass.
A worker-disabled process can still contact providers through HTTP routes: run
rehearsals with Docker `--network none` and disposable data, never this host network.

The source checkout belongs at `/srv/setpoint/source`. Persistent paths:

| Host path | Purpose |
| --- | --- |
| `/srv/setpoint/runtime.env` | Exact production secrets, mode 0600 |
| `/srv/setpoint/data/db/setpoint.db` | Consistent migrated database |
| `/srv/setpoint/data/notes` | Notes uploaded media |
| `/srv/setpoint/data/actual` | Actual cache |
| `/srv/setpoint/letsencrypt` | ACME account, certificate, renewal configuration |
| `/srv/setpoint/certbot-work` | Renewal lock and pending-reload marker |
| `/srv/setpoint/secrets/digitalocean.ini` | DNS token, mode 0600 |

Create data directories owned by UID/GID 1000 before mounting them. Compose
refuses to create missing host paths. It requires Compose 2.30+ for raw env files:
raw mode preserves `$` in existing secrets. Do not print `docker compose config`
with live secrets; use `config --quiet`. The container root filesystem is read-only.

The image builds the frontend and native dependencies on Linux. Node, Nginx and
Certbot images have registry manifest digest pins verified on 2026-09-18; review
and deliberately update these pins for security maintenance. No host ports are
published by Docker. Application traffic binds loopback; HTTPS binds only the
Tailscale IPv4 address. Nginx trusts no client-supplied forwarded address; Express
uses `TRUST_PROXY=loopback`. Nginx request logs omit URLs, queries and headers, and
its free-form error log is disabled because upstream errors can include tokens.
Startup/configuration failures remain visible through `nginx -t` and exit status.

## Validation without production activation

From the checkout:

```sh
SETPOINT_RUNTIME_ENV="$PWD/deploy/runtime.env.example" docker compose -f deploy/compose.yaml --profile production --profile certificate config --quiet
python3 deploy/test-ingress.py
docker build --platform linux/amd64 -t setpoint-selfhosted:local .
```

The ingress test uses disposable containers with no external network or published
ports, a generated test certificate and a synthetic echo upstream. It exercises
exact method/path restrictions, query/body/auth preservation, sanitized proxy
headers, body size limits, and secret-free logs. It does not prove production
Google delivery, a valid public certificate or host firewall access.

## Certificate issuance and renewal

Privately install a dedicated DigitalOcean API token in `digitalocean.ini` as
`dns_digitalocean_token = <token>`; do not paste the token into shell history.
The token needs domain read/create/delete permissions for DNS validation.
Do not reuse the application environment file for this token.

After directories and credentials have been prepared, issue the certificate from
`/srv/setpoint/source/deploy`, replacing the email placeholder:

```sh
docker compose --profile certificate run --rm certbot certonly --non-interactive --agree-tos --email OWNER_EMAIL --dns-digitalocean --dns-digitalocean-credentials /run/secrets/digitalocean.ini --dns-digitalocean-propagation-seconds 60 --cert-name setpoint.example.com -d setpoint.example.com
./renew-certificate.sh --dry-run
```

DNS validation works before changing the `ea` address record. Neither command
exposes an HTTP challenge listener or changes application DNS. Run with the
approved administrative account; do not change Docker membership for this bundle.

Install the supplied renewal service/timer only after issuance and dry-run pass.
The timer runs twice daily with jitter; it never reboots or starts application
services. Successful renewal marks a pending reload; the script validates Nginx
before reload and removes the marker only after success. A failed reload remains
pending for the next run. The dry run does not reload Nginx or touch its marker.
Certbot has no Docker socket access. Host `flock` serializes actual renewal runs.

The public Funnel must be separately configured for port 8443 and pointed at
`http://127.0.0.1:18765` only after the old PoC receiver has been stopped and the
real restricted proxy has passed checks. No script in this directory performs
that change, switches DNS, or starts/stops Render workers.
