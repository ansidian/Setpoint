#!/usr/bin/env python3
"""Boot a release image with fictional, disposable data and no external network."""
import secrets
import subprocess
import sys
import time


def main(image):
    name = "setpoint-smoke-" + secrets.token_hex(6)
    try:
        subprocess.run([
            "docker", "run", "-d", "--name", name, "--network", "none",
            "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m",
            "--tmpfs", "/data:rw,nosuid,nodev,uid=1000,gid=1000,size=256m",
            "-e", "NODE_ENV=production", "-e", "EA_DB_ADAPTER=sqlite",
            "-e", "EA_SQLITE_PATH=/data/setpoint.db", "-e", "EA_BIND_HOST=127.0.0.1",
            "-e", "PORT=3001", "-e", "EA_BACKGROUND_WORKERS_ENABLED=0",
            "-e", "EA_ENCRYPTION_KEY=" + secrets.token_hex(32),
            "-e", "EA_SETUP_TOKEN=" + secrets.token_hex(32), image,
        ], check=True, stdout=subprocess.DEVNULL)
        for _ in range(60):
            result = subprocess.run([
                "docker", "exec", name, "node", "-e",
                "fetch('http://127.0.0.1:3001/healthz',{signal:AbortSignal.timeout(2000)})"
                ".then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode == 0:
                print("Isolated image startup passed")
                return
            time.sleep(2)
        raise RuntimeError("Image did not become healthy within 120 seconds")
    finally:
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, check=False)


if __name__ == "__main__":
    main(sys.argv[1])
