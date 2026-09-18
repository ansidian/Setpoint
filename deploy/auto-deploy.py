#!/usr/bin/env python3
"""Pull verified releases; keep host configuration and production data on Debian."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import signal
import shutil
import subprocess
import time
from urllib.request import Request, urlopen

IMAGE = "ghcr.io/ansidian/setpoint"
SOURCE = "https://github.com/ansidian/Setpoint"
REPOSITORY_ID = 1376484785
HEALTH_JS = (
    "fetch('http://127.0.0.1:3001/healthz',{signal:AbortSignal.timeout(2000)})"
    ".then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
)


def run(*args, env=None, timeout=600):
    # Never print command output: application diagnostics can contain private data.
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"{args[0]} {args[1]} failed (exit {result.returncode})")
    return result.stdout.strip()


def write_json(path, value):
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as handle:
        handle.write(json.dumps(value, indent=2) + "\n")
        os.fchmod(handle.fileno(), 0o644)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)
    sync_directory(path.parent)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def candidate(image):
    labels = image["Config"].get("Labels") or {}
    revision = labels.get("org.opencontainers.image.revision", "")
    run_id = labels.get("io.setpoint.ci-run-id", "")
    number = labels.get("io.setpoint.ci-run-number", "")
    if (labels.get("org.opencontainers.image.source") != SOURCE
            or not re.fullmatch(r"[a-f0-9]{40}", revision)
            or not run_id.isdigit() or not number.isdigit()):
        raise RuntimeError("Image lacks valid canonical release identity")
    digests = [d for d in image.get("RepoDigests", [])
               if re.fullmatch(re.escape(IMAGE) + r"@sha256:[a-f0-9]{64}", d)]
    if len(digests) != 1:
        raise RuntimeError("Image does not resolve to one immutable registry digest")
    return {"revision": revision, "ci_run_id": int(run_id),
            "ci_run_number": int(number), "digest": digests[0], "image_id": image["Id"]}


def verify_ci(release):
    request = Request(
        f"https://api.github.com/repos/ansidian/Setpoint/actions/runs/{release['ci_run_id']}",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "setpoint-deploy"},
    )
    with urlopen(request, timeout=30) as response:
        ci = json.load(response)
    if not (ci.get("id") == release["ci_run_id"]
            and ci.get("run_number") == release["ci_run_number"]
            and ci.get("status") == "completed" and ci.get("conclusion") == "success"
            and ci.get("event") == "push" and ci.get("head_branch") == "master"
            and ci.get("head_sha") == release["revision"]
            and ci.get("path") == ".github/workflows/ci.yml"
            and ci.get("repository", {}).get("id") == REPOSITORY_ID
            and ci.get("head_repository", {}).get("id") == REPOSITORY_ID):
        raise RuntimeError("Release does not match a successful canonical master CI push")


def rehearsal(root, release, compose):
    # Copy a consistent snapshot, never open the live DB in the candidate image.
    name = "setpoint-rehearsal-" + secrets.token_hex(6)
    stage = root / "data" / ("." + name)
    stage.mkdir(mode=0o700)
    os.chown(stage, 1000, 1000)
    created = False
    try:
        run(*compose, "exec", "-T", "app", "node", "server/scripts/local-db.ts",
            "snapshot", f"/data/{stage.name}/setpoint.db")
        run("docker", "create", "--name", name, "--network", "none",
            "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--env-file", str(root / "runtime.env"),
            "-e", "NODE_ENV=production", "-e", "EA_DB_ADAPTER=sqlite",
            "-e", "EA_SQLITE_PATH=/rehearsal/setpoint.db",
            "-e", "EA_BACKGROUND_WORKERS_ENABLED=0", "-e", "EA_BIND_HOST=127.0.0.1",
            "-e", "PORT=3001", "-e", "EA_TLDRAW_ASSET_DIR=/notes",
            "-e", "ACTUAL_DATA_DIR=/tmp/actual",
            "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m",
            "--mount", f"type=bind,src={stage},dst=/rehearsal",
            "--mount", f"type=bind,src={root / 'data/notes'},dst=/notes,readonly",
            release["digest"])
        created = True
        run("docker", "start", name)
        for attempt in range(60):
            try:
                run("docker", "exec", name, "node", "-e", HEALTH_JS, timeout=10)
                break
            except RuntimeError:
                if attempt == 59:
                    raise RuntimeError("Isolated rehearsal did not become healthy") from None
                time.sleep(2)
        run("docker", "exec", name, "node", "server/scripts/local-db.ts", "audit")
    finally:
        # A failed removal must not delete a DB still mounted in a container.
        if created:
            run("docker", "rm", "-f", name)
        shutil.rmtree(stage)


def deploy(root=Path("/srv/setpoint")):
    os.umask(0o077)
    directory = root / "source/deploy"
    state = root / "deployment-state.json"
    pending = root / "deployment-pending.json"
    rejected = root / "deployment-rejected.json"
    lock = (root / "deploy.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        return
    try:
        if pending.exists():
            # Also reconcile after power loss, when Python cleanup could not run.
            run("docker", "compose", "--project-directory", str(directory),
                "--profile", "production", "stop", "app", timeout=180)
            raise RuntimeError("Deployment paused: review deployment-pending.json before recovery")
        previous = json.loads(state.read_text()) if state.exists() else {}
        if shutil.disk_usage(root).free < 10_000_000_000:
            raise RuntimeError("Deployment paused: less than 10 GB free; review retained images")
        run("docker", "pull", IMAGE + ":production")
        image = json.loads(run("docker", "image", "inspect", IMAGE + ":production"))[0]
        release = candidate(image)
        if release["digest"] == previous.get("digest"):
            return
        if rejected.exists() and json.loads(rejected.read_text()).get("digest") == release["digest"]:
            return
        if release["ci_run_number"] <= previous.get("ci_run_number", 0):
            raise RuntimeError("Refusing an older or rebuilt CI release")
        verify_ci(release)
        if shutil.disk_usage(root).free < 10_000_000_000:
            raise RuntimeError("Deployment paused: image download left less than 10 GB free")
        # Explicit files prevent an unrelated working directory affecting Compose.
        compose = ["docker", "compose", "--project-directory", str(directory),
                   "-f", str(directory / "compose.yaml")]
        override = directory / "compose.override.yaml"
        if override.exists():
            compose += ["-f", str(override)]
        compose += ["--profile", "production"]
        run(*compose, "config", "--quiet")
        container_id = run(*compose, "ps", "-q", "app")
        current = json.loads(run("docker", "inspect", container_id))[0]
        if current["State"].get("Health", {}).get("Status") != "healthy":
            raise RuntimeError("Current production app is not healthy; manual review required")
        release["previous_image_id"] = current["Image"]
        print(f"Rehearsing verified commit {release['revision']}", flush=True)
        try:
            rehearsal(root, release, compose)
        except Exception:
            write_json(rejected, release)
            raise
        # Existing daily backup uses the same deployment lock and its own backup lock.
        marker = root / "backups/last-success"
        prior_backup = marker.read_text().strip() if marker.exists() else ""
        run("bash", str(directory / "backup.sh"),
            env={**os.environ, "SETPOINT_DEPLOY_LOCK_HELD": "1"})
        stamp = marker.read_text().strip()
        if stamp == prior_backup or not re.fullmatch(r"\d{8}T\d{6}Z", stamp):
            raise RuntimeError("Backup did not produce a fresh archive")
        archive = root / "backups" / f"setpoint-{stamp}.tar.gz.age"
        with archive.open("rb") as handle:
            actual_hash = hashlib.file_digest(handle, "sha256").hexdigest()
        if actual_hash != Path(str(archive) + ".sha256").read_text().split()[0]:
            raise RuntimeError("Pre-deployment archive checksum mismatch")
        release["backup"] = str(archive)
        run("docker", "tag", current["Image"], f"setpoint-rollback:before-{release['ci_run_id']}")
        release["phase"] = "activating"
        write_json(pending, release)
        try:
            # The marker comes first: interruption must never trigger an implicit retry.
            if override.exists():
                shutil.copyfile(override, root / "deployment-previous-compose.yaml")
            temporary = directory / "compose.override.yaml.tmp"
            temporary.write_text(f"services:\n  app:\n    image: {release['digest']}\n")
            temporary.chmod(0o644)
            temporary.replace(override)
            active_compose = ["docker", "compose", "--project-directory", str(directory),
                              "-f", str(directory / "compose.yaml"), "-f", str(override),
                              "--profile", "production"]
            run(*active_compose, "up", "-d", "--no-deps", "--no-build", "--pull", "never",
                "--wait", "--wait-timeout", "180", "app", timeout=360)
            new_id = run(*active_compose, "ps", "-q", "app")
            active = json.loads(run("docker", "inspect", new_id))[0]
            if (active["Image"] != release["image_id"]
                    or active["State"].get("Health", {}).get("Status") != "healthy"):
                raise RuntimeError("Replacement image identity or health check failed")
            run("docker", "exec", new_id, "node", "-e", HEALTH_JS, timeout=10)
            release["phase"] = "healthy"
            release["deployed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            write_json(state, release)
            record = directory / "production-release.txt"
            record.write_text(f"Source: ansidian/Setpoint {release['revision']}\n"
                              f"Image: {release['digest']}\n"
                              f"CI: https://github.com/ansidian/Setpoint/actions/runs/{release['ci_run_id']}\n"
                              f"Deployed: {release['deployed_at']}\n")
            record.chmod(0o644)
            pending.unlink()
            sync_directory(root)
            print(f"Deployed {release['revision']} and verified container health", flush=True)
        except BaseException:
            release["phase"] = "failed-needs-review"
            write_json(pending, release)
            # Prevent candidate restart loops against a potentially migrated database.
            try:
                run(*compose, "stop", "app", timeout=180)
            except Exception:
                pass
            raise
    finally:
        lock.close()


if __name__ == "__main__":
    def interrupted(_signum, _frame):
        raise RuntimeError("Deployment interrupted; recovery marker retained if activation began")

    signal.signal(signal.SIGTERM, interrupted)
    try:
        deploy()
    except Exception as error:
        # No captured container output, environment or credential material in journal.
        print(f"Setpoint deployment failed: {error}", flush=True)
        raise SystemExit(1) from None
