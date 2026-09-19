# Debian operations

This public guide uses example domains and addresses. Resolve real endpoints
from the private server runbook at `/srv/infra/README.md`; do not publish that
inventory or copy these example values over live configuration.

Production switched on2026-09-18. App source release:
`df8c6872db5f10375d94eaf6ff6dac477429d133`; Linux image:
`sha256:0274b97d526119f9d0d6c89326d0898e4a980fb419acb2193586c58ab77ce8df`.
Later documentation-only commits do not change that image.

Private UI: `https://setpoint.example.com`, A100.64.0.10, TTL30, no AAAA.
Public webhook origin: `https://server.example-tailnet.ts.net:8443`.
The DigitalOcean apex and nameservers are independent and remain unchanged.
Only the exact Gmail/Calendar/Todoist POST routes are public. Todoist currently
uses personal-token mode; no OAuth developer webhook registration is required.

## Routine operation

From this Mac:

```sh
ssh admin@192.0.2.10
cd /srv/setpoint/source/deploy
docker compose --profile production ps
curl --fail http://127.0.0.1:3001/healthz
docker compose --profile production restart app
docker compose --profile production exec -T app npm run migration:catchup -- --apply
systemctl list-timers --all | grep setpoint
```

Catchup queues recovery in the existing worker; it does not start a second app.
Normal background startup is staggered for several minutes after a restart.
Never print `docker compose config` with live secrets. Use `config --quiet`.

Root operations require the owner's interactive sudo authentication:

```sh
sudo systemctl start setpoint-backup.service
sudo /srv/setpoint/source/deploy/renew-certificate.sh --dry-run
sudo systemctl start setpoint-certificate-renew.service
```

Certificate renewal timer runs twice daily; backup timer runs around04:30Pacific.
The native `setpoint-funnel-poc.service` must stay disabled. Nginx replaces it.
Tailscale retains netfilter-off/no accepted DNS/routes/no Tailscale SSH settings.

## Actual Budget on the same host

Actual moved from PikaPods to Debian on 2026-09-19 UTC. Its canonical URL remains
`https://actual.example.com`, now a DigitalOcean A record pointing to
`100.64.0.10` (TTL 120), accessible through Tailscale. The existing password and
budget/sync IDs were retained; no Setpoint connection reset is required for this
migration. Production data access from development machines also needs Tailscale.

- `/srv/actual/compose.yaml` owns the separately version-pinned Actual app;
  it binds only `127.0.0.1:5006`. Updating Setpoint does not update Actual.
- `/srv/actual/data` contains Actual's authoritative `server-files` and
  `user-files`. Preserve them together. `/srv/setpoint/data/actual` is only
  Setpoint's reconstructable SDK cache, not an Actual server backup.
- Setpoint's Nginx serves both private domains on `100.64.0.10:443`. The live
  `nginx.conf` includes `/etc/letsencrypt/actual-nginx.conf` inside `http`; the
  host file is `/srv/setpoint/letsencrypt/actual-nginx.conf`. Preserve this
  host-specific include when updating the base proxy configuration from Git.
  App-only automatic deployments leave it intact. Stopping Nginx affects both apps.
- Actual's certificate and DNS-01 configuration reuse Setpoint's protected
  certificate directory and DigitalOcean credential. Its separate
  `actual-certificate-renew.timer` shares the renewal lock and validates/reloads
  the same Nginx. Keep both applications' renewal timers enabled.
- `actual-backup.timer` runs daily around 04:45 Pacific, briefly stopping only
  Actual to produce a consistent encrypted archive. Temporary sync failures
  during that backup should recover once Actual returns. Seven archives remain
  in `/srv/actual/backups`; Mac LaunchAgent `tech.andysu.actual-backup-pull`
  retrieves hourly on the LAN and retains 30 in `~/Documents/Backups/Actual`.
  Both backup sets use the existing Mac-only age identity.

Read `/srv/actual/OPERATIONS.md` for Actual recovery and the host's current
configuration; its maintained Mac source is
`actual-migration/OPERATIONS.md` in the private home-server workspace.
Check health without issuing finance writes:

```sh
curl --fail https://actual.example.com/health
docker compose -f /srv/actual/compose.yaml ps
systemctl status actual-backup.timer actual-certificate-renew.timer
```

Actual migration verification included matching transfer hashes, SQLite integrity
checks, successful real-client sync, certificate renewal rehearsal, and an
off-host backup decrypted and booted in an isolated restore instance. PikaPods
was stopped at cutover; do not rely on its continued availability for recovery.

## Development and releases

Use the canonical Setpoint checkout and Node24. The fresh
checkout needs an independent `.env`, development encryption key and setup token
as described in OPERATIONS.md. `npm run dev` uses its local `server/db/ea.db`;
do not point it at Debian's live database. `npm run demo` needs no credentials.
`npm run build:demo` emits a fictional static site in `dist-demo`; local builds
do not publish. The public canonical repository is `ansidian/Setpoint`; the
retained private original is `ansidian/Setpoint-legacy`.

Successful `master` push CI triggers **Release production and demo**: GitHub
publishes the Linux app image to GHCR and separately deploys `dist-demo` to Pages.
Once the one-time host installation is complete, Debian checks every five minutes,
verifies the exact CI commit, rehearses startup on an isolated snapshot, makes a
fresh backup and replaces only the app. See [automatic releases](AUTOMATIC-DEPLOYMENT.md)
for installation, status, pause and recovery. The generated `compose.override.yaml`
pins the running image by digest. `production-release.txt` records the release.

Host scripts, Compose and Nginx configuration still require deliberate updates;
do not blindly sync the deployment folder over installed files or the image
override. If Nginx changes, validate with `docker compose --profile production
exec -T nginx nginx -t` before reloading. Code rollback does not undo migrations.

## Backups and isolated restore

Each backup is a **full**, consistent SQLite snapshot plus immutable Notes media,
runtime secrets, deployment scripts and certificate/DNS configuration, compressed
and age-encrypted. There is no incremental chain. Actual cache is reconstructed
from the authoritative Actual server. This archive does not include
`/srv/actual/data`: the separate Actual backup is required after loss of the host.
Full source history stays in GitHub.
Retain seven archives in `/srv/setpoint/backups`, 30 on this Mac. The first archive
was44MiB. Storage grows with database/media size.

Mac LaunchAgent: `tech.andysu.setpoint-backup-pull`, hourly while awake on the LAN.
Interpreter is pinned to Python3.12. Pull/status paths:

```sh
/Library/Frameworks/Python.framework/Versions/3.12/bin/python3 ~/.local/libexec/setpoint-backup-pull.py
cat ~/Documents/Backups/Setpoint/status.json
```

Local failures and backups older than48hours surface through status/logs and a
rate-limited macOS notification. Logs are in `~/Library/Logs/Setpoint`.
Keep `~/.config/home-server/setpoint-migration/backup-identity.txt` private and
preserve a separate owner-controlled copy for loss of this Mac. It never goes to
Debian or Git. An archive cannot be decrypted without it.

Example restoration of the first verified archive, on the Mac, into a NEW directory:

```sh
umask 077
export SETPOINT_RESTORE_DIR="$HOME/.config/home-server/setpoint-restore-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$SETPOINT_RESTORE_DIR"
age -d -i "$HOME/.config/home-server/setpoint-migration/backup-identity.txt" "$HOME/Documents/Backups/Setpoint/setpoint-20260918T223359Z.tar.gz.age" | tar -xzf - -C "$SETPOINT_RESTORE_DIR"
docker run --rm --platform linux/amd64 --network none --env-file "$SETPOINT_RESTORE_DIR/runtime.env" -e EA_BACKGROUND_WORKERS_ENABLED=0 -e NODE_ENV=production -e EA_DB_ADAPTER=sqlite -e EA_SQLITE_PATH=/data/db/setpoint.db -e EA_TLDRAW_ASSET_DIR=/data/notes -v "$SETPOINT_RESTORE_DIR:/data" setpoint-selfhosted:local node server/scripts/local-db.ts audit
```

Select the desired archive and rebuild/load its recorded image before future
restores. The database audit checks integrity, foreign keys, counts, credentials,
native vectors and referenced Notes assets. For a startup proof, use the same
network-none environment with `-e EA_BIND_HOST=127.0.0.1 -e PORT=3001` and the
normal image command; check health using `docker exec` within that container.
Do not publish ports or enable provider network access in the rehearsal.

After a host loss, restore the authoritative Actual server and verify its private
HTTPS/authentication before rebuilding Setpoint's cache. Cache reconstruction
uses the existing controlled `actual:hydrate-cache` procedure with the restored
owner ID before accepting finance operations. The Setpoint cutover copied a
consistent live cache; routine Setpoint backups intentionally omit it. Keep
Setpoint's finance workers paused until Actual and the rebuilt cache are ready.

## Recovery target

The owner intends to keep Setpoint on Debian and does not plan to restore it to
Render. The earlier Render rollback procedure is retired. Retained Render/Turso
resources are not required for the recovery plan; this documentation change does
not delete them or verify their billing status.

For application release failures, follow the reviewed recovery procedure in
[automatic releases](AUTOMATIC-DEPLOYMENT.md), preserving current data and checking
schema compatibility before any code rollback. For disk or host loss, use the
verified encrypted Setpoint and Actual backups described above to rebuild Debian.
Restore Actual before rehydrating Setpoint's cache and enabling finance workers.
Preserve the shared private HTTPS configuration and exact Setpoint encryption key.
If the latest data is unavailable, report the available backup timestamp before
accepting data loss. Do not reactivate a stale Turso database or make Actual public.
