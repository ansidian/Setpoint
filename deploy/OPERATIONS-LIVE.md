# Debian operations

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

## Development and releases

Use `/Users/andys/Documents/Projects/setpoint` and Node24. The fresh
checkout needs an independent `.env`, development encryption key and setup token
as described in OPERATIONS.md. `npm run dev` uses its local `server/db/ea.db`;
do not point it at Debian's live database. `npm run demo` needs no credentials.
`npm run build:demo` emits a fictional static site in `dist-demo`; local builds
do not publish. The public canonical repository is `ansidian/Setpoint`; the
retained private original is `ansidian/Setpoint-legacy`.

Successful `master` push CI triggers **Release production and demo**: GitHub
publishes the Linux app image to GHCR and separately deploys `dist-demo` to Pages.
Once the one-time host installation is complete, Debian checks every minute,
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
from the authoritative Actual server; full source history stays in private GitHub.
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

Actual disaster recovery requires its existing controlled `actual:hydrate-cache`
procedure with the restored owner ID before accepting finance operations. The
cutover copied a consistent live cache; routine backups intentionally omit it.

## Rollback after production writes

Render `srv-d71ltea4d50c73br0ft0` is suspended, auto-deploy off. Original Turso,
Render disk, credentials and migration exports remain for seven-day review.
**Never resume the original app against stale Turso after Debian has accepted writes.**

1. Stop Debian app with `docker compose --profile production stop app`. Keep
   Nginx/HA running. Capture its latest DB using the offline local-db snapshot
   command in a one-off container, plus Notes/runtime files. Do not copy a live
   main DB file while omitting its WAL.
2. Keep Render suspended while selecting this private fork and the matching
   release. Build `npm ci && npm run build`; remove the old `db:init` build step.
   Use production SQLite path `/var/data/actual/setpoint-recovery/db/setpoint.db`,
   preserve the exact root key, and set workers0. Remove Turso variables.
3. Set this maintenance-only start command before resuming/deploying Render:
   `node -e "require('http').createServer((q,s)=>{s.statusCode=503;s.end('Maintenance')}).listen(process.env.PORT||10000)"`
   It imports no application code or workers.
4. Verify disk space on Render's retained1GB mount. Transfer the latest consistent
   DB/Notes into NEW `setpoint-recovery` paths over verified SSH. Audit data/key
   and reconstruct Actual cache if needed. Set Notes/Actual paths accordingly.
5. Set webhook origin back to `https://setpoint.example.com`, restore `npm start` and
   workers1, then deploy. Debian must remain stopped. Restore the original DNS
   CNAME `ea-dashboard-hv9a.onrender.com` and original Gmail push configuration.
   Calendar channels reconcile against the restored origin. Queue catchup and
   repeat browser/provider checks.

Private original Pub/Sub config and final exports are under this Mac's
`~/.config/home-server/setpoint-migration`. Its endpoint can be restored with
`python3 /Users/andys/Documents/Projects/home-server/setpoint-migration/gmail-cutover.py rollback`.
Render SSH: `srv-d71ltea4d50c73br0ft0@ssh.oregon.render.com`; keep verified host keys.
If latest data is unavailable, report the backup timestamp before accepting any
data loss. Do not delete Render/Turso until seven successful days and restore
verification; review remaining disk/service billing before claiming full savings.
