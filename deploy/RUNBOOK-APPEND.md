
## Setpoint automatic releases — 2026-09-18

The owner authorized automatic production deployment and fictional GitHub Pages
publishing after successful canonical master push CI. Source is public
ansidian/Setpoint (ID1376484785), local checkout
/Users/andys/Documents/Projects/setpoint. Legacy checkout is setpoint-legacy.

GitHub's Release production and demo workflow checks out the verified SHA, builds
and smoke-tests the Linux image, publishes ghcr.io/ansidian/setpoint:production,
and separately publishes only dist-demo at https://ansidian.github.io/Setpoint/.
No runtime secrets or real data enter either build.

Installed files: /srv/setpoint/source/deploy/auto-deploy.py, backup.sh and
AUTOMATIC-DEPLOYMENT.md; /etc/systemd/system/setpoint-deploy.service and timer.
The timer checks one minute after each completed run, two minutes after boot.
Only outbound registry/GitHub HTTPS is required. No GitHub runner/credential,
public SSH, new listener, firewall or Tailscale change was introduced.

The deployer verifies canonical CI SHA/result and monotonic run identity, uses
an immutable image digest, rehearses migrations/startup on a copied DB without
network/provider workers, and creates a fresh encrypted backup before activation.
A shared deploy.lock serializes with daily backup; skipped backup is not success.
Only app is recreated. Nginx, Home Assistant, secrets, DB and Notes mounts stay.
State: /srv/setpoint/deployment-state.json and source/deploy/production-release.txt.
Compose automatically reads source/deploy/compose.override.yaml for the digest.

Failed rehearsal records deployment-rejected.json and does not repeat that image
or rotate backups. Failed/interrupted live activation records
deployment-pending.json, stops app and blocks every subsequent automatic release
until reviewed recovery. The next check reconciles pending activation after a
host crash too. Preserve the previous image and recorded pre-deploy archive;
never automatically restore a DB or launch old code against an unreviewed schema.

Pause: sudo systemctl disable --now setpoint-deploy.timer (active run may finish).
Status: systemctl status setpoint-deploy.timer; journalctl -u setpoint-deploy.service;
cat /srv/setpoint/deployment-state.json. Resume only after reviewing failure/state:
sudo systemctl enable --now setpoint-deploy.timer. Full commands and recovery:
/srv/setpoint/source/deploy/AUTOMATIC-DEPLOYMENT.md.

The installer retains previous host scripts and runbook in a dated
/srv/setpoint/deploy-install-backup-* folder. Host configuration updates remain
deliberate; application images cannot replace host scripts. Images are retained
without automatic pruning and deployment blocks below10GB free. Daily and
deployment backups share seven-archive retention (not necessarily seven days);
the Mac keeps30 pulled archives. Render stays suspended and Turso stays retired
from live use. No stale Render workers may resume.

Installer validation covers bundle checksums, deployment regression tests,
shell/systemd/Compose syntax, anonymous image pull and GitHub CI identity.
The installer starts the first real deployment; its service outcome and state
record establish activation success, not this descriptive runbook entry alone.
