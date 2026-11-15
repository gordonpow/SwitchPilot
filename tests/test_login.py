import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from switcher import browser_open, login, paths

FAKE = str(Path(__file__).with_name("fake_login.py"))


class ExtractUrlTest(unittest.TestCase):
    def test_variants(self):
        self.assertEqual(browser_open.extract_url(['"https://a.b/c?d=1&e=2"']), "https://a.b/c?d=1&e=2")
        self.assertEqual(browser_open.extract_url(["https://a.b/c?d=1", "&e=2"]), "https://a.b/c?d=1 &e=2")
        self.assertEqual(browser_open.extract_url(["  http://localhost:1/x "]), "http://localhost:1/x")
        self.assertIsNone(browser_open.extract_url([]))
        self.assertIsNone(browser_open.extract_url(["file:///c:/x"]))


class OpenUrlTest(unittest.TestCase):
    def test_edge_inprivate(self):
        popen = mock.Mock()
        web = mock.Mock()
        r = browser_open.open_url("https://u", popen=popen, web_open=web, edge="C:/msedge.exe")
        self.assertEqual(r, "edge")
        self.assertEqual(popen.call_args[0][0], ["C:/msedge.exe", "--inprivate", "https://u"])
        web.assert_not_called()

    def test_default_when_no_edge(self):
        popen = mock.Mock()
        web = mock.Mock()
        with mock.patch.object(browser_open, "find_edge", return_value=None):
            r = browser_open.open_url("https://u", popen=popen, web_open=web)
        self.assertEqual(r, "default")
        web.assert_called_once_with("https://u")
        popen.assert_not_called()


class LoginSessionTest(unittest.TestCase):
    def setUp(self):
        self._old = os.environ.get("CLAUDE_SWITCHER_HOME")
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["CLAUDE_SWITCHER_HOME"] = self.tmp.name

    def tearDown(self):
        if self._old is None:
            os.environ.pop("CLAUDE_SWITCHER_HOME", None)
        else:
            os.environ["CLAUDE_SWITCHER_HOME"] = self._old
        self.tmp.cleanup()

    def session(self, mode):
        return login.LoginSession([sys.executable, FAKE, mode])

    def wait(self, s, timeout=15):
        end = time.time() + timeout
        while time.time() < end:
            st = s.poll()
            if st != "running":
                return st
            time.sleep(0.05)
        return s.poll()

    def test_success(self):
        s = self.session("ok")
        s.start()
        try:
            self.assertTrue(s.dir.is_dir())
            cmd = (s.dir / "open_browser.cmd").read_text(encoding="utf-8")
            self.assertIn("browser_open.py", cmd)
            self.assertEqual(self.wait(s), "done")
            creds, acct = s.result()
            self.assertIn("claudeAiOauth", creds)
            self.assertEqual(acct["emailAddress"], "fake@x")
            time.sleep(0.3)
            self.assertEqual(s.login_url(), "https://example.test/fallback?x=1")
            (s.dir / "browser_url.txt").write_text("https://real/url", encoding="utf-8")
            self.assertEqual(s.login_url(), "https://real/url")
        finally:
            s.cleanup()
        self.assertFalse(s.dir.exists())

    def test_failed(self):
        s = self.session("fail")
        s.start()
        try:
            self.assertEqual(self.wait(s), "failed")
            time.sleep(0.3)
            self.assertIn("login failed", s.last_lines())
        finally:
            s.cleanup()

    def test_missing_creds(self):
        s = self.session("nocreds")
        s.start()
        try:
            self.assertEqual(self.wait(s), "done")
            with self.assertRaises(login.LoginError) as cm:
                s.result()
            self.assertIn("other.txt", str(cm.exception))
        finally:
            s.cleanup()

    def test_cancel_removes_dir(self):
        s = self.session("sleep")
        s.start()
        self.assertEqual(s.poll(), "running")
        s.cancel()
        self.assertFalse(s.dir.exists())
        self.assertNotEqual(s.poll(), "running")

    def test_claude_not_found(self):
        with mock.patch("switcher.login.shutil.which", return_value=None):
            with self.assertRaises(login.LoginError):
                login.LoginSession().start()

    def test_cleanup_stale(self):
        (paths.login_dir() / "abc").mkdir(parents=True)
        login.cleanup_stale()
        self.assertFalse(paths.login_dir().exists())


if __name__ == "__main__":
    unittest.main()
