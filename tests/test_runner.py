import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from switcher import launcher, paths, procutil, runner
from switcher.storage import read_json, write_json_atomic

FAKE = str(Path(__file__).resolve().parent / "fake_claude.py")


class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.log = os.path.join(self.tmp.name, "claude.log")
        self.patch = mock.patch.dict(os.environ, {
            "CLAUDE_SWITCHER_HOME": os.path.join(self.tmp.name, "home"),
            "FAKE_CLAUDE_LOG": self.log,
            "FAKE_CLAUDE_SLEEP": "0.6",
        })
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.rid = "t1"

    def cmd_path(self):
        return paths.runs_dir() / f"{self.rid}.cmd.json"

    def state(self):
        return read_json(paths.runs_dir() / f"{self.rid}.state.json", {})

    def write_cmd(self, restart):
        write_json_atomic(self.cmd_path(), {"restart": restart, "seq": 1})

    def wait_for(self, pred, timeout=4):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if pred():
                return True
            time.sleep(0.05)
        return False

    def run_runner(self, extra=(), helper=None):
        t = None
        if helper:
            t = threading.Thread(target=helper, daemon=True)
            t.start()
        rc = runner.main(["--run-id", self.rid, "--cwd", self.tmp.name,
                          "--claude", FAKE, "--no-pause", *extra])
        if t:
            t.join(5)
        return rc

    def calls(self):
        with open(self.log, encoding="utf-8") as f:
            return [ln.strip() for ln in f.read().splitlines()]

    def test_no_cmd_exits(self):
        self.assertEqual(self.run_runner(), 0)
        self.assertEqual(self.calls(), [""])
        self.assertEqual(self.state()["state"], "exited")

    def test_go_restarts_with_continue(self):
        def helper():
            self.wait_for(lambda: self.state().get("state") == "running")
            self.write_cmd("go")
        self.assertEqual(self.run_runner(helper=helper), 0)
        self.assertEqual(self.calls(), ["", "--continue"])
        self.assertEqual(self.state()["state"], "exited")
        self.assertFalse(self.cmd_path().exists())

    def test_pending_then_go(self):
        def helper():
            self.wait_for(lambda: self.state().get("state") == "running")
            self.write_cmd("pending")
            self.wait_for(lambda: self.state().get("state") == "waiting")
            self.write_cmd("go")
        self.assertEqual(self.run_runner(helper=helper), 0)
        self.assertEqual(self.calls(), ["", "--continue"])

    def test_continue_not_duplicated(self):
        def helper():
            self.wait_for(lambda: self.state().get("state") == "running")
            self.write_cmd("go")
        self.run_runner(extra=["--continue"], helper=helper)
        self.assertEqual(self.calls(), ["--continue", "--continue"])

    def test_pending_then_abort(self):
        def helper():
            self.wait_for(lambda: self.state().get("state") == "running")
            self.write_cmd("pending")
            self.wait_for(lambda: self.state().get("state") == "waiting")
            self.write_cmd("abort")
        self.assertEqual(self.run_runner(helper=helper), 0)
        self.assertEqual(len(self.calls()), 1)
        self.assertEqual(self.state()["state"], "exited")

    def test_wait_timeout(self):
        def helper():
            self.wait_for(lambda: self.state().get("state") == "running")
            self.write_cmd("pending")
        self.assertEqual(self.run_runner(extra=["--wait-timeout", "1"], helper=helper), 0)
        self.assertEqual(len(self.calls()), 1)
        self.assertEqual(self.state()["state"], "exited")

    def test_missing_claude(self):
        with mock.patch("shutil.which", return_value=None):
            rc = runner.main(["--run-id", "x", "--cwd", self.tmp.name, "--no-pause"])
        self.assertEqual(rc, 1)


class LauncherTest(unittest.TestCase):
    def test_semicolon_rejected(self):
        with self.assertRaises(ValueError):
            launcher.launch("C:\\a;b", popen=mock.Mock())

    def test_wt_command(self):
        popen = mock.Mock()
        rid = launcher.launch("C:\\proj", cont=True, popen=popen, wt_path="C:\\wt.exe")
        args, kwargs = popen.call_args
        cmd = args[0]
        self.assertIsInstance(cmd, list)
        self.assertEqual(cmd[:7], ["C:\\wt.exe", "-w", "new", "--title",
                                   "Claude (switcher)", "-d", "C:\\proj"])
        self.assertIn("--run-id", cmd)
        self.assertEqual(cmd[cmd.index("--run-id") + 1], rid)
        self.assertEqual(cmd[-1], "--continue")
        self.assertEqual(kwargs["env"]["PYTHONUTF8"], "1")
        self.assertEqual(kwargs["env"]["PYTHONPATH"], str(paths.project_root()))

    def test_no_wt_new_console(self):
        popen = mock.Mock()
        with mock.patch("shutil.which", return_value=None):
            launcher.launch("C:\\proj", popen=popen)
        args, kwargs = popen.call_args
        self.assertEqual(args[0][1:3], ["-m", "switcher.runner"])
        self.assertEqual(kwargs["creationflags"], subprocess.CREATE_NEW_CONSOLE)

    def test_state_and_cmd_files(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(
                os.environ, {"CLAUDE_SWITCHER_HOME": tmp}):
            write_json_atomic(paths.runs_dir() / "r1.state.json", {
                "run_id": "r1", "runner_pid": os.getpid(), "claude_pid": None,
                "state": "running"})
            write_json_atomic(paths.runs_dir() / "r2.state.json", {
                "run_id": "r2", "runner_pid": 0, "state": "running"})
            runs = launcher.active_runs()
            self.assertEqual([r["run_id"] for r in runs], ["r1"])
            self.assertFalse((paths.runs_dir() / "r2.state.json").exists())
            self.assertTrue(launcher.request_restart(runs[0]))
            self.assertEqual(read_json(paths.runs_dir() / "r1.cmd.json")["restart"], "pending")
            launcher.release_restart(runs[0])
            self.assertEqual(read_json(paths.runs_dir() / "r1.cmd.json")["restart"], "go")
            launcher.abort_restart(runs[0])
            self.assertEqual(read_json(paths.runs_dir() / "r1.cmd.json")["restart"], "abort")


class ProcutilTest(unittest.TestCase):
    def test_pid_alive(self):
        self.assertTrue(procutil.pid_alive(os.getpid()))
        self.assertFalse(procutil.pid_alive(0))
        p = subprocess.Popen([sys.executable, "-c", "pass"])
        p.wait()
        self.assertFalse(procutil.pid_alive(p.pid))

    def test_kill_tree(self):
        p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"],
                             creationflags=procutil.NO_WINDOW)
        self.assertTrue(procutil.pid_alive(p.pid))
        self.assertTrue(procutil.kill_tree(p.pid))
        p.wait(5)
        self.assertFalse(procutil.pid_alive(p.pid))


if __name__ == "__main__":
    unittest.main()
