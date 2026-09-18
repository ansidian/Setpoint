#!/usr/bin/env python3
"""Release safety tests at Docker, GitHub, clock and filesystem boundaries."""
import fcntl
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("auto_deploy", Path(__file__).with_name("auto-deploy.py"))
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for folder in ("source/deploy", "data/notes", "backups"):
            (self.root / folder).mkdir(parents=True)
        (self.root / "source/deploy/compose.yaml").write_text("services: {}\n")
        self.revision = "a" * 40
        self.digest = deployment.IMAGE + "@sha256:" + "b" * 64
        self.new_image = "sha256:" + "c" * 64
        self.old_image = "sha256:" + "d" * 64
        self.running_image = self.old_image
        self.stopped = False
        self.fail_backup = False
        self.fail_audit = False
        self.fail_activation = False
        self.interrupt_activation = False
        self.retained_images = set()
        self.image = {
            "Id": self.new_image, "RepoDigests": [self.digest], "Config": {"Labels": {
                "org.opencontainers.image.source": deployment.SOURCE,
                "org.opencontainers.image.revision": self.revision,
                "io.setpoint.ci-run-id": "12345", "io.setpoint.ci-run-number": "8",
            }},
        }
        self.ci = {
            "id": 12345, "run_number": 8, "status": "completed", "conclusion": "success",
            "event": "push", "head_branch": "master", "head_sha": self.revision,
            "path": ".github/workflows/ci.yml",
            "repository": {"id": deployment.REPOSITORY_ID},
            "head_repository": {"id": deployment.REPOSITORY_ID},
        }
        for target, kwargs in (
            ("subprocess.run", {"side_effect": self.process}),
            ("shutil.disk_usage", {"return_value": SimpleNamespace(free=20_000_000_000)}),
            ("os.chown", {}), ("time.sleep", {}),
        ):
            context = patch(target, **kwargs)
            context.start()
            self.addCleanup(context.stop)
        context = patch.object(deployment, "urlopen", side_effect=lambda *a, **k:
                               io.BytesIO(json.dumps(self.ci).encode()))
        context.start()
        self.addCleanup(context.stop)
        old_umask = deployment.os.umask(0o077)
        self.addCleanup(deployment.os.umask, old_umask)

    def process(self, args, **kwargs):
        args = list(args)
        output, code = "", 0
        if args[:2] == ["bash", str(self.root / "source/deploy/backup.sh")]:
            if self.fail_backup:
                code = 1
            else:
                stamp = "20260918T235959Z"
                archive = self.root / "backups" / f"setpoint-{stamp}.tar.gz.age"
                archive.write_bytes(b"synthetic encrypted backup")
                Path(str(archive) + ".sha256").write_text(
                    hashlib.sha256(archive.read_bytes()).hexdigest() + "  " + str(archive))
                (self.root / "backups/last-success").write_text(stamp)
        elif args[:3] == ["docker", "image", "inspect"]:
            output = json.dumps([self.image])
        elif args[:2] == ["docker", "inspect"]:
            output = json.dumps([{"Image": self.running_image,
                                  "State": {"Health": {"Status": "healthy"}}}])
        elif args[:2] == ["docker", "tag"]:
            self.retained_images.add(args[2])
        elif args[:2] == ["docker", "compose"]:
            if "ps" in args:
                output = "live-container"
            elif "up" in args:
                self.assertIn(self.digest, (self.root / "source/deploy/compose.override.yaml").read_text())
                self.assertTrue((self.root / "deployment-pending.json").exists())
                self.running_image = self.new_image
                if self.interrupt_activation:
                    raise KeyboardInterrupt()
                if self.fail_activation:
                    code = 1
            elif "stop" in args:
                self.stopped = True
        elif args[:2] == ["docker", "exec"] and args[-1] == "audit" and self.fail_audit:
            code = 1
        return subprocess.CompletedProcess(args, code, stdout=output, stderr="synthetic failure")

    def test_success_retains_backup_previous_image_and_exact_release(self):
        deployment.deploy(self.root)
        state = json.loads((self.root / "deployment-state.json").read_text())
        self.assertEqual((state["digest"], state["revision"], state["phase"]),
                         (self.digest, self.revision, "healthy"))
        self.assertTrue(Path(state["backup"]).exists())
        self.assertIn(self.old_image, self.retained_images)
        self.assertEqual(self.running_image, self.new_image)
        self.assertFalse(self.stopped)
        self.assertFalse((self.root / "deployment-pending.json").exists())
        self.assertEqual(list((self.root / "data").glob(".setpoint-rehearsal-*")), [])

    def test_ci_failure_or_identity_mismatch_never_touches_production(self):
        for key, value in (("conclusion", "failure"), ("head_sha", "e" * 40),
                           ("event", "pull_request"), ("head_branch", "feature"),
                           ("head_repository", {"id": 999}), ("path", "other.yml")):
            with self.subTest(key=key):
                original = self.ci[key]
                self.ci[key] = value
                with self.assertRaisesRegex(RuntimeError, "successful canonical"):
                    deployment.deploy(self.root)
                self.ci[key] = original
                self.assertEqual(self.running_image, self.old_image)
                self.assertFalse((self.root / "backups/last-success").exists())

    def test_image_source_mismatch_is_rejected(self):
        self.image["Config"]["Labels"]["org.opencontainers.image.source"] = "https://example.com"
        with self.assertRaisesRegex(RuntimeError, "release identity"):
            deployment.deploy(self.root)
        self.assertEqual(self.running_image, self.old_image)

    def test_backup_failure_keeps_current_app_running(self):
        self.fail_backup = True
        with self.assertRaises(RuntimeError):
            deployment.deploy(self.root)
        self.assertEqual(self.running_image, self.old_image)
        self.assertFalse(self.stopped)
        self.assertFalse((self.root / "deployment-pending.json").exists())

    def test_backup_skip_cannot_be_mistaken_for_fresh_backup(self):
        (self.root / "backups/last-success").write_text("20260918T235959Z")
        with self.assertRaisesRegex(RuntimeError, "fresh archive"):
            deployment.deploy(self.root)
        self.assertEqual(self.running_image, self.old_image)

    def test_rehearsal_failure_is_rejected_once_without_rotating_backups(self):
        self.fail_audit = True
        with self.assertRaises(RuntimeError):
            deployment.deploy(self.root)
        deployment.deploy(self.root)
        self.assertEqual(self.running_image, self.old_image)
        self.assertFalse(self.stopped)
        self.assertFalse((self.root / "backups/last-success").exists())
        self.assertEqual(json.loads((self.root / "deployment-rejected.json").read_text())["digest"],
                         self.digest)

    def test_failed_activation_stops_candidate_and_blocks_even_newer_release(self):
        self.fail_activation = True
        with self.assertRaises(RuntimeError):
            deployment.deploy(self.root)
        pending = json.loads((self.root / "deployment-pending.json").read_text())
        self.assertEqual(pending["phase"], "failed-needs-review")
        self.assertTrue(self.stopped)
        self.assertTrue(Path(pending["backup"]).exists())
        self.fail_activation = False
        self.image["Config"]["Labels"]["io.setpoint.ci-run-number"] = "9"
        with self.assertRaisesRegex(RuntimeError, "Deployment paused"):
            deployment.deploy(self.root)
        self.assertFalse((self.root / "deployment-state.json").exists())

    def test_interrupted_activation_preserves_recovery_latch(self):
        self.interrupt_activation = True
        with self.assertRaises(KeyboardInterrupt):
            deployment.deploy(self.root)
        self.assertTrue(self.stopped)
        self.assertTrue((self.root / "deployment-pending.json").exists())

    def test_power_loss_pending_state_stops_candidate_before_any_retry(self):
        (self.root / "deployment-pending.json").write_text('{"phase":"activating"}')
        with self.assertRaisesRegex(RuntimeError, "Deployment paused"):
            deployment.deploy(self.root)
        self.assertTrue(self.stopped)
        self.assertFalse((self.root / "backups/last-success").exists())

    def test_same_digest_does_not_restart_or_back_up_again(self):
        deployment.deploy(self.root)
        before = (self.root / "deployment-state.json").read_text()
        self.fail_backup = True
        self.fail_activation = True
        deployment.deploy(self.root)
        self.assertEqual((self.root / "deployment-state.json").read_text(), before)
        self.assertFalse(self.stopped)

    def test_older_release_cannot_roll_back_production(self):
        (self.root / "deployment-state.json").write_text(json.dumps({
            "ci_run_number": 9, "digest": "a-newer-digest",
        }))
        with self.assertRaisesRegex(RuntimeError, "older or rebuilt"):
            deployment.deploy(self.root)
        self.assertEqual(self.running_image, self.old_image)

    def test_backup_lock_contention_defers_deployment(self):
        with (self.root / "deploy.lock").open("a") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            deployment.deploy(self.root)
        self.assertEqual(self.running_image, self.old_image)
        self.assertFalse((self.root / "backups/last-success").exists())


if __name__ == "__main__":
    unittest.main()
