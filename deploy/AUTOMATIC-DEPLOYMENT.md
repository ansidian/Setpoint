# Automatic releases

Push to `master` in public `ansidian/Setpoint`. The existing pre-push hook runs
`npm run verify`; GitHub CI repeats verification and tests the deployment guards.
Only a **successful push CI run** on canonical `master` can trigger
`Release production and demo`. PRs, forks, failed/cancelled CI and superseded
commits cannot publish a release. Each build checks out the CI run's exact SHA.

## Production

GitHub builds a Linux AMD64 image, tests startup with disposable data and no
network, then publishes `ghcr.io/ansidian/setpoint:<commit>` and `:production`.
The package must be public for anonymous Debian pulls; no GitHub credentials or
SSH key are stored on Debian or in repository secrets.

`setpoint-deploy.timer` checks approximately every five minutes after the previous
check completes (two minutes after boot). The host deployer:

1. Pulls the candidate, resolves its immutable digest, verifies source/revision
   labels against a successful canonical GitHub CI run, and refuses older runs.
2. Rehearses migrations/startup against a consistent copied database, with
   workers disabled, no network, and read-only Notes. Audits decryptability,
   database integrity and Notes references. Production stays running.
3. Makes a fresh encrypted full backup and verifies its checksum. A shared lock
   prevents the daily backup from racing deployment. A failed/skipped backup
   cannot authorize activation.
4. Retains the previous image, records a pending deployment, and writes only the
   app image to `compose.override.yaml`. Recreates only the app by digest.
5. Waits for the replacement container's health and checks its actual image ID.
   Records `/srv/setpoint/deployment-state.json` and
   `source/deploy/production-release.txt`, then clears the pending marker.

The Mac need not be online. No inbound listener, public SSH, self-hosted GitHub
runner, firewall change or Tailscale change is involved. Nginx and Home Assistant
are not restarted. Secrets, database and uploaded media remain on Debian.
There is a short interruption while the single app container is replaced;
`/healthz` proves startup readiness, not every provider's health.

## Demo

The same successful CI triggers a separate `npm run build:demo` with
`VITE_EA_DEMO_BASE=/Setpoint/`. Only `dist-demo` is uploaded to GitHub Pages at
<https://ansidian.github.io/Setpoint/>. It contains fictional data and in-memory
mutations, with no production environment, backend or provider credentials.
Image publishing and Pages publishing are independent jobs; their results are
visible separately in the release workflow. `npm run demo` remains local-only.

## Status and pause

```sh
systemctl status setpoint-deploy.timer --no-pager
journalctl -u setpoint-deploy.service -n 40 --no-pager
cat /srv/setpoint/deployment-state.json
sudo systemctl disable --now setpoint-deploy.timer
```

Pausing the timer leaves the running app unchanged; an already running deployment
may finish. To resume after checking state: `sudo systemctl enable --now
setpoint-deploy.timer`. To deploy immediately: `sudo systemctl start
setpoint-deploy.service`. The service uses the same validation for manual starts.
GitHub success means an image was published, **not** that Debian has deployed it;
the host state/journal is the deployment confirmation. An offline host catches
up with the newest eligible candidate when it returns.

## Failure and recovery

- Pull, GitHub verification, disk-space or backup failures leave the old app
  running and can retry. Less than 10 GB free blocks deployment. Images are not
  automatically pruned; review/remove only obsolete Setpoint images deliberately.
- A failed rehearsal is recorded in `deployment-rejected.json`; that digest is
  not retried every five minutes and consumes no deployment backups. A newer candidate
  is eligible. After diagnosing a transient failure, remove the rejection marker
  with sudo to retry it deliberately.
- Before live mutation, `deployment-pending.json` records the candidate, previous
  image and exact backup. If activation fails or is interrupted, the app is
  stopped and further automatic releases are blocked. After an abrupt host crash,
  the next check also stops the app before reporting the pending recovery.
- Pause the timer, inspect the pending record and restricted application logs,
  and review migrations before restoring service. Do **not** just clear the
  marker or start the previous image against an unreviewed schema. Migrations
  are individually atomic, not atomic as a group. A DB restore can discard writes
  since the recorded backup and must be an explicit recovery decision.
- The retained image is tagged `setpoint-rollback:before-<CI-run-ID>`.
  For a reviewed code-only rollback, point `compose.override.yaml` at its image
  ID, recreate only app, verify health and record the recovered release. Leave
  automation paused until its state and pending marker are reconciled.

Daily and deployment archives share the existing **seven-archive** retention;
this is not guaranteed seven-day history when deploying frequently. Hourly Mac
retrieval retains 30. The pre-deployment archive remains retained while activation
is blocked because the app is stopped and daily backups cannot complete.

## Installation and host configuration

Stage the reviewed scripts, service/timer, tests, this document and runbook append
with a SHA256SUMS manifest in a new `/srv/setpoint/deploy-install-<commit>` folder.
Run `sudo bash <folder>/install-auto-deploy.sh` in an interactive SSH terminal.
The installer verifies the bundle and candidate, preserves changed host files,
installs the service/timer, updates the server runbook and runs the first deploy.
Normal sudo authentication is required; no permission expansion is installed.

Application images never install host scripts or configuration. Changes to
Compose, proxy, backup/deployer scripts or systemd units require a deliberate
host update using a reviewed bundle. Existing Compose commands automatically
load the generated image override. Do not overwrite it with a manual image tag.
