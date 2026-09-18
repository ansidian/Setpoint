#!/bin/bash
# Run only from the reviewed staging bundle, with normal interactive sudo.
set -euo pipefail
umask 077
[[ $EUID == 0 ]] || { echo 'Run this installer with sudo.'; exit 1; }
bundle=$(cd -- "$(dirname -- "$0")" && pwd)
root=/srv/setpoint
target="$root/source/deploy"
cd "$bundle"
sha256sum --check SHA256SUMS
python3 -B test-auto-deploy.py
bash -n backup.sh install-auto-deploy.sh
docker compose --project-directory "$target" --profile production config --quiet
[[ ! -e "$root/deployment-pending.json" ]] || { echo 'Resolve the pending deployment first.'; exit 1; }

# Verify anonymous registry access and successful CI before changing host files.
docker pull ghcr.io/ansidian/setpoint:production
python3 -B - <<'PY'
import importlib.util,json,subprocess
spec=importlib.util.spec_from_file_location('release','auto-deploy.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
image=json.loads(subprocess.check_output(['docker','image','inspect','ghcr.io/ansidian/setpoint:production']))[0]
release=module.candidate(image)
module.verify_ci(release)
print('Verified candidate:', release['revision'])
PY

exec 8>"$root/deploy.lock"
flock -w 300 8
exec 9>"$root/backups/backup.lock"
flock -w 300 9
[[ ! -e "$root/deployment-pending.json" ]] || { echo 'Deployment failed while waiting; resolve it first.'; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
rollback="$root/deploy-install-backup-$stamp"
mkdir -m 700 "$rollback"
for file in backup.sh auto-deploy.py setpoint-deploy.service setpoint-deploy.timer; do
  if [[ -f "$target/$file" ]]; then cp -p "$target/$file" "$rollback/$file"; fi
done
for file in setpoint-deploy.service setpoint-deploy.timer; do
  if [[ -f "/etc/systemd/system/$file" ]]; then
    cp -p "/etc/systemd/system/$file" "$rollback/installed-$file"
  fi
done
cp -p /srv/infra/README.md "$rollback/infra-README.md"
for file in auto-deploy.py backup.sh setpoint-deploy.service setpoint-deploy.timer AUTOMATIC-DEPLOYMENT.md; do
  mode=644
  if [[ $file == *.sh ]]; then mode=755; fi
  install -o root -g root -m "$mode" "$bundle/$file" "$target/$file.new"
  mv "$target/$file.new" "$target/$file"
done
install -o root -g root -m 644 setpoint-deploy.service setpoint-deploy.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/setpoint-deploy.service /etc/systemd/system/setpoint-deploy.timer
cat RUNBOOK-APPEND.md >> /srv/infra/README.md
flock -u 9
flock -u 8
systemctl daemon-reload
systemctl enable --now setpoint-deploy.timer
systemctl start setpoint-deploy.service
systemctl status setpoint-deploy.timer --no-pager
cat "$root/deployment-state.json"
echo "Deployment installed; previous host files retained at $rollback"
