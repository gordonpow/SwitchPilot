import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from switcher import integration, paths  # noqa: E402

_KEYS = ("CLAUDE_SWITCHER_HOME", "CLAUDE_SWITCHER_CLAUDE_HOME", "CLAUDE_SWITCHER_CLAUDE_JSON")


class Base(unittest.TestCase):
    def setUp(self):
        self._saved = {k: os.environ.get(k) for k in _KEYS}
        self._tmp = tempfile.TemporaryDirectory()
        t = Path(self._tmp.name)
        os.environ["CLAUDE_SWITCHER_HOME"] = str(t / "app")
        os.environ["CLAUDE_SWITCHER_CLAUDE_HOME"] = str(t / "claude")
        os.environ["CLAUDE_SWITCHER_CLAUDE_JSON"] = str(t / "claude.json")
        (t / "claude").mkdir()

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self._tmp.cleanup()

    def write_settings(self, data):
        paths.settings_file().write_text(json.dumps(data), encoding="utf-8")

    def read_settings(self):
        return json.loads(paths.settings_file().read_text(encoding="utf-8"))


PY = "C:\\Python313\\python.exe"
ROOT_WIN = "C:\\proj\\Switching_account"


class IntegrationTests(Base):
    def test_install_without_file(self):
        integration.install(python_exe=PY, project_root=ROOT_WIN)
        self.assertTrue(integration.is_installed())
        s = self.read_settings()
        self.assertEqual(s["statusLine"]["type"], "command")
        self.assertIn("StopFailure", s["hooks"])
        self.assertEqual(s["hooks"]["StopFailure"][0]["matcher"], "rate_limit")

    def test_forward_slashes(self):
        integration.install(python_exe=PY, project_root=ROOT_WIN)
        s = self.read_settings()
        cmds = [s["statusLine"]["command"]]
        for ev in s["hooks"].values():
            for g in ev:
                cmds += [h["command"] for h in g["hooks"]]
        for c in cmds:
            self.assertNotIn("\\", c)
        self.assertEqual(
            s["statusLine"]["command"],
            '"C:/Python313/python.exe" "C:/proj/Switching_account/switcher/statusline.py"')

    def test_pythonw_replaced(self):
        integration.install(python_exe="C:\\Py\\pythonw.exe", project_root=ROOT_WIN)
        self.assertIn("C:/Py/python.exe", self.read_settings()["statusLine"]["command"])

    def test_preserves_other_keys_and_hooks(self):
        other = {"hooks": [{"type": "command", "command": "echo hi"}]}
        self.write_settings({"model": "opus", "hooks": {"Stop": [other], "PreToolUse": [other]}})
        integration.install(python_exe=PY, project_root=ROOT_WIN)
        s = self.read_settings()
        self.assertEqual(s["model"], "opus")
        self.assertEqual(s["hooks"]["PreToolUse"], [other])
        self.assertEqual(s["hooks"]["Stop"][0], other)
        self.assertEqual(len(s["hooks"]["Stop"]), 2)
        self.assertTrue(list(paths.backups_dir().glob("settings-*.json")))

    def test_reinstall_no_duplicates(self):
        integration.install(python_exe=PY, project_root=ROOT_WIN)
        integration.install(python_exe=PY, project_root=ROOT_WIN)
        s = self.read_settings()
        self.assertEqual(len(s["hooks"]["Stop"]), 1)
        self.assertEqual(len(s["hooks"]["StopFailure"]), 1)

    def test_uninstall_restores_original_statusline(self):
        orig = {"type": "command", "command": "my-status"}
        other = {"hooks": [{"type": "command", "command": "echo hi"}]}
        self.write_settings({"statusLine": orig, "model": "x", "hooks": {"Stop": [other]}})
        integration.install(python_exe=PY, project_root=ROOT_WIN)
        integration.install(python_exe=PY, project_root=ROOT_WIN)  # 重裝不得覆蓋原值
        integration.uninstall()
        s = self.read_settings()
        self.assertEqual(s["statusLine"], orig)
        self.assertEqual(s["hooks"], {"Stop": [other]})
        self.assertEqual(s["model"], "x")
        self.assertFalse(integration.is_installed())

    def test_uninstall_removes_when_no_original(self):
        self.write_settings({"model": "x"})
        integration.install(python_exe=PY, project_root=ROOT_WIN)
        integration.uninstall()
        self.assertEqual(self.read_settings(), {"model": "x"})

    def test_bad_json_not_overwritten(self):
        paths.settings_file().write_text("{ not json", encoding="utf-8")
        with self.assertRaises(Exception):
            integration.install(python_exe=PY, project_root=ROOT_WIN)
        with self.assertRaises(Exception):
            integration.uninstall()
        self.assertEqual(paths.settings_file().read_text(encoding="utf-8"), "{ not json")
        self.assertFalse(integration.is_installed())


class ScriptTests(Base):
    def run_script(self, name, stdin, *args):
        return subprocess.run(
            [sys.executable, str(ROOT / "switcher" / name), *args],
            input=stdin, capture_output=True, text=True, encoding="utf-8",
            env=dict(os.environ), timeout=30)

    def test_statusline_writes_usage(self):
        payload = {"session_id": "s1", "cwd": "C:/x",
                   "rate_limits": {"five_hour": {"used_percentage": 42.4, "resets_at": 1900000000},
                                   "seven_day": {"used_percentage": 10, "resets_at": 1900500000}}}
        r = self.run_script("statusline.py", json.dumps(payload))
        self.assertEqual(r.returncode, 0)
        lines = r.stdout.strip().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertIn("5h 42%", lines[0])
        self.assertIn("7d 10%", lines[0])
        rec = json.loads((paths.usage_dir() / "s1.json").read_text(encoding="utf-8"))
        self.assertEqual(rec["session_id"], "s1")
        self.assertEqual(rec["five_hour"]["used_percentage"], 42.4)
        self.assertEqual(rec["seven_day"]["resets_at"], 1900500000)
        self.assertIn("slot_id", rec)

    def test_statusline_missing_rate_limits(self):
        r = self.run_script("statusline.py", json.dumps({"session_id": "s2"}))
        self.assertEqual(r.returncode, 0)
        self.assertIn("5h --", r.stdout)
        self.assertIn("7d --", r.stdout)
        rec = json.loads((paths.usage_dir() / "s2.json").read_text(encoding="utf-8"))
        self.assertIsNone(rec["five_hour"])

    def test_statusline_bad_stdin(self):
        r = self.run_script("statusline.py", "not json")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "[switcher]")

    def test_hook_writes_event(self):
        payload = {"session_id": "s1", "cwd": "C:/x", "error": "rate_limit"}
        r = self.run_script("hook.py", json.dumps(payload), "stopfailure")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "")
        files = list(paths.events_dir().glob("*.json"))
        self.assertEqual(len(files), 1)
        ev = json.loads(files[0].read_text(encoding="utf-8"))
        self.assertEqual(ev["kind"], "stopfailure")
        self.assertEqual(ev["error"], "rate_limit")
        self.assertEqual(ev["session_id"], "s1")

    def test_hook_stop_without_error_and_bad_input(self):
        r = self.run_script("hook.py", json.dumps({"session_id": "a"}), "stop")
        self.assertEqual(r.returncode, 0)
        ev = json.loads(next(paths.events_dir().glob("*.json")).read_text(encoding="utf-8"))
        self.assertEqual(ev["kind"], "stop")
        self.assertIsNone(ev["error"])
        r = self.run_script("hook.py", "garbage", "stop")
        self.assertEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
