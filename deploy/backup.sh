#!/bin/bash
set -euo pipefail
umask 077
root=/srv/setpoint
exec 9>"$root/backups/backup.lock"
flock -n 9 || exit 0
[[ $(df --output=avail -B1 "$root" | tail -1) -gt 10000000000 ]] || { echo 'Backup: free disk below10GB'; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
stage="$root/data/.backup-$stamp"
archive="$root/backups/setpoint-$stamp.tar.gz.age"
install -d -o 1000 -g 1000 -m 700 "$stage" "$stage/db" "$stage/notes"
cleanup() { rm -rf -- "$stage"; rm -f -- "$archive.partial"; }
trap cleanup EXIT
cd "$root/source/deploy"
docker compose --profile production exec -T app node server/scripts/local-db.ts snapshot "/data/.backup-$stamp/db/setpoint.db" > "$stage/database-audit.json"
# Notes assets are immutable and appended before their document references are saved.
cp -a "$root/data/notes/." "$stage/notes/"
docker compose --profile production exec -T \
  -e "EA_SQLITE_PATH=/data/.backup-$stamp/db/setpoint.db" \
  -e "EA_TLDRAW_ASSET_DIR=/data/.backup-$stamp/notes" \
  app node server/scripts/local-db.ts audit > "$stage/restore-audit.json"
# Includes encrypted credentials + root key; archive is encrypted before leaving the host.
tar -czf - -C "$stage" db notes database-audit.json restore-audit.json \
  -C "$root" runtime.env backup-recipient.txt source/deploy secrets letsencrypt \
  | age -R "$root/backup-recipient.txt" -o "$archive.partial"
mv "$archive.partial" "$archive"
chown andys:andys "$archive"
sha256sum "$archive" > "$archive.sha256"
chown andys:andys "$archive.sha256"
python3 - "$root/backups" <<'PY'
from pathlib import Path
import sys,re
root=Path(sys.argv[1])
files=sorted(p for p in root.iterdir() if re.fullmatch(r'setpoint-\d{8}T\d{6}Z\.tar\.gz\.age',p.name))
for p in files[:-7]:
    p.unlink()
    p.with_name(p.name+'.sha256').unlink(missing_ok=True)
PY
printf '%s\n' "$stamp" > "$root/backups/last-success"
chown andys:andys "$root/backups/last-success"
echo "Encrypted backup completed: $stamp"
